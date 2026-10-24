import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import {
	buildPayload,
	condenseSession,
	listCandidateSessions,
	readSessionCwd,
} from "./extract.ts";
import type { SessionFile, SessionIndex } from "./types.ts";

function tempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function header(cwd: string): string {
	return JSON.stringify({ type: "session", version: 3, cwd });
}

function message(role: string, text: string): string {
	return JSON.stringify({
		type: "message",
		message: { role, content: [{ type: "text", text }] },
	});
}

function writeSession(path: string, lines: string[], mtimeMs?: number): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, `${lines.join("\n")}\n`, "utf-8");
	if (mtimeMs !== undefined) {
		const seconds = mtimeMs / 1000;
		utimesSync(path, seconds, seconds);
	}
}

const emptyIndex = (): SessionIndex => ({ version: 1, files: {} });

test("readSessionCwd returns the header cwd and null for a malformed header", () => {
	const dir = tempDir("cl-extract-");
	const good = join(dir, "good.jsonl");
	writeSession(good, [header("/project/a"), message("user", "hi")]);

	assert.equal(readSessionCwd(good), "/project/a");

	const bad = join(dir, "bad.jsonl");
	writeSession(bad, ["{not json"]);
	assert.equal(readSessionCwd(bad), null);
});

test("condenseSession keeps user and assistant text and drops everything else", () => {
	const jsonl = [
		header("/project/a"),
		JSON.stringify({ type: "thinking", text: "secret" }),
		message("user", "keep the tests green"),
		JSON.stringify({
			type: "message",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "hidden" },
					{ type: "text", text: "will do" },
					{ type: "toolCall", name: "bash", arguments: {} },
				],
			},
		}),
		JSON.stringify({
			type: "message",
			message: {
				role: "tool",
				content: [{ type: "text", text: "tool output" }],
			},
		}),
		JSON.stringify({
			type: "message",
			message: {
				role: "user",
				content: [{ type: "image", data: "base64" }],
			},
		}),
	].join("\n");

	const condensed = condenseSession(jsonl);

	assert.match(condensed, /user: keep the tests green/);
	assert.match(condensed, /assistant: will do/);
	assert.doesNotMatch(condensed, /secret|hidden|tool output|bash/);
});

test("condenseSession truncates long user and assistant messages", () => {
	const condensed = condenseSession(
		[
			message("user", "u".repeat(3000)),
			message("assistant", "a".repeat(2000)),
		].join("\n"),
	);
	const userLine = condensed
		.split("\n")
		.find((line) => line.startsWith("user: "));
	const assistantLine = condensed
		.split("\n")
		.find((line) => line.startsWith("assistant: "));

	assert.equal(userLine?.length, "user: ".length + 2048);
	assert.equal(assistantLine?.length, "assistant: ".length + 1024);
});

test("condenseSession keeps only the last 40 messages", () => {
	const lines = Array.from({ length: 50 }, (_, i) => message("user", `m${i}`));

	const condensed = condenseSession(lines.join("\n"));
	const kept = condensed
		.split("\n")
		.filter((line) => line.startsWith("user: "));

	assert.equal(kept.length, 40);
	assert.equal(kept[0], "user: m10");
	assert.equal(kept.at(-1), "user: m49");
});

test("condenseSession returns an empty string for empty or truncated JSONL", () => {
	assert.equal(condenseSession(""), "");
	assert.equal(condenseSession(`${header("/p")}\n{"type":"message"`), "");
});

test("listCandidateSessions skips unchanged files, the current session, and other projects", () => {
	const cwd = tempDir("cl-cwd-");
	const agentDir = tempDir("cl-agent-");

	const changed = join(cwd, ".pi", "sessions", "changed.jsonl");
	const unchanged = join(cwd, ".pi", "sessions", "unchanged.jsonl");
	const current = join(cwd, ".pi", "sessions", "current.jsonl");
	const otherProject = join(agentDir, "sessions", "other", "session.jsonl");
	const sameProject = join(agentDir, "sessions", "same", "session.jsonl");

	writeSession(changed, [header(cwd)], 1000);
	writeSession(unchanged, [header(cwd)], 1000);
	writeSession(current, [header(cwd)], 1000);
	writeSession(otherProject, [header("/somewhere/else")], 1000);
	writeSession(sameProject, [header(cwd)], 1000);

	const index: SessionIndex = {
		version: 1,
		files: {
			[unchanged]: { mtimeMs: 999_999_999, size: 1, processedAt: "x" },
		},
	};

	const files = listCandidateSessions({
		cwd,
		agentDir,
		currentSessionFile: current,
		index,
		maxSessions: 20,
	});
	const paths = files.map((file) => file.path);

	assert.ok(paths.includes(changed));
	assert.ok(paths.includes(sameProject));
	assert.ok(!paths.includes(unchanged));
	assert.ok(!paths.includes(current));
	assert.ok(!paths.includes(otherProject));
});

test("listCandidateSessions sorts oldest first and caps the count", () => {
	const cwd = tempDir("cl-cwd-");
	const agentDir = tempDir("cl-agent-");

	for (const [name, mtime] of [
		["old.jsonl", 1000],
		["mid.jsonl", 2000],
		["new.jsonl", 3000],
	] as const) {
		writeSession(join(cwd, ".pi", "sessions", name), [header(cwd)], mtime);
	}

	const files = listCandidateSessions({
		cwd,
		agentDir,
		currentSessionFile: undefined,
		index: emptyIndex(),
		maxSessions: 2,
	});

	assert.deepEqual(
		files.map((file) => basename(file.path)),
		["old.jsonl", "mid.jsonl"],
	);
});

test("buildPayload includes whole files only and defers the overflow", () => {
	const dir = tempDir("cl-payload-");
	const small = join(dir, "small.jsonl");
	const big = join(dir, "big.jsonl");
	writeSession(small, [message("user", "a".repeat(100))], 1000);
	writeSession(big, [message("user", "b".repeat(100))], 2000);

	const files: SessionFile[] = [
		{ path: small, mtimeMs: 1000, size: 200 },
		{ path: big, mtimeMs: 2000, size: 200 },
	];
	const result = buildPayload(files, 200);

	assert.equal(result.included.length, 1);
	assert.equal(result.included[0].path, small);
	assert.deepEqual(result.deferred, [big]);
	assert.match(result.text, /a{100}/);
	assert.doesNotMatch(result.text, /b{100}/);
});

test("buildPayload includes the first file even when it alone exceeds the cap", () => {
	const dir = tempDir("cl-payload-");
	const file = join(dir, "only.jsonl");
	writeSession(file, [message("user", "c".repeat(500))], 1000);

	const result = buildPayload([{ path: file, mtimeMs: 1000, size: 600 }], 10);

	assert.equal(result.included.length, 1);
	assert.deepEqual(result.deferred, []);
});
