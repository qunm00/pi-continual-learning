/**
 * State management helpers for the continual-learning extension.
 *
 * The state file tracks the session counter and the in-flight run claim.
 * The index file tracks which session transcripts have been processed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { INDEX_FILE_RELATIVE, STATE_FILE_RELATIVE } from "./constants.ts";
import type {
	ContinualLearningState,
	SessionFile,
	SessionIndex,
	SessionIndexEntry,
	Trigger,
} from "./types.ts";

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

export function getIndexFilePath(cwd: string): string {
	return resolve(cwd, INDEX_FILE_RELATIVE);
}

export function getDefaultState(): ContinualLearningState {
	return {
		version: 2,
		sessionsSincePrompt: 0,
		lastCountedSessionFile: null,
		trialStartedAtMs: null,
		inFlight: null,
	};
}

function finiteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeInt(value: unknown): number | null {
	const parsed = finiteNumber(value);
	if (parsed === null || parsed < 0) return null;
	return Math.floor(parsed);
}

function normalizeState(parsed: unknown): ContinualLearningState {
	if (typeof parsed !== "object" || parsed === null) return getDefaultState();
	const raw = parsed as Record<string, unknown>;

	// Version 1 stored turn/minute cadence data. Only the trial start carries over.
	if (raw.version === 1) {
		return {
			version: 2,
			sessionsSincePrompt: 0,
			lastCountedSessionFile: null,
			trialStartedAtMs: finiteNumber(raw.trialStartedAtMs),
			inFlight: null,
		};
	}

	if (raw.version !== 2) return getDefaultState();

	const inFlightRaw = raw.inFlight;
	const inFlight =
		typeof inFlightRaw === "object" &&
		inFlightRaw !== null &&
		finiteNumber((inFlightRaw as Record<string, unknown>).startedAtMs) !==
			null &&
		((inFlightRaw as Record<string, unknown>).trigger === "startup" ||
			(inFlightRaw as Record<string, unknown>).trigger === "manual")
			? {
					startedAtMs: finiteNumber(
						(inFlightRaw as Record<string, unknown>).startedAtMs,
					) as number,
					trigger: (inFlightRaw as Record<string, unknown>).trigger as Trigger,
				}
			: null;

	return {
		version: 2,
		sessionsSincePrompt: nonNegativeInt(raw.sessionsSincePrompt) ?? 0,
		lastCountedSessionFile:
			typeof raw.lastCountedSessionFile === "string"
				? raw.lastCountedSessionFile
				: null,
		trialStartedAtMs: finiteNumber(raw.trialStartedAtMs),
		inFlight,
	};
}

export function loadState(cwd: string): ContinualLearningState {
	const filePath = getStateFilePath(cwd);
	if (!existsSync(filePath)) return getDefaultState();

	try {
		const raw = readFileSync(filePath, "utf-8");
		return normalizeState(JSON.parse(raw));
	} catch {
		return getDefaultState();
	}
}

export function saveState(cwd: string, state: ContinualLearningState): void {
	const filePath = getStateFilePath(cwd);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

function normalizeIndex(parsed: unknown): SessionIndex {
	if (typeof parsed !== "object" || parsed === null) {
		return { version: 1, files: {} };
	}
	const raw = parsed as Record<string, unknown>;
	if (
		raw.version !== 1 ||
		typeof raw.files !== "object" ||
		raw.files === null
	) {
		return { version: 1, files: {} };
	}

	const files: Record<string, SessionIndexEntry> = {};
	for (const [path, entry] of Object.entries(
		raw.files as Record<string, unknown>,
	)) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry as Record<string, unknown>;
		const mtimeMs = finiteNumber(record.mtimeMs);
		const size = nonNegativeInt(record.size);
		if (mtimeMs === null || size === null) continue;
		files[path] = {
			mtimeMs,
			size,
			processedAt:
				typeof record.processedAt === "string" ? record.processedAt : "",
		};
	}
	return { version: 1, files };
}

export function loadIndex(cwd: string): SessionIndex {
	const filePath = getIndexFilePath(cwd);
	if (!existsSync(filePath)) return { version: 1, files: {} };

	try {
		return normalizeIndex(JSON.parse(readFileSync(filePath, "utf-8")));
	} catch {
		return { version: 1, files: {} };
	}
}

export function saveIndex(cwd: string, index: SessionIndex): void {
	const filePath = getIndexFilePath(cwd);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(index, null, 2)}\n`, "utf-8");
}

export function mergeIndex(
	index: SessionIndex,
	processed: SessionFile[],
	nowMs: number,
): SessionIndex {
	const processedAt = new Date(nowMs).toISOString();
	const files: Record<string, SessionIndexEntry> = { ...index.files };
	for (const file of processed) {
		files[file.path] = {
			mtimeMs: file.mtimeMs,
			size: file.size,
			processedAt,
		};
	}
	return { version: 1, files };
}

export function pruneIndex(
	index: SessionIndex,
	exists: (path: string) => boolean,
): SessionIndex {
	const files: Record<string, SessionIndexEntry> = {};
	for (const [path, entry] of Object.entries(index.files)) {
		if (exists(path)) files[path] = entry;
	}
	return { version: 1, files };
}

/**
 * Read-modify-write the state file while holding the per-file queue, so two
 * sessions cannot lose each other's updates.
 */
export function updateState(
	cwd: string,
	fn: (state: ContinualLearningState) => ContinualLearningState,
): Promise<ContinualLearningState> {
	return withFileMutationQueue(getStateFilePath(cwd), async () => {
		const next = fn(loadState(cwd));
		saveState(cwd, next);
		return next;
	});
}

/**
 * Claim the single run slot for this project. Returns false when a run is
 * already in flight. The claim only sets `inFlight`; it never touches the
 * counter.
 */
export function claimRun(
	cwd: string,
	trigger: Trigger,
	nowMs: number,
): Promise<boolean> {
	return withFileMutationQueue(getStateFilePath(cwd), async () => {
		const state = loadState(cwd);
		if (state.inFlight) return false;
		saveState(cwd, {
			...state,
			inFlight: { startedAtMs: nowMs, trigger },
		});
		return true;
	});
}

export function releaseRun(cwd: string): Promise<void> {
	return withFileMutationQueue(getStateFilePath(cwd), async () => {
		const state = loadState(cwd);
		if (!state.inFlight) return;
		saveState(cwd, { ...state, inFlight: null });
	});
}

/**
 * Clear a claim that outlived the run timeout, returning it so the caller can
 * log an aborted run.
 */
export function reapStaleRun(
	cwd: string,
	timeoutMs: number,
	nowMs: number,
): Promise<{ startedAtMs: number } | null> {
	return withFileMutationQueue(getStateFilePath(cwd), async () => {
		const state = loadState(cwd);
		if (!state.inFlight) return null;
		if (nowMs - state.inFlight.startedAtMs <= timeoutMs) return null;
		const stale = { startedAtMs: state.inFlight.startedAtMs };
		saveState(cwd, { ...state, inFlight: null });
		return stale;
	});
}
