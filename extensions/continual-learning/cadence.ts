/**
 * Pure decision for when a new session should count toward the cadence and
 * when it should ask the user to run an update.
 */

import type { ContinualLearningState, RunConfig } from "./types.ts";

export type SessionStartReason =
	| "startup"
	| "reload"
	| "new"
	| "resume"
	| "fork";

export interface CadenceInput {
	state: ContinualLearningState;
	reason: SessionStartReason;
	hasUI: boolean;
	sessionFile: string | undefined;
	alreadyRunning: boolean;
	config: RunConfig;
	nowMs: number;
}

export interface CadenceResult {
	action: "ignore" | "count" | "ask";
	state: ContinualLearningState;
}

export function decideCadence(input: CadenceInput): CadenceResult {
	const { state, config, nowMs, sessionFile } = input;

	if (input.alreadyRunning) return { action: "ignore", state };
	if (input.reason !== "startup" && input.reason !== "new") {
		return { action: "ignore", state };
	}
	if (!input.hasUI) return { action: "ignore", state };
	if (sessionFile && sessionFile === state.lastCountedSessionFile) {
		return { action: "ignore", state };
	}

	const trialStartedAtMs =
		config.trialEnabled && state.trialStartedAtMs === null
			? nowMs
			: state.trialStartedAtMs;
	const inTrialWindow =
		config.trialEnabled &&
		trialStartedAtMs !== null &&
		nowMs - trialStartedAtMs < config.trialDurationMinutes * 60_000;
	const interval = inTrialWindow
		? config.trialSessions
		: config.sessionInterval;

	const counted: ContinualLearningState = {
		...state,
		sessionsSincePrompt: state.sessionsSincePrompt + 1,
		lastCountedSessionFile: sessionFile ?? state.lastCountedSessionFile,
		trialStartedAtMs,
	};

	if (counted.sessionsSincePrompt >= interval) {
		return {
			action: "ask",
			state: { ...counted, sessionsSincePrompt: 0 },
		};
	}

	return { action: "count", state: counted };
}
