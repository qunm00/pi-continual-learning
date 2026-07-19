/**
 * Types for the continual-learning extension.
 */

export interface ContinualLearningState {
	version: 1;
	lastRunAtMs: number;
	turnsSinceLastRun: number;
	lastSessionMtimeMs: number | null;
	trialStartedAtMs: number | null;
}
