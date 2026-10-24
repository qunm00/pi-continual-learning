import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { modelConfigPath } from "./config.ts";
import { type CompleteFn, callModel, resolveModel } from "./model.ts";

const fakeModel = { provider: "p", id: "m" } as unknown as Model<Api>;
const otherModel = { provider: "p", id: "other" } as unknown as Model<Api>;

function tempAgentDir(): string {
	return mkdtempSync(join(tmpdir(), "cl-model-"));
}

function writeConfig(agentDir: string, content: string): void {
	const path = modelConfigPath(agentDir);
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, content, "utf-8");
}

test("resolveModel prefers a configured model found in the registry", () => {
	const agentDir = tempAgentDir();
	writeConfig(agentDir, JSON.stringify({ model: "p/m" }));

	const result = resolveModel({
		agentDir,
		sessionModel: otherModel,
		registry: {
			find: (provider, id) =>
				provider === "p" && id === "m" ? fakeModel : undefined,
		},
	});

	assert.deepEqual(result, { ok: true, model: fakeModel, source: "config" });
});

test("resolveModel falls back to the session model when the file or key is absent", () => {
	const result = resolveModel({
		agentDir: tempAgentDir(),
		sessionModel: otherModel,
		registry: { find: () => undefined },
	});

	assert.deepEqual(result, { ok: true, model: otherModel, source: "session" });
});

test("resolveModel returns bad-config for a malformed file", () => {
	const agentDir = tempAgentDir();
	writeConfig(agentDir, "{not json");

	const result = resolveModel({
		agentDir,
		sessionModel: otherModel,
		registry: { find: () => undefined },
	});

	assert.equal(result.ok, false);
	assert.equal(result.ok === false && result.reason, "bad-config");
});

test("resolveModel returns no-model when a configured model is unknown", () => {
	const agentDir = tempAgentDir();
	writeConfig(agentDir, JSON.stringify({ model: "p/missing" }));

	const result = resolveModel({
		agentDir,
		sessionModel: otherModel,
		registry: { find: () => undefined },
	});

	assert.equal(result.ok, false);
	assert.equal(result.ok === false && result.reason, "no-model");
});

test("resolveModel returns no-model when neither source exists", () => {
	const result = resolveModel({
		agentDir: tempAgentDir(),
		sessionModel: undefined,
		registry: { find: () => undefined },
	});

	assert.equal(result.ok, false);
	assert.equal(result.ok === false && result.reason, "no-model");
});

test("callModel concatenates text blocks and reports usage", async () => {
	let receivedOptions: Record<string, unknown> | undefined;
	const completeFn = (async (
		_model: unknown,
		_context: unknown,
		options: Record<string, unknown>,
	) => {
		receivedOptions = options;
		return {
			content: [
				{ type: "text", text: "first" },
				{ type: "thinking", thinking: "hidden" },
				{ type: "text", text: "second" },
			],
			usage: {
				input: 10,
				output: 5,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 15,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
			},
		};
	}) as unknown as CompleteFn;

	const result = await callModel({
		model: fakeModel,
		auth: { apiKey: "key" },
		prompt: "hello",
		signal: AbortSignal.timeout(1000),
		completeFn,
	});

	assert.equal(result.text, "first\nsecond");
	assert.deepEqual(result.usage, { input: 10, output: 5, cost: 0.01 });
	assert.equal(receivedOptions?.apiKey, "key");
});

test("callModel returns empty text when the response has no text blocks", async () => {
	const completeFn = (async () => ({
		content: [{ type: "thinking", thinking: "only thinking" }],
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	})) as unknown as CompleteFn;

	const result = await callModel({
		model: fakeModel,
		auth: {},
		prompt: "hello",
		signal: AbortSignal.timeout(1000),
		completeFn,
	});

	assert.equal(result.text, "");
});
