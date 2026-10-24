import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import createExtension from "./index.ts";
import { appendLog, readLog } from "./log.ts";
import {
	hashContent,
	readProposal,
	writeProposal,
} from "./proposals.ts";
import { getStateFilePath, loadState } from "./state.ts";

const fakeModel = { provider: "p", id: "m" } as unknown as Model<Api>;
const NOW = 1_700_000_000_000;

interface Harness {
	handlers: Map<string, (event: unknown, ctx: ExtensionContext) => unknown>;
	commands: Map<string, (args: string, ctx: ExtensionContext) => unknown>;
	messages: unknown[];
	api: ExtensionAPI;
}

function harness(): Harness {
	const handlers = new Map();
	const commands = new Map();
	const messages: unknown[] = [];
	const api = {
		on: (event: string, handler: never) => handlers.set(event, handler),
		registerCommand: (
			name: string,
			options: { handler: (args: string, ctx: ExtensionContext) => unknown },
		) => commands.set(name, options.handler),
		sendMessage: (message: unknown) => messages.push(message),
		exec: async () => ({ stdout: "diff", stderr: "", code: 1, killed: false }),
	} as unknown as ExtensionAPI;
	(createExtension as ExtensionFactory)(api);
	return { handlers, commands, messages, api };
}

interface CtxOptions {
	cwd: string;
	sessionFile?: string;
	confirm?: boolean;
	model?: Model<Api> | undefined;
	findModel?: boolean;
}

function context(options: CtxOptions): {
	ctx: ExtensionContext;
	notifications: string[];
} {
	const notifications: string[] = [];
	const ctx = {
		cwd: options.cwd,
		hasUI: true,
		mode: "tui",
		model: options.model === undefined ? fakeModel : options.model,
		modelRegistry: {
			find: () => (options.findModel === false ? undefined : fakeModel),
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "key" }),
		},
		sessionManager: {
			getSessionFile: () => options.sessionFile ?? join(options.cwd, "s.jsonl"),
		},
		ui: {
			confirm: async () => options.confirm ?? true,
			notify: (message: string) => notifications.push(message),
		},
	} as unknown as ExtensionContext;
	return { ctx, notifications };
}

function tempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function message(role: string, text: string): string {
	return JSON.stringify({
		type: "message",
		message: { role, content: [{ type: "text", text }] },
	});
}

function writeSession(cwd: string): string {
	const path = join(cwd, ".pi", "sessions", "s1.jsonl");
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(
		path,
		`${JSON.stringify({ type: "session", cwd })}\n${message("user", "I prefer pnpm")}\n`,
		"utf-8",
	);
	return path;
}

async function waitFor(
	predicate: () => boolean,
	timeoutMs = 3000,
): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("timed out waiting for the background run");
}

function writeModelConfig(agentDir: string, model: string): void {
	const directory = join(agentDir, "extensions", "continual-learning");
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, "config.json"),
		JSON.stringify({ model }),
		"utf-8",
	);
}

function withEnv<T>(
	values: Record<string, string>,
	fn: () => Promise<T>,
): Promise<T> {
	const previous = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(values)) {
		previous.set(key, process.env[key]);
		process.env[key] = value;
	}
	return fn().finally(() => {
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});
}

test("session_start asks at the cadence and starts a background run", async () => {
	const cwd = tempDir("cl-index-");
	const agentDir = tempDir("cl-agent-");
	const sessionFile = writeSession(cwd);
	writeFileSync(
		join(cwd, "AGENTS.md"),
		"## Learned User Preferences\n",
		"utf-8",
	);
	writeModelConfig(agentDir, "p/m");

	await withEnv(
		{
			PI_CODING_AGENT_DIR: agentDir,
			CONTINUAL_LEARNING_SESSION_INTERVAL: "1",
		},
		async () => {
			const { handlers } = harness();
			const { ctx } = context({ cwd, sessionFile, findModel: false });

			await handlers.get("session_start")?.(
				{ type: "session_start", reason: "startup" },
				ctx,
			);

			assert.equal(loadState(cwd).sessionsSincePrompt, 0);
			await waitFor(
				() => readLog(cwd, 10).length > 0 && loadState(cwd).inFlight === null,
			);

			const record = readLog(cwd, 10)[0];
			assert.equal(record.type === "run" && record.outcome, "failed");
			assert.equal(record.type === "run" && record.reason, "no-model");
			assert.equal(loadState(cwd).inFlight, null);
		},
	);
});

