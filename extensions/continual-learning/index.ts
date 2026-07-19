/**
 * Continual Learning Extension for pi
 *
 * Automatically and incrementally keeps AGENTS.md up to date from session transcripts.
 *
 * The extension:
 * - Listens to agent_settled events to detect when the agent finishes processing
 * - Maintains local runtime state (cadence, turn counts, session mtime)
 * - When cadence conditions are met, sends a follow-up message to run the memory update
 * - Supports env var overrides for tuning the trigger cadence
 * - Registers /continual-learning command for manual triggering
 *
 * State is stored in .pi/state/continual-learning.json relative to the project root.
 */

import type {
	AgentSettledEvent,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	CONTINUAL_LEARNING_MESSAGE,
	DEFAULT_MIN_MINUTES,
	DEFAULT_MIN_TURNS,
	TRIAL_DEFAULT_DURATION_MINUTES,
	TRIAL_DEFAULT_MIN_MINUTES,
	TRIAL_DEFAULT_MIN_TURNS,
} from "./constants";
import {
	canTrigger,
	getSessionFileMtime,
	loadState,
	parseBoolean,
	parsePositiveInt,
	readEnvValue,
	saveState,
} from "./state";
import type { ContinualLearningState } from "./types";

export default function (pi: ExtensionAPI) {
	// -- Track agent completions ------------------------------------------------
	pi.on(
		"agent_settled",
		async (_event: AgentSettledEvent, ctx: ExtensionContext) => {
			const cwd = ctx.cwd;
			const state = loadState(cwd);

			// Increment turn counter
			const turnsSinceLastRun = state.turnsSinceLastRun + 1;
			const now = Date.now();

			// -- Trial mode -----------------------------------------------------------
			const trialEnabled = parseBoolean(
				readEnvValue(
					"CONTINUAL_LEARNING_TRIAL_MODE",
					"CONTINUOUS_LEARNING_TRIAL_MODE",
				),
			);
			if (trialEnabled && state.trialStartedAtMs === null) {
				state.trialStartedAtMs = now;
			}

			const trialDurationMinutes = parsePositiveInt(
				readEnvValue(
					"CONTINUAL_LEARNING_TRIAL_DURATION_MINUTES",
					"CONTINUOUS_LEARNING_TRIAL_DURATION_MINUTES",
				),
				TRIAL_DEFAULT_DURATION_MINUTES,
			);
			const trialMinTurns = parsePositiveInt(
				readEnvValue(
					"CONTINUAL_LEARNING_TRIAL_MIN_TURNS",
					"CONTINUOUS_LEARNING_TRIAL_MIN_TURNS",
				),
				TRIAL_DEFAULT_MIN_TURNS,
			);
			const trialMinMinutes = parsePositiveInt(
				readEnvValue(
					"CONTINUAL_LEARNING_TRIAL_MIN_MINUTES",
					"CONTINUOUS_LEARNING_TRIAL_MIN_MINUTES",
				),
				TRIAL_DEFAULT_MIN_MINUTES,
			);
			const inTrialWindow =
				trialEnabled &&
				state.trialStartedAtMs !== null &&
				now - state.trialStartedAtMs < trialDurationMinutes * 60_000;

			// -- Effective thresholds -------------------------------------------------
			const minTurns = parsePositiveInt(
				readEnvValue(
					"CONTINUAL_LEARNING_MIN_TURNS",
					"CONTINUOUS_LEARNING_MIN_TURNS",
				),
				DEFAULT_MIN_TURNS,
			);
			const minMinutes = parsePositiveInt(
				readEnvValue(
					"CONTINUAL_LEARNING_MIN_MINUTES",
					"CONTINUOUS_LEARNING_MIN_MINUTES",
				),
				DEFAULT_MIN_MINUTES,
			);

			const effectiveMinTurns = inTrialWindow ? trialMinTurns : minTurns;
			const effectiveMinMinutes = inTrialWindow ? trialMinMinutes : minMinutes;

			const minutesSinceLastRun =
				state.lastRunAtMs > 0
					? Math.floor((now - state.lastRunAtMs) / 60000)
					: Number.POSITIVE_INFINITY;

			const sessionMtimeMs = getSessionFileMtime(ctx);
			const hasSessionAdvanced =
				sessionMtimeMs !== null &&
				(state.lastSessionMtimeMs === null ||
					sessionMtimeMs > state.lastSessionMtimeMs);

			const shouldTrigger =
				turnsSinceLastRun >= effectiveMinTurns &&
				minutesSinceLastRun >= effectiveMinMinutes &&
				hasSessionAdvanced;

			if (shouldTrigger && canTrigger(ctx)) {
				// Reset state
				state.lastRunAtMs = now;
				state.turnsSinceLastRun = 0;
				state.lastSessionMtimeMs = sessionMtimeMs;
				saveState(cwd, state);

				// Queue the memory update as a follow-up to the current agent run
				pi.sendUserMessage(CONTINUAL_LEARNING_MESSAGE, {
					deliverAs: "followUp",
				});
				return;
			}

			// Update turn counter and persist
			state.turnsSinceLastRun = turnsSinceLastRun;
			saveState(cwd, state);
		},
	);

	// -- /continual-learning command for manual trigger -------------------------
	pi.registerCommand("continual-learning", {
		description:
			"Manually trigger the continual learning memory update from session transcripts",
		handler: async (_args: string, ctx: ExtensionContext) => {
			const cwd = ctx.cwd;
			const sessionMtimeMs = getSessionFileMtime(ctx);

			// Reset state so the next agent_settled evaluates fresh
			const state: ContinualLearningState = {
				version: 1,
				lastRunAtMs: Date.now(),
				turnsSinceLastRun: 0,
				lastSessionMtimeMs: sessionMtimeMs,
				trialStartedAtMs: null,
			};
			saveState(cwd, state);

			// Send the memory update message immediately
			pi.sendUserMessage(CONTINUAL_LEARNING_MESSAGE);
			ctx.ui.notify(
				"Continual learning triggered. The agent will now mine session transcripts and update AGENTS.md.",
				"info",
			);
		},
	});
}
