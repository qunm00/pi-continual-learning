/**
 * Continual Learning Extension for pi
 *
 * Counts new sessions. When the cadence is reached, asks once at session
 * start, then makes one model call in the background and writes a proposal.
 * It never writes AGENTS.md; /continual-learning apply does that.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	getAgentDir,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { decideCadence } from "./cadence.ts";
import { readRunConfig } from "./config.ts";
import { appendLog, formatLog, readLog } from "./log.ts";
import {
	buildDiff,
	deleteProposal,
	hashContent,
	proposalPath,
	readProposal,
} from "./proposals.ts";
import { type RunOutcome, runOnce } from "./run.ts";
import {
	claimRun,
	loadState,
	reapStaleRun,
	releaseRun,
	updateState,
} from "./state.ts";
import type { Trigger } from "./types.ts";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = resolve(
	MODULE_DIR,
	"../../skills/continual-learning/rules.md",
);
const DIFF_LINES = 160;

function iso(ms: number): string {
	return new Date(ms).toISOString();
}

function truncateDiff(diff: string): string {
	const lines = diff.split("\n");
	if (lines.length <= DIFF_LINES) return diff;
	return `${lines.slice(0, DIFF_LINES).join("\n")}\n... (truncated, see AGENTS.md and AGENTS.proposal.md)`;
}

async function startRun(ctx: ExtensionContext, trigger: Trigger) {
	return runOnce({
		cwd: ctx.cwd,
		agentDir: getAgentDir(),
		currentSessionFile: ctx.sessionManager.getSessionFile(),
		trigger,
		config: readRunConfig(),
		sessionModel: ctx.model,
		registry: ctx.modelRegistry,
		rulesPath: RULES_PATH,
		now: () => Date.now(),
	});
}

function report(ctx: ExtensionContext, outcome: RunOutcome): void {
	if (!ctx.hasUI) return;
	if (outcome.outcome === "proposal") {
		ctx.ui.notify(`Proposal ready: ${outcome.proposalPath}`, "info");
	} else if (outcome.outcome === "no-change") {
		ctx.ui.notify("No high-signal memory updates.", "info");
	} else {
		const detail = outcome.detail ? `: ${outcome.detail}` : "";
		ctx.ui.notify(
			`Continual learning failed (${outcome.reason})${detail}`,
			"error",
		);
	}
}

async function applyProposal(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const cwd = ctx.cwd;
	const proposalFile = proposalPath(cwd);
	const proposal = readProposal(cwd);

	if (proposal === null) {
		if (ctx.hasUI) {
			ctx.ui.notify(
				"No proposal waiting. Run /continual-learning first.",
				"info",
			);
		}
		return;
	}

	const agentsPath = join(cwd, "AGENTS.md");
	const current = existsSync(agentsPath)
		? readFileSync(agentsPath, "utf-8")
		: null;

	let message = await buildDiff(cwd, async (command, args) => {
		const result = await pi.exec(command, args, { cwd });
		return { stdout: result.stdout };
	});

	const latestRun = [...readLog(cwd, 50)]
		.reverse()
		.find(
			(record) =>
				record.type === "run" &&
				record.outcome === "proposal" &&
				record.proposalPath === proposalFile,
		);

	if (
		latestRun?.type === "run" &&
		latestRun.baseAgentsSha256 &&
		latestRun.baseAgentsSha256 !== hashContent(current ?? "")
	) {
		message = `AGENTS.md changed since this proposal was made.\n\n${message}`;
	}

	const accepted = await ctx.ui.confirm(
		"Apply proposal?",
		truncateDiff(message),
	);
	if (!accepted) return;

	await withFileMutationQueue(agentsPath, async () => {
		writeFileSync(agentsPath, proposal, "utf-8");
	});

	appendLog(cwd, {
		type: "applied",
		at: iso(Date.now()),
		proposalPath: proposalFile,
		proposalSha256: hashContent(proposal),
	});
	deleteProposal(cwd);

	if (ctx.hasUI) {
		ctx.ui.notify("Proposal applied to AGENTS.md. Commit when ready.", "info");
	}
}

function showLog(pi: ExtensionAPI, ctx: ExtensionContext): void {
	const text = formatLog(readLog(ctx.cwd, 10));
	const content = text
		? `Recent continual-learning runs:\n\n${text}`
		: "No continual-learning runs logged yet.";

	if (ctx.hasUI) {
		pi.sendMessage(
			{ customType: "continual-learning-log", content, display: true },
			{ triggerTurn: false },
		);
	} else {
		ctx.ui.notify(content, "info");
	}
}

async function manualRun(ctx: ExtensionContext): Promise<void> {
	const claimed = await claimRun(ctx.cwd, "manual", Date.now());
	if (!claimed) {
		if (ctx.hasUI) {
			ctx.ui.notify(
				"A continual-learning run is already in progress.",
				"warning",
			);
		}
		return;
	}

	if (ctx.hasUI) {
		ctx.ui.notify("Continual learning started in the background.", "info");
	}

	void startRun(ctx, "manual")
		.then((outcome) => report(ctx, outcome))
		.catch(() => {
			if (ctx.hasUI) {
				ctx.ui.notify("Continual learning failed unexpectedly.", "error");
			}
		});
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (event, ctx) => {
		const config = readRunConfig();
		const now = Date.now();

		try {
			const stale = await reapStaleRun(ctx.cwd, config.timeoutMs, now);
			if (stale) {
				appendLog(ctx.cwd, {
					type: "aborted",
					at: iso(now),
					startedAt: iso(stale.startedAtMs),
				});
			}
		} catch {
			// A missing or unreadable state file must not block session start.
		}

		const state = loadState(ctx.cwd);
		const decision = decideCadence({
			state,
			reason: event.reason,
			hasUI: ctx.hasUI,
			sessionFile: ctx.sessionManager.getSessionFile(),
			alreadyRunning: state.inFlight !== null,
			config,
			nowMs: now,
		});

		if (decision.action === "ignore") return;

		await updateState(ctx.cwd, (current) => ({
			...current,
			sessionsSincePrompt: decision.state.sessionsSincePrompt,
			lastCountedSessionFile: decision.state.lastCountedSessionFile,
			trialStartedAtMs: decision.state.trialStartedAtMs,
		}));

		if (decision.action === "count") return;

		const claimed = await claimRun(ctx.cwd, "startup", Date.now());
		if (!claimed) return;

		const asked = state.sessionsSincePrompt + 1;
		let accepted = false;
		try {
			accepted = await ctx.ui.confirm(
				"Continual learning",
				`Run a memory proposal from the last ${asked} sessions in the background?`,
			);
		} catch {
			await releaseRun(ctx.cwd);
			return;
		}

		if (!accepted) {
			appendLog(ctx.cwd, {
				type: "declined",
				at: iso(Date.now()),
				sessionsSincePrompt: asked,
			});
			await releaseRun(ctx.cwd);
			return;
		}

		void startRun(ctx, "startup")
			.then((outcome) => report(ctx, outcome))
			.catch(() => {});
	});

	pi.registerCommand("continual-learning", {
		description:
			"Run a memory proposal in the background, apply the waiting proposal, or show recent runs",
		handler: async (args, ctx) => {
			const subcommand = (args ?? "").trim();
			if (subcommand === "apply") return applyProposal(pi, ctx);
			if (subcommand === "log") return showLog(pi, ctx);
			return manualRun(ctx);
		},
	});
}
