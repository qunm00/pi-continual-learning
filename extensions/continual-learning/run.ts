/**
 * One-shot run orchestration: read sessions, call the model, validate, write
 * the proposal and the log. The caller holds the in-flight claim; this module
 * always releases it.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { buildPayload, listCandidateSessions } from "./extract.ts";
import { appendLog } from "./log.ts";
import { type CompleteFn, callModel, resolveModel } from "./model.ts";
import {
	buildPrompt,
	countChanges,
	parseProposalResponse,
	validateProposal,
} from "./prompt.ts";
import { hashContent, writeProposal } from "./proposals.ts";
import {
	loadIndex,
	mergeIndex,
	pruneIndex,
	releaseRun,
	saveIndex,
} from "./state.ts";
import type { RunConfig, RunRecord, Trigger } from "./types.ts";

const REJECTED_KEPT = 5;

export interface RunRegistry {
	find(provider: string, id: string): Model<Api> | undefined;
	getApiKeyAndHeaders(model: Model<Api>): Promise<{
		ok: boolean;
		apiKey?: string;
		headers?: Record<string, string>;
		env?: Record<string, string>;
		error?: string;
	}>;
}

export interface RunInput {
	cwd: string;
	agentDir: string;
	currentSessionFile: string | undefined;
	trigger: Trigger;
	config: RunConfig;
	sessionModel: Model<Api> | undefined;
	registry: RunRegistry;
	rulesPath: string;
	now: () => number;
	completeFn?: CompleteFn;
}

export type RunOutcome =
	| { outcome: "proposal"; proposalPath: string }
	| { outcome: "no-change" }
	| { outcome: "failed"; reason: string; detail?: string };

function readOptional(path: string): string | null {
	if (!existsSync(path)) return null;
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return null;
	}
}

function keepNewestRejected(cwd: string): void {
	const directory = join(cwd, ".pi", "state", "proposals");
	let names: string[];
	try {
		names = readdirSync(directory).filter((name) =>
			name.startsWith("rejected-"),
		);
	} catch {
		return;
	}
	names.sort();
	for (const name of names.slice(
		0,
		Math.max(0, names.length - REJECTED_KEPT),
	)) {
		try {
			rmSync(join(directory, name), { force: true });
		} catch {
			// A leftover dump is harmless.
		}
	}
}

function writeRejected(cwd: string, text: string, nowMs: number): void {
	const directory = join(cwd, ".pi", "state", "proposals");
	mkdirSync(directory, { recursive: true });
	const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, "-");
	writeFileSync(join(directory, `rejected-${stamp}.txt`), text, "utf-8");
	keepNewestRejected(cwd);
}

export async function runOnce(input: RunInput): Promise<RunOutcome> {
	const startedAtMs = input.now();
	const agentsPath = join(input.cwd, "AGENTS.md");
	const agentsMd = readOptional(agentsPath);
	const baseAgentsSha256 = hashContent(agentsMd ?? "");

	const base = (
		overrides: Partial<RunRecord> = {},
	): Omit<RunRecord, "type"> => {
		const finishedAtMs = input.now();
		return {
			at: new Date(finishedAtMs).toISOString(),
			trigger: input.trigger,
			model: "",
			startedAt: new Date(startedAtMs).toISOString(),
			finishedAt: new Date(finishedAtMs).toISOString(),
			durationMs: finishedAtMs - startedAtMs,
			sessions: [],
			deferred: [],
			outcome: "failed",
			baseAgentsSha256,
			...overrides,
		};
	};

	const fail = (reason: string, detail?: string): RunOutcome => {
		appendLog(input.cwd, {
			type: "run",
			...base({ outcome: "failed", reason, error: detail }),
		});
		return { outcome: "failed", reason, detail };
	};

	try {
		const rules = readOptional(input.rulesPath);
		if (rules === null) return fail("no-rules", input.rulesPath);

		const resolved = resolveModel({
			agentDir: input.agentDir,
			sessionModel: input.sessionModel,
			registry: input.registry,
		});
		if (!resolved.ok) return fail(resolved.reason, resolved.detail);

		const modelName = `${resolved.model.provider}/${resolved.model.id}`;

		const auth = await input.registry.getApiKeyAndHeaders(resolved.model);
		if (!auth.ok) return fail("no-model", auth.error ?? "no auth for model");

		const index = loadIndex(input.cwd);
		const candidates = listCandidateSessions({
			cwd: input.cwd,
			agentDir: input.agentDir,
			currentSessionFile: input.currentSessionFile,
			index,
			maxSessions: input.config.maxSessions,
		});

		if (candidates.length === 0) {
			appendLog(input.cwd, {
				type: "run",
				...base({ model: modelName, outcome: "no-change" }),
			});
			return { outcome: "no-change" };
		}

		const payload = buildPayload(candidates, input.config.maxInputChars);
		const prompt = buildPrompt({
			rules,
			agentsMd,
			sessions: payload.text,
		});

		const response = await callModel({
			model: resolved.model,
			auth: { apiKey: auth.apiKey, headers: auth.headers, env: auth.env },
			prompt,
			signal: AbortSignal.timeout(input.config.timeoutMs),
			completeFn: input.completeFn,
		});

		const parsed = parseProposalResponse(response.text);
		if (parsed.kind === "invalid") {
			writeRejected(input.cwd, response.text, input.now());
			return fail("invalid-output", parsed.detail);
		}

		if (parsed.kind === "proposal") {
			const validation = validateProposal(parsed.content, agentsMd);
			if (!validation.ok) {
				writeRejected(input.cwd, response.text, input.now());
				return fail("invalid-output", validation.detail);
			}
		}

		let nextIndex = mergeIndex(index, payload.included, input.now());
		nextIndex = pruneIndex(nextIndex, (path) => existsSync(path));
		saveIndex(input.cwd, nextIndex);

		if (parsed.kind === "no-change") {
			appendLog(input.cwd, {
				type: "run",
				...base({
					model: modelName,
					outcome: "no-change",
					sessions: payload.included,
					deferred: payload.deferred,
					usage: response.usage,
				}),
			});
			return { outcome: "no-change" };
		}

		const proposalPath = writeProposal(input.cwd, parsed.content);
		appendLog(input.cwd, {
			type: "run",
			...base({
				model: modelName,
				outcome: "proposal",
				sessions: payload.included,
				deferred: payload.deferred,
				proposalPath,
				proposalSha256: hashContent(parsed.content),
				changes: countChanges(agentsMd, parsed.content),
				usage: response.usage,
			}),
		});
		return { outcome: "proposal", proposalPath };
	} catch (error) {
		return fail(
			"call-failed",
			error instanceof Error ? error.message : String(error),
		);
	} finally {
		await releaseRun(input.cwd);
	}
}
