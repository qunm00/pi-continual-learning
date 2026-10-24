/**
 * Local run log: one JSON object per line, append-only, newest 200 kept.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LogRecord } from "./types.ts";

const MAX_RECORDS = 200;

export function getLogPath(cwd: string): string {
	return join(cwd, ".pi", "state", "continual-learning-runs.jsonl");
}

function parseLine(line: string): LogRecord | null {
	if (!line.trim()) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;

	const record = parsed as Record<string, unknown>;
	if (typeof record.at !== "string") return null;
	if (
		record.type !== "run" &&
		record.type !== "declined" &&
		record.type !== "aborted" &&
		record.type !== "applied"
	) {
		return null;
	}
	return record as unknown as LogRecord;
}

function readLines(path: string): string[] {
	if (!existsSync(path)) return [];
	try {
		return readFileSync(path, "utf-8").split("\n");
	} catch {
		return [];
	}
}

export function appendLog(cwd: string, record: LogRecord): void {
	const path = getLogPath(cwd);
	const lines = readLines(path).filter((line) => line.trim());
	lines.push(JSON.stringify(record));

	const kept = lines.slice(-MAX_RECORDS);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${kept.join("\n")}\n`, "utf-8");
}

export function readLog(cwd: string, limit: number): LogRecord[] {
	const records: LogRecord[] = [];
	for (const line of readLines(getLogPath(cwd))) {
		const record = parseLine(line);
		if (record) records.push(record);
	}
	return records.slice(-limit);
}

function stamp(at: string): string {
	return at.slice(0, 16).replace("T", " ");
}

function formatRecord(record: LogRecord): string {
	switch (record.type) {
		case "run": {
			const change = record.changes
				? ` (+${record.changes.added}/~${record.changes.updated}/-${record.changes.removed})`
				: "";
			const reason = record.reason ? ` ${record.reason}` : "";
			return `- ${stamp(record.at)} ${record.trigger} ${record.outcome}${change}${reason} ${record.model}`;
		}
		case "declined":
			return `- ${stamp(record.at)} declined (${record.sessionsSincePrompt} sessions)`;
		case "aborted":
			return `- ${stamp(record.at)} aborted (started ${stamp(record.startedAt)})`;
		case "applied":
			return `- ${stamp(record.at)} applied ${record.proposalPath}`;
	}
}

export function formatLog(records: LogRecord[]): string {
	return [...records].reverse().map(formatRecord).join("\n");
}
