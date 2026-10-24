import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	DEFAULT_RUN_CONFIG,
	modelConfigPath,
	parseModelSpec,
	readModelConfig,
	readRunConfig,
} from "./config.ts";

function tempAgentDir(): string {
	return mkdtempSync(join(tmpdir(), "cl-config-"));
}

function writeConfig(agentDir: string, content: string): void {
	const path = modelConfigPath(agentDir);
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, content, "utf-8");
}

test("readRunConfig returns the documented defaults for an empty environment", () => {
	assert.deepEqual(readRunConfig({}), DEFAULT_RUN_CONFIG);
	assert.equal(DEFAULT_RUN_CONFIG.sessionInterval, 5);
	assert.equal(DEFAULT_RUN_CONFIG.timeoutMs, 600_000);
	assert.equal(DEFAULT_RUN_CONFIG.maxSessions, 20);
	assert.equal(DEFAULT_RUN_CONFIG.maxInputChars, 200_000);
	assert.equal(DEFAULT_RUN_CONFIG.trialEnabled, false);
	assert.equal(DEFAULT_RUN_CONFIG.trialSessions, 1);
	assert.equal(DEFAULT_RUN_CONFIG.trialDurationMinutes, 1440);
});

test("readRunConfig reads overrides and legacy aliases", () => {
	assert.deepEqual(
		readRunConfig({
			CONTINUAL_LEARNING_SESSION_INTERVAL: "3",
			CONTINUAL_LEARNING_TIMEOUT_MS: "1000",
			CONTINUAL_LEARNING_MAX_SESSIONS: "7",
			CONTINUAL_LEARNING_MAX_INPUT_CHARS: "5000",
			CONTINUAL_LEARNING_TRIAL_MODE: "yes",
			CONTINUAL_LEARNING_TRIAL_SESSIONS: "2",
			CONTINUAL_LEARNING_TRIAL_DURATION_MINUTES: "60",
		}),
		{
			sessionInterval: 3,
			timeoutMs: 1000,
			maxSessions: 7,
			maxInputChars: 5000,
			trialEnabled: true,
			trialSessions: 2,
			trialDurationMinutes: 60,
		},
	);

	assert.equal(
		readRunConfig({
			CONTINUOUS_LEARNING_SESSION_INTERVAL: "8",
			CONTINUOUS_LEARNING_TRIAL_MODE: "1",
		}).sessionInterval,
		8,
	);
});

test("readRunConfig falls back for invalid values", () => {
	const config = readRunConfig({
		CONTINUAL_LEARNING_SESSION_INTERVAL: "0",
		CONTINUAL_LEARNING_TIMEOUT_MS: "-5",
		CONTINUAL_LEARNING_MAX_SESSIONS: "abc",
		CONTINUAL_LEARNING_MAX_INPUT_CHARS: "",
	});

	assert.deepEqual(config, DEFAULT_RUN_CONFIG);
});

test("modelConfigPath lives beside the extension directory", () => {
	assert.equal(
		modelConfigPath("/home/user/.pi/agent"),
		join(
			"/home/user/.pi/agent",
			"extensions",
			"continual-learning",
			"config.json",
		),
	);
});

test("readModelConfig returns null when the file is missing", () => {
	assert.deepEqual(readModelConfig(tempAgentDir()), { ok: true, model: null });
});

test("readModelConfig reads the model and ignores unknown keys", () => {
	const agentDir = tempAgentDir();
	writeConfig(
		agentDir,
		JSON.stringify({ model: "anthropic/claude-haiku-4-5", other: 1 }),
	);

	assert.deepEqual(readModelConfig(agentDir), {
		ok: true,
		model: "anthropic/claude-haiku-4-5",
	});
});

test("readModelConfig treats an empty string or null as unset", () => {
	const empty = tempAgentDir();
	writeConfig(empty, JSON.stringify({ model: "" }));
	assert.deepEqual(readModelConfig(empty), { ok: true, model: null });

	const nulled = tempAgentDir();
	writeConfig(nulled, JSON.stringify({ model: null }));
	assert.deepEqual(readModelConfig(nulled), { ok: true, model: null });
});

test("readModelConfig rejects malformed JSON", () => {
	const result = readModelConfig(tempAgentDir());
	assert.equal(result.ok, true);

	const agentDir = tempAgentDir();
	writeConfig(agentDir, "{not json");
	const broken = readModelConfig(agentDir);
	assert.equal(broken.ok, false);
});

test("readModelConfig rejects non-string model values", () => {
	for (const model of [42, {}, []]) {
		const agentDir = tempAgentDir();
		writeConfig(agentDir, JSON.stringify({ model }));
		const result = readModelConfig(agentDir);
		assert.equal(
			result.ok,
			false,
			`model ${JSON.stringify(model)} must be rejected`,
		);
	}
});

test("readModelConfig rejects a non-object root", () => {
	const agentDir = tempAgentDir();
	writeConfig(agentDir, "[]");
	assert.equal(readModelConfig(agentDir).ok, false);
});

test("parseModelSpec splits at the first slash", () => {
	assert.deepEqual(parseModelSpec("a/b/c"), { provider: "a", id: "b/c" });
	assert.deepEqual(parseModelSpec("anthropic/claude-haiku-4-5"), {
		provider: "anthropic",
		id: "claude-haiku-4-5",
	});
});

test("parseModelSpec rejects values without a provider and id", () => {
	for (const spec of ["noslash", "/x", "x/", "", "  "]) {
		assert.equal(
			parseModelSpec(spec),
			null,
			`${JSON.stringify(spec)} must be rejected`,
		);
	}
});
