/**
 * Types for the continual-learning extension.
 */

export type Trigger = "startup" | "manual";

export interface ContinualLearningState {
	version: 2;
	sessionsSincePrompt: number;
	lastCountedSessionFile: string | null;
	trialStartedAtMs: number | null;
	inFlight: { startedAtMs: number; trigger: Trigger } | null;
}

export interface SessionFile {
	path: string;
	mtimeMs: number;
	size: number;
}

export interface SessionIndexEntry {
	mtimeMs: number;
	size: number;
	processedAt: string;
}

export interface SessionIndex {
	version: 1;
	files: Record<string, SessionIndexEntry>;
}
