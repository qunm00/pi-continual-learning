/**
 * State management helpers for the continual-learning extension.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { STATE_FILE_RELATIVE } from "./constants";
import type { ContinualLearningState } from "./types.ts";

export function parsePositiveInt(
	value: string | undefined,
	fallback: number,
): number {
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return parsed;
}

export function parseBoolean(value: string | undefined): boolean {
	if (!value) return false;
	const normalized = value.trim().toLowerCase();
	return (
		normalized === "1" ||
		normalized === "true" ||
		normalized === "yes" ||
		normalized === "on"
	);
}

export function readEnvValue(
	primary: string,
	legacy: string,
): string | undefined {
	return process.env[primary] ?? process.env[legacy];
}

export function getStateFilePath(cwd: string): string {
	return resolve(cwd, STATE_FILE_RELATIVE);
}

export function getDefaultState(): ContinualLearningState {
	return {
		version: 1,
		lastRunAtMs: 0,
		turnsSinceLastRun: 0,
		lastSessionMtimeMs: null,
		trialStartedAtMs: null,
	};
}

export function loadState(cwd: string): ContinualLearningState {
	const filePath = getStateFilePath(cwd);
	if (!existsSync(filePath)) return getDefaultState();

	try {
		const raw = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw) as Partial<ContinualLearningState>;
		if (parsed.version !== 1) return getDefaultState();
		return {
			version: 1 as const,
			lastRunAtMs:
				typeof parsed.lastRunAtMs === "number" &&
				Number.isFinite(parsed.lastRunAtMs)
					? parsed.lastRunAtMs
					: 0,
			turnsSinceLastRun:
				typeof parsed.turnsSinceLastRun === "number" &&
				Number.isFinite(parsed.turnsSinceLastRun) &&
				parsed.turnsSinceLastRun >= 0
					? parsed.turnsSinceLastRun
					: 0,
			lastSessionMtimeMs:
				typeof parsed.lastSessionMtimeMs === "number" &&
				Number.isFinite(parsed.lastSessionMtimeMs)
					? parsed.lastSessionMtimeMs
					: null,
			trialStartedAtMs:
				typeof parsed.trialStartedAtMs === "number" &&
				Number.isFinite(parsed.trialStartedAtMs)
					? parsed.trialStartedAtMs
					: null,
		};
	} catch {
		return getDefaultState();
	}
}

export function saveState(cwd: string, state: ContinualLearningState): void {
	const filePath = getStateFilePath(cwd);
	const directory = dirname(filePath);
	if (!existsSync(directory)) {
		mkdirSync(directory, { recursive: true });
	}
	writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

export function getSessionFileMtime(ctx: ExtensionContext): number | null {
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile) return null;
	try {
		return statSync(sessionFile).mtimeMs;
	} catch {
		return null;
	}
}

/**
 * Check whether the environment is suitable for sending follow-up messages.
 * In print and JSON mode there is no persistent agent loop to receive them,
 * so we only accumulate state without triggering.
 */
export function canTrigger(ctx: ExtensionContext): boolean {
	return ctx.mode === "tui" || ctx.mode === "rpc";
}
