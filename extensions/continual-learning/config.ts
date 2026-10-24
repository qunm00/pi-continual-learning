/**
 * Run configuration and the model config file.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	DEFAULT_MAX_INPUT_CHARS,
	DEFAULT_MAX_SESSIONS,
	DEFAULT_SESSION_INTERVAL,
	DEFAULT_TIMEOUT_MS,
	DEFAULT_TRIAL_SESSIONS,
	MODEL_CONFIG_DIR_PARTS,
	MODEL_CONFIG_FILE,
	TRIAL_DEFAULT_DURATION_MINUTES,
} from "./constants.ts";
import { parseBoolean, parsePositiveInt } from "./state.ts";
import type { RunConfig } from "./types.ts";

export const DEFAULT_RUN_CONFIG: RunConfig = {
	sessionInterval: DEFAULT_SESSION_INTERVAL,
	timeoutMs: DEFAULT_TIMEOUT_MS,
	maxSessions: DEFAULT_MAX_SESSIONS,
	maxInputChars: DEFAULT_MAX_INPUT_CHARS,
	trialEnabled: false,
	trialSessions: DEFAULT_TRIAL_SESSIONS,
	trialDurationMinutes: TRIAL_DEFAULT_DURATION_MINUTES,
};

function envValue(
	env: NodeJS.ProcessEnv,
	primary: string,
	legacy: string,
): string | undefined {
	return env[primary] ?? env[legacy];
}

export function readRunConfig(env: NodeJS.ProcessEnv = process.env): RunConfig {
	return {
		sessionInterval: parsePositiveInt(
			envValue(
				env,
				"CONTINUAL_LEARNING_SESSION_INTERVAL",
				"CONTINUOUS_LEARNING_SESSION_INTERVAL",
			),
			DEFAULT_RUN_CONFIG.sessionInterval,
		),
		timeoutMs: parsePositiveInt(
			envValue(
				env,
				"CONTINUAL_LEARNING_TIMEOUT_MS",
				"CONTINUOUS_LEARNING_TIMEOUT_MS",
			),
			DEFAULT_RUN_CONFIG.timeoutMs,
		),
		maxSessions: parsePositiveInt(
			envValue(
				env,
				"CONTINUAL_LEARNING_MAX_SESSIONS",
				"CONTINUOUS_LEARNING_MAX_SESSIONS",
			),
			DEFAULT_RUN_CONFIG.maxSessions,
		),
		maxInputChars: parsePositiveInt(
			envValue(
				env,
				"CONTINUAL_LEARNING_MAX_INPUT_CHARS",
				"CONTINUOUS_LEARNING_MAX_INPUT_CHARS",
			),
			DEFAULT_RUN_CONFIG.maxInputChars,
		),
		trialEnabled: parseBoolean(
			envValue(
				env,
				"CONTINUAL_LEARNING_TRIAL_MODE",
				"CONTINUOUS_LEARNING_TRIAL_MODE",
			),
		),
		trialSessions: parsePositiveInt(
			envValue(
				env,
				"CONTINUAL_LEARNING_TRIAL_SESSIONS",
				"CONTINUOUS_LEARNING_TRIAL_SESSIONS",
			),
			DEFAULT_RUN_CONFIG.trialSessions,
		),
		trialDurationMinutes: parsePositiveInt(
			envValue(
				env,
				"CONTINUAL_LEARNING_TRIAL_DURATION_MINUTES",
				"CONTINUOUS_LEARNING_TRIAL_DURATION_MINUTES",
			),
			DEFAULT_RUN_CONFIG.trialDurationMinutes,
		),
	};
}

export function modelConfigPath(agentDir: string): string {
	return join(agentDir, ...MODEL_CONFIG_DIR_PARTS, MODEL_CONFIG_FILE);
}

export type ModelConfigResult =
	| { ok: true; model: string | null }
	| { ok: false; detail: string };

export function readModelConfig(agentDir: string): ModelConfigResult {
	const path = modelConfigPath(agentDir);
	if (!existsSync(path)) return { ok: true, model: null };

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf-8"));
	} catch (error) {
		return {
			ok: false,
			detail: error instanceof Error ? error.message : String(error),
		};
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { ok: false, detail: "config.json must contain a JSON object" };
	}

	const raw = (parsed as Record<string, unknown>).model;
	if (raw === undefined || raw === null) return { ok: true, model: null };
	if (typeof raw !== "string") {
		return { ok: false, detail: "the model value must be a string" };
	}

	const trimmed = raw.trim();
	return { ok: true, model: trimmed === "" ? null : trimmed };
}

export function parseModelSpec(
	spec: string,
): { provider: string; id: string } | null {
	const trimmed = spec.trim();
	const slash = trimmed.indexOf("/");
	if (slash <= 0 || slash === trimmed.length - 1) return null;

	const provider = trimmed.slice(0, slash);
	const id = trimmed.slice(slash + 1);
	if (!provider || !id) return null;
	return { provider, id };
}
