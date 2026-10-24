import assert from "node:assert/strict";
import { test } from "node:test";
import { decideCadence } from "./cadence.ts";
import { getDefaultState } from "./state.ts";
import type { ContinualLearningState, RunConfig } from "./types.ts";

const config: RunConfig = {
	sessionInterval: 5,
	timeoutMs: 600_000,
	maxSessions: 20,
	maxInputChars: 200_000,
	trialEnabled: false,
	trialSessions: 1,
	trialDurationMinutes: 1440,
};

function state(
	overrides: Partial<ContinualLearningState> = {},
): ContinualLearningState {
	return { ...getDefaultState(), ...overrides };
}

const base = {
	state: state(),
	reason: "startup" as const,
	hasUI: true,
	sessionFile: "/sessions/a.jsonl",
	alreadyRunning: false,
	config,
	nowMs: 1000,
};

test("resume, fork, and reload are ignored without touching state", () => {
	for (const reason of ["resume", "fork", "reload"] as const) {
		const result = decideCadence({ ...base, reason });
		assert.equal(result.action, "ignore");
		assert.deepEqual(result.state, base.state);
	}
});

test("sessions without a UI are ignored", () => {
	const result = decideCadence({ ...base, hasUI: false });
	assert.equal(result.action, "ignore");
});

test("a repeated session file is ignored", () => {
	const result = decideCadence({
		...base,
		state: state({
			lastCountedSessionFile: "/sessions/a.jsonl",
			sessionsSincePrompt: 2,
		}),
	});
	assert.equal(result.action, "ignore");
});

test("a new session increments the counter and records the file", () => {
	const result = decideCadence({
		...base,
		state: state({ sessionsSincePrompt: 2 }),
	});

	assert.equal(result.action, "count");
	assert.equal(result.state.sessionsSincePrompt, 3);
	assert.equal(result.state.lastCountedSessionFile, "/sessions/a.jsonl");
});

test("reaching the interval asks and resets the counter", () => {
	const result = decideCadence({
		...base,
		state: state({ sessionsSincePrompt: 4 }),
	});

	assert.equal(result.action, "ask");
	assert.equal(result.state.sessionsSincePrompt, 0);
});

test("an in-flight run is ignored without counting", () => {
	const inFlight = state({
		sessionsSincePrompt: 4,
		inFlight: { startedAtMs: 10, trigger: "startup" },
	});
	const result = decideCadence({
		...base,
		state: inFlight,
		alreadyRunning: true,
	});

	assert.equal(result.action, "ignore");
	assert.deepEqual(result.state, inFlight);
});

test("trial mode starts the window and asks at the trial interval", () => {
	const result = decideCadence({
		...base,
		state: state({ sessionsSincePrompt: 0 }),
		config: { ...config, trialEnabled: true, trialSessions: 1 },
	});

	assert.equal(result.action, "ask");
	assert.equal(result.state.trialStartedAtMs, 1000);
});

test("an expired trial window falls back to the normal interval", () => {
	const result = decideCadence({
		...base,
		nowMs: 1000 + 1441 * 60_000,
		state: state({ sessionsSincePrompt: 1, trialStartedAtMs: 1000 }),
		config: { ...config, trialEnabled: true, trialSessions: 1 },
	});

	assert.equal(result.action, "count");
	assert.equal(result.state.sessionsSincePrompt, 2);
});
