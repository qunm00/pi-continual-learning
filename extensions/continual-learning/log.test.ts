import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendLog, formatLog, getLogPath, readLog } from "./log.ts";
import type { LogRecord } from "./types.ts";

function tempProject(): string {
	return mkdtempSync(join(tmpdir(), "cl-log-"));
}

const runRecord = (
	at: string,
	outcome: "proposal" | "no-change" | "failed",
): LogRecord => ({
	type: "run",
	at,
	trigger: "startup",
	model: "anthropic/claude-haiku-4-5",
	startedAt: at,
	finishedAt: at,
	durationMs: 1000,
	sessions: [{ path: "/s.jsonl", mtimeMs: 1, size: 2 }],
	deferred: [],
	outcome,
});

test("appendLog then readLog returns records newest last", () => {
	const cwd = tempProject();
	appendLog(cwd, runRecord("2024-05-01T12:00:00.000Z", "proposal"));
	appendLog(cwd, runRecord("2024-05-02T12:00:00.000Z", "no-change"));

	const records = readLog(cwd, 10);

	assert.equal(records.length, 2);
	assert.equal(records[0].type === "run" && records[0].outcome, "proposal");
	assert.equal(records[1].type === "run" && records[1].outcome, "no-change");
});

test("appendLog keeps only the newest 200 records", () => {
	const cwd = tempProject();
	for (let i = 0; i < 205; i++) {
		appendLog(
			cwd,
			runRecord(
				new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString(),
				"proposal",
			),
		);
	}

	const records = readLog(cwd, 1000);

	assert.equal(records.length, 200);
	assert.equal(
		records[0].type === "run" && records[0].at,
		"2024-01-01T00:00:05.000Z",
	);
});

test("readLog skips malformed lines", () => {
	const cwd = tempProject();
	const path = getLogPath(cwd);
	mkdirSync(join(cwd, ".pi", "state"), { recursive: true });
	writeFileSync(
		path,
		`{not json\n${JSON.stringify(runRecord("2024-05-01T12:00:00.000Z", "proposal"))}\n{"type":"unknown"}\n`,
		"utf-8",
	);

	const records = readLog(cwd, 10);

	assert.equal(records.length, 1);
	assert.equal(records[0].type, "run");
});

test("readLog returns an empty array when the file is missing", () => {
	assert.deepEqual(readLog(tempProject(), 10), []);
});

test("formatLog renders a markdown line per record with date, trigger, and outcome", () => {
	const text = formatLog([
		runRecord("2024-05-01T12:00:00.000Z", "proposal"),
		{
			type: "declined",
			at: "2024-05-02T13:00:00.000Z",
			sessionsSincePrompt: 5,
		},
		{
			type: "aborted",
			at: "2024-05-03T14:00:00.000Z",
			startedAt: "2024-05-03T13:00:00.000Z",
		},
		{
			type: "applied",
			at: "2024-05-04T15:00:00.000Z",
			proposalPath: "/p/AGENTS.proposal.md",
			proposalSha256: "abc",
		},
	]);

	const lines = text.split("\n");

	assert.equal(lines.length, 4);
	assert.match(lines[0], /^- 2024-05-04 15:00 applied/);
	assert.match(lines[1], /^- 2024-05-03 14:00 aborted/);
	assert.match(lines[2], /^- 2024-05-02 13:00 declined/);
	assert.match(lines[3], /^- 2024-05-01 12:00 startup proposal/);
});
