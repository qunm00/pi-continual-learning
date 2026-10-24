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

export interface RunConfig {
	sessionInterval: number;
	timeoutMs: number;
	maxSessions: number;
	maxInputChars: number;
	trialEnabled: boolean;
	trialSessions: number;
	trialDurationMinutes: number;
}

export interface RunRecord {
	type: "run";
	at: string;
	trigger: Trigger;
	model: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	sessions: SessionFile[];
	deferred: string[];
	outcome: "proposal" | "no-change" | "failed";
	proposalPath?: string;
	proposalSha256?: string;
	baseAgentsSha256?: string;
	changes?: { added: number; updated: number; removed: number };
	usage?: { input: number; output: number; cost: number };
	reason?: string;
	error?: string;
}

export interface DeclinedRecord {
	type: "declined";
	at: string;
	sessionsSincePrompt: number;
}

export interface AbortedRecord {
	type: "aborted";
	at: string;
	startedAt: string;
}

export interface AppliedRecord {
	type: "applied";
	at: string;
	proposalPath: string;
	proposalSha256: string;
}

export type LogRecord =
	| RunRecord
	| DeclinedRecord
	| AbortedRecord
	| AppliedRecord;
