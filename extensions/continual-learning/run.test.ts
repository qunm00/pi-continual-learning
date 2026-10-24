import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { readLog } from "./log.ts";
import type { CompleteFn } from "./model.ts";
import { readProposal } from "./proposals.ts";
import { type RunInput, runOnce } from "./run.ts";
import { claimRun, getStateFilePath, loadIndex, loadState } from "./state.ts";
import type { RunConfig } from "./types.ts";

const NOW = 1_700_000_000_000;
const fakeModel = { provider: "p", id: "m" } as unknown as Model<Api>;

const config: RunConfig = {
	sessionInterval: 5,
	timeoutMs: 60_000,
	maxSessions: 20,
	maxInputChars: 200_000,
	trialEnabled: false,
	trialSessions: 1,
	trialDurationMinutes: 1440,
};

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

function writeSession(
	cwd: string,
	name: string,
	lines: string[],
	mtimeMs: number,
): string {
	const path = join(cwd, ".pi", "sessions", name);
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, `${lines.join("\n")}\n`, "utf-8");
	const seconds = mtimeMs / 1000;
	utimesSync(path, seconds, seconds);
	return path;
}

function learned(prefs: string[], facts: string[]): string {
	return [
		"## Learned User Preferences",
		...prefs.map((entry) => `- ${entry}`),
		"",
		"## Learned Workspace Facts",
		...facts.map((entry) => `- ${entry}`),
		"",
	].join("\n");
}

function writeRules(): string {
	const path = join(tempDir("cl-rules-"), "rules.md");
	writeFileSync(path, "RULES", "utf-8");
	return path;
}

function reply(text: string): CompleteFn {
	return (async () => ({
		content: [{ type: "text", text }],
		usage: {
			input: 10,
			output: 5,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 15,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
		},
	})) as unknown as CompleteFn;
}

function input(overrides: Partial<RunInput> = {}): RunInput {
	return {
		cwd: tempDir("cl-run-"),
		agentDir: tempDir("cl-agent-"),
		currentSessionFile: undefined,
		trigger: "startup",
		config,
		sessionModel: fakeModel,
		registry: {
			find: () => fakeModel,
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "key" }),
		},
		rulesPath: writeRules(),
		now: () => NOW,
		completeFn: reply(
			`Summary\n\n\`\`\`markdown\n${learned(["prefer pnpm"], ["uses Biome"])}\`\`\``,
		),
		...overrides,
	};
}

test("runOnce writes a proposal and a run record on success", async () => {
	const cwd = tempDir("cl-run-");
	const agents = learned(["old preference"], []);
	writeFileSync(join(cwd, "AGENTS.md"), agents, "utf-8");
	writeSession(
		cwd,
		"s1.jsonl",
		[header(cwd), message("user", "I prefer pnpm")],
		NOW - 1000,
	);

	const result = await runOnce(input({ cwd }));

	assert.equal(result.outcome, "proposal");
	assert.match(readProposal(cwd) ?? "", /prefer pnpm/);
	assert.equal(readFileSync(join(cwd, "AGENTS.md"), "utf-8"), agents);

	const records = readLog(cwd, 10);
	assert.equal(records.length, 1);
	assert.equal(records[0].type === "run" && records[0].outcome, "proposal");
	assert.equal(records[0].type === "run" && records[0].trigger, "startup");
});

test("runOnce updates the index only for sessions it processed", async () => {
	const cwd = tempDir("cl-run-");
	const first = writeSession(
		cwd,
		"s1.jsonl",
		[header(cwd), message("user", "a")],
		NOW - 2000,
	);
	const second = writeSession(
		cwd,
		"s2.jsonl",
		[header(cwd), message("user", "b")],
		NOW - 1000,
	);

	await runOnce(input({ cwd }));

	const index = loadIndex(cwd);
	assert.ok(index.files[first]);
	assert.ok(index.files[second]);
});