test("declining resets the counter and logs a declined record", async () => {
	const cwd = tempDir("cl-index-");
	const agentDir = tempDir("cl-agent-");
	const sessionFile = writeSession(cwd);

	await withEnv(
		{
			PI_CODING_AGENT_DIR: agentDir,
			CONTINUAL_LEARNING_SESSION_INTERVAL: "1",
		},
		async () => {
			const { handlers } = harness();
			const { ctx } = context({ cwd, sessionFile, confirm: false });

			await handlers.get("session_start")?.(
				{ type: "session_start", reason: "startup" },
				ctx,
			);

			const record = readLog(cwd, 10)[0];
			assert.equal(record.type, "declined");
			assert.equal(loadState(cwd).sessionsSincePrompt, 0);
			assert.equal(loadState(cwd).inFlight, null);
		},
	);
});

test("resume and reload do not count or ask", async () => {
	const cwd = tempDir("cl-index-");
	const agentDir = tempDir("cl-agent-");
	const sessionFile = writeSession(cwd);

	await withEnv(
		{
			PI_CODING_AGENT_DIR: agentDir,
			CONTINUAL_LEARNING_SESSION_INTERVAL: "1",
		},
		async () => {
			const { handlers } = harness();
			const { ctx } = context({ cwd, sessionFile });

			await handlers.get("session_start")?.(
				{ type: "session_start", reason: "resume" },
				ctx,
			);
			await handlers.get("session_start")?.(
				{ type: "session_start", reason: "reload" },
				ctx,
			);

			assert.equal(loadState(cwd).sessionsSincePrompt, 0);
			assert.equal(readLog(cwd, 10).length, 0);
		},
	);
});

test("apply writes AGENTS.md, deletes the proposal, and logs it", async () => {
	const cwd = tempDir("cl-index-");
	const agentDir = tempDir("cl-agent-");
	const current =
		"## Learned User Preferences\n- old\n\n## Learned Workspace Facts\n";
	const proposal =
		"## Learned User Preferences\n- new\n\n## Learned Workspace Facts\n";
	writeFileSync(join(cwd, "AGENTS.md"), current, "utf-8");
	const proposalFile = writeProposal(cwd, proposal);
	appendLog(cwd, {
		type: "run",
		at: new Date(NOW).toISOString(),
		trigger: "startup",
		model: "p/m",
		startedAt: new Date(NOW).toISOString(),
		finishedAt: new Date(NOW).toISOString(),
		durationMs: 1,
		sessions: [],
		deferred: [],
		outcome: "proposal",
		proposalPath: proposalFile,
		baseAgentsSha256: hashContent(current),
		proposalSha256: hashContent(proposal),
	});

	await withEnv({ PI_CODING_AGENT_DIR: agentDir }, async () => {
		const { commands } = harness();
		const { ctx, notifications } = context({ cwd });

		await commands.get("continual-learning")?.("apply", ctx);

		assert.equal(readFileSync(join(cwd, "AGENTS.md"), "utf-8"), proposal);
		assert.equal(readProposal(cwd), null);
		assert.ok(readLog(cwd, 10).some((record) => record.type === "applied"));
		assert.ok(notifications.some((text) => text.includes("applied")));
	});
});

test("apply with no proposal notifies and changes nothing", async () => {
	const cwd = tempDir("cl-index-");
	const agentDir = tempDir("cl-agent-");

	await withEnv({ PI_CODING_AGENT_DIR: agentDir }, async () => {
		const { commands } = harness();
		const { ctx, notifications } = context({ cwd });

		await commands.get("continual-learning")?.("apply", ctx);

		assert.equal(notifications.length, 1);
		assert.match(notifications[0], /No proposal waiting/);
	});
});

test("log renders recent runs through sendMessage", async () => {
	const cwd = tempDir("cl-index-");
	const agentDir = tempDir("cl-agent-");
	appendLog(cwd, {
		type: "declined",
		at: new Date(NOW).toISOString(),
		sessionsSincePrompt: 5,
	});

	await withEnv({ PI_CODING_AGENT_DIR: agentDir }, async () => {
		const { commands, messages } = harness();
		const { ctx } = context({ cwd });

		await commands.get("continual-learning")?.("log", ctx);

		assert.equal(messages.length, 1);
		assert.match((messages[0] as { content: string }).content, /declined/);
	});
});

test("the state file stays inside the project", () => {
	const cwd = tempDir("cl-index-");
	assert.ok(getStateFilePath(cwd).startsWith(cwd));
});
