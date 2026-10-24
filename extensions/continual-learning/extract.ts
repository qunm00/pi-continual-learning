/**
 * Session discovery and condensation.
 *
 * Only user and assistant text is kept: preferences and corrections live
 * there, while tool traffic would swamp the payload.
 */

import type { Dirent } from "node:fs";
import {
	closeSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	statSync,
} from "node:fs";
import { basename, join } from "node:path";
import type { SessionFile, SessionIndex } from "./types.ts";

const MAX_USER_CHARS = 2048;
const MAX_ASSISTANT_CHARS = 1024;
const MAX_MESSAGES = 40;

export function readSessionCwd(filePath: string): string | null {
	let fd: number | undefined;
	try {
		fd = openSync(filePath, "r");
		const buffer = Buffer.alloc(4096);
		const bytes = readSync(fd, buffer, 0, buffer.length, 0);
		const firstLine = buffer
			.subarray(0, bytes)
			.toString("utf-8")
			.split("\n")[0];
		const parsed = JSON.parse(firstLine) as Record<string, unknown>;
		return typeof parsed.cwd === "string" ? parsed.cwd : null;
	} catch {
		return null;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

function messageText(entry: Record<string, unknown>): string {
	const message = entry.message;
	if (typeof message !== "object" || message === null) return "";
	const content = (message as Record<string, unknown>).content;
	if (!Array.isArray(content)) return "";

	const parts: string[] = [];
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue;
		const record = block as Record<string, unknown>;
		if (record.type === "text" && typeof record.text === "string") {
			parts.push(record.text);
		}
	}
	return parts.join("\n");
}

export function condenseSession(jsonl: string): string {
	const messages: { role: "user" | "assistant"; text: string }[] = [];

	for (const line of jsonl.split("\n")) {
		if (!line.trim()) continue;

		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		if (typeof entry !== "object" || entry === null) continue;

		const record = entry as Record<string, unknown>;
		if (record.type !== "message") continue;

		const message = record.message;
		if (typeof message !== "object" || message === null) continue;
		const role = (message as Record<string, unknown>).role;
		if (role !== "user" && role !== "assistant") continue;

		const text = messageText(record).trim();
		if (!text) continue;

		const limit = role === "user" ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS;
		messages.push({ role, text: text.slice(0, limit) });
	}

	return messages
		.slice(-MAX_MESSAGES)
		.map((message) => `${message.role}: ${message.text}`)
		.join("\n");
}

function walkSessionFiles(directory: string, found: string[] = []): string[] {
	let entries: Dirent[];
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch {
		return found;
	}

	for (const entry of entries) {
		const full = join(directory, entry.name);
		if (entry.isDirectory()) {
			walkSessionFiles(full, found);
		} else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
			found.push(full);
		}
	}
	return found;
}

export interface ListCandidateInput {
	cwd: string;
	agentDir: string;
	currentSessionFile: string | undefined;
	index: SessionIndex;
	maxSessions: number;
}

export function listCandidateSessions(
	input: ListCandidateInput,
): SessionFile[] {
	const projectFiles = walkSessionFiles(join(input.cwd, ".pi", "sessions"));
	const userFiles = walkSessionFiles(join(input.agentDir, "sessions")).filter(
		(path) => readSessionCwd(path) === input.cwd,
	);

	const seen = new Set<string>();
	const candidates: SessionFile[] = [];

	for (const path of [...projectFiles, ...userFiles]) {
		if (seen.has(path)) continue;
		seen.add(path);
		if (input.currentSessionFile && path === input.currentSessionFile) {
			continue;
		}

		let stat: ReturnType<typeof statSync>;
		try {
			stat = statSync(path);
		} catch {
			continue;
		}

		const indexed = input.index.files[path];
		if (indexed && stat.mtimeMs <= indexed.mtimeMs) continue;

		candidates.push({ path, mtimeMs: stat.mtimeMs, size: stat.size });
	}

	candidates.sort(
		(a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path),
	);
	return candidates.slice(0, input.maxSessions);
}

export interface PayloadResult {
	text: string;
	included: SessionFile[];
	deferred: string[];
}

export function buildPayload(
	files: SessionFile[],
	maxChars: number,
): PayloadResult {
	const blocks: string[] = [];
	const included: SessionFile[] = [];
	const deferred: string[] = [];
	let total = 0;

	for (const file of files) {
		let raw: string;
		try {
			raw = readFileSync(file.path, "utf-8");
		} catch {
			deferred.push(file.path);
			continue;
		}

		const condensed = condenseSession(raw);
		if (!condensed) {
			// Nothing to send, but the file is consumed.
			included.push(file);
			continue;
		}

		const block = `### session ${basename(file.path)} (${new Date(file.mtimeMs).toISOString()})\n${condensed}`;
		if (included.length > 0 && total + block.length > maxChars) {
			deferred.push(file.path);
			break;
		}

		blocks.push(block);
		included.push(file);
		total += block.length;
	}

	return { text: blocks.join("\n\n"), included, deferred };
}