test("runOnce returns no-change and still refreshes the index", async () => {
	const cwd = tempDir("cl-run-");
	const session = writeSession(
		cwd,
		"s1.jsonl",
		[header(cwd), message("user", "a")],
		NOW - 1000,
	);

	const result = await runOnce(
		input({ cwd, completeFn: reply("No high-signal memory updates.") }),
	);

	assert.equal(result.outcome, "no-change");
	assert.equal(readProposal(cwd), null);
	assert.ok(loadIndex(cwd).files[session]);
	const record = readLog(cwd, 10)[0];
	assert.equal(record.type === "run" && record.outcome, "no-change");
});

test("runOnce returns failed and leaves the index untouched when the model cannot be resolved", async () => {
	const cwd = tempDir("cl-run-");
	writeSession(
		cwd,
		"s1.jsonl",
		[header(cwd), message("user", "a")],
		NOW - 1000,
	);
	let called = false;
	const result = await runOnce(
		input({
			cwd,
			sessionModel: undefined,
			registry: {
				find: () => undefined,
				getApiKeyAndHeaders: async () => ({ ok: false, error: "no key" }),
			},
			completeFn: (async () => {
				called = true;
				throw new Error("must not be called");
			}) as unknown as CompleteFn,
		}),
	);

	assert.equal(result.outcome, "failed");
	assert.equal(result.outcome === "failed" && result.reason, "no-model");
	assert.equal(called, false);
	assert.deepEqual(loadIndex(cwd), { version: 1, files: {} });
});

test("runOnce returns failed and releases the claim when completeFn rejects", async () => {
	const cwd = tempDir("cl-run-");
	writeSession(
		cwd,
		"s1.jsonl",
		[header(cwd), message("user", "a")],
		NOW - 1000,
	);
	await claimRun(cwd, "startup", NOW);

	const result = await runOnce(
		input({
			cwd,
			completeFn: (async () => {
				throw new Error("provider exploded");
			}) as unknown as CompleteFn,
		}),
	);

	assert.equal(result.outcome, "failed");
	assert.equal(result.outcome === "failed" && result.reason, "call-failed");
	assert.equal(loadState(cwd).inFlight, null);
});

test("runOnce writes no proposal when validation rejects the output", async () => {
	const cwd = tempDir("cl-run-");
	writeFileSync(join(cwd, "AGENTS.md"), "# Notes\n\nhand written\n", "utf-8");
	writeSession(
		cwd,
		"s1.jsonl",
		[header(cwd), message("user", "a")],
		NOW - 1000,
	);

	const result = await runOnce(input({ cwd }));

	assert.equal(result.outcome, "failed");
	assert.equal(result.outcome === "failed" && result.reason, "invalid-output");
	assert.equal(readProposal(cwd), null);
	assert.ok(existsSync(join(cwd, ".pi", "state", "proposals")));
});

test("runOnce defers files beyond the payload cap and logs them", async () => {
	const cwd = tempDir("cl-run-");
	writeSession(
		cwd,
		"s1.jsonl",
		[header(cwd), message("user", "a".repeat(100))],
		NOW - 2000,
	);
	const second = writeSession(
		cwd,
		"s2.jsonl",
		[header(cwd), message("user", "b".repeat(100))],
		NOW - 1000,
	);

	await runOnce(input({ cwd, config: { ...config, maxInputChars: 10 } }));

	const record = readLog(cwd, 10)[0];
	assert.equal(record.type, "run");
	assert.deepEqual(record.type === "run" && record.deferred, [second]);
});

test("runOnce releases an existing claim on success", async () => {
	const cwd = tempDir("cl-run-");
	writeSession(
		cwd,
		"s1.jsonl",
		[header(cwd), message("user", "a")],
		NOW - 1000,
	);
	await claimRun(cwd, "manual", NOW);

	await runOnce(input({ cwd, trigger: "manual" }));

	assert.equal(loadState(cwd).inFlight, null);
	assert.equal(existsSync(getStateFilePath(cwd)), true);
});
