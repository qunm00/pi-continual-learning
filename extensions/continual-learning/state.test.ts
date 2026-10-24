import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	claimRun,
	getDefaultState,
	getIndexFilePath,
	getStateFilePath,
	loadIndex,
	loadState,
	mergeIndex,
	pruneIndex,
	reapStaleRun,
	releaseRun,
	saveIndex,
	saveState,
	updateState,
} from "./state.ts";
import type { SessionFile, SessionIndex } from "./types.ts";

function tempProject(): string {
	return mkdtempSync(join(tmpdir(), "cl-state-"));
}

function writeStateFile(cwd: string, value: unknown): void {
	const path = getStateFilePath(cwd);
	mkdirSync(join(cwd, ".pi", "state"), { recursive: true });
	writeFileSync(path, JSON.stringify(value), "utf-8");
}

const file = (path: string, mtimeMs: number, size = 10): SessionFile => ({
	path,
	mtimeMs,
	size,
});

test("getDefaultState returns version 2 with a zero counter and no in-flight run", () => {
	assert.deepEqual(getDefaultState(), {
		version: 2,
		sessionsSincePrompt: 0,
		lastCountedSessionFile: null,
		trialStartedAtMs: null,
		inFlight: null,
	});
});

test("loadState migrates a version 1 file and preserves trialStartedAtMs", () => {
	const cwd = tempProject();
	writeStateFile(cwd, {
		version: 1,
		lastRunAtMs: 123,
		turnsSinceLastRun: 7,
		lastSessionMtimeMs: 456,
		trialStartedAtMs: 789,
	});

	assert.deepEqual(loadState(cwd), {
		version: 2,
		sessionsSincePrompt: 0,
		lastCountedSessionFile: null,
		trialStartedAtMs: 789,
		inFlight: null,
	});
});

test("loadState falls back to defaults for corrupt JSON", () => {
	const cwd = tempProject();
	const path = getStateFilePath(cwd);
	mkdirSync(join(cwd, ".pi", "state"), { recursive: true });
	writeFileSync(path, "{not json", "utf-8");

	assert.deepEqual(loadState(cwd), getDefaultState());
});

test("saveState then loadState round-trips all fields", () => {
	const cwd = tempProject();
	const state = {
		version: 2 as const,
		sessionsSincePrompt: 3,
		lastCountedSessionFile: "/tmp/session.jsonl",
		trialStartedAtMs: 42,
		inFlight: { startedAtMs: 99, trigger: "manual" as const },
	};
	saveState(cwd, state);

	assert.deepEqual(loadState(cwd), state);
});

test("loadIndex returns an empty index when missing", () => {
	assert.deepEqual(loadIndex(tempProject()), { version: 1, files: {} });
});

test("mergeIndex records processed files", () => {
	const index: SessionIndex = { version: 1, files: {} };
	const merged = mergeIndex(
		index,
		[file("/a.jsonl", 100, 5), file("/b.jsonl", 200, 6)],
		1000,
	);

	assert.equal(merged.files["/a.jsonl"].mtimeMs, 100);
	assert.equal(merged.files["/a.jsonl"].size, 5);
	assert.equal(
		merged.files["/a.jsonl"].processedAt,
		"1970-01-01T00:00:01.000Z",
	);
	assert.deepEqual(Object.keys(merged.files).sort(), ["/a.jsonl", "/b.jsonl"]);
});

test("pruneIndex drops entries for deleted paths", () => {
	const index: SessionIndex = {
		version: 1,
		files: {
			"/a.jsonl": { mtimeMs: 1, size: 1, processedAt: "x" },
			"/b.jsonl": { mtimeMs: 1, size: 1, processedAt: "x" },
		},
	};

	assert.deepEqual(
		pruneIndex(index, (path) => path === "/a.jsonl"),
		{
			version: 1,
			files: { "/a.jsonl": { mtimeMs: 1, size: 1, processedAt: "x" } },
		},
	);
});

test("updateState serialises concurrent increments", async () => {
	const cwd = tempProject();

	await Promise.all([
		updateState(cwd, (state) => ({
			...state,
			sessionsSincePrompt: state.sessionsSincePrompt + 1,
		})),
		updateState(cwd, (state) => ({
			...state,
			sessionsSincePrompt: state.sessionsSincePrompt + 1,
		})),
	]);

	assert.equal(loadState(cwd).sessionsSincePrompt, 2);
});

test("claimRun allows one claim and rejects a second while in flight", async () => {
	const cwd = tempProject();

	assert.equal(await claimRun(cwd, "startup", 1000), true);
	assert.equal(await claimRun(cwd, "manual", 1001), false);
	assert.deepEqual(loadState(cwd).inFlight, {
		startedAtMs: 1000,
		trigger: "startup",
	});
});

test("releaseRun clears the in-flight claim", async () => {
	const cwd = tempProject();
	await claimRun(cwd, "startup", 1000);

	await releaseRun(cwd);

	assert.equal(loadState(cwd).inFlight, null);
});

test("reapStaleRun returns null for a fresh claim and clears a stale one", async () => {
	const cwd = tempProject();
	await claimRun(cwd, "startup", 1000);

	assert.equal(await reapStaleRun(cwd, 500, 1200), null);
	assert.notEqual(loadState(cwd).inFlight, null);

	assert.deepEqual(await reapStaleRun(cwd, 500, 2000), { startedAtMs: 1000 });
	assert.equal(loadState(cwd).inFlight, null);
});

test("saveIndex then loadIndex round-trips", () => {
	const cwd = tempProject();
	const index: SessionIndex = {
		version: 1,
		files: { "/a.jsonl": { mtimeMs: 1, size: 2, processedAt: "x" } },
	};
	saveIndex(cwd, index);

	assert.deepEqual(loadIndex(cwd), index);
	assert.equal(
		getIndexFilePath(cwd),
		join(cwd, ".pi", "state", "continual-learning-index.json"),
	);
});
