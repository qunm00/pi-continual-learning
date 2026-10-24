import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildPrompt,
	countChanges,
	parseProposalResponse,
	validateProposal,
} from "./prompt.ts";

const learned = (prefs: string[], facts: string[]): string =>
	[
		"## Learned User Preferences",
		...prefs.map((entry) => `- ${entry}`),
		"",
		"## Learned Workspace Facts",
		...facts.map((entry) => `- ${entry}`),
		"",
	].join("\n");

const currentFile = `# Project notes\n\nHand-written rule.\n\n${learned(
	["prefer pnpm"],
	["the repo uses Biome"],
)}
## Other\n\nkeep me\n`;

test("buildPrompt includes the rules, the current AGENTS.md, the sessions, and the contract", () => {
	const prompt = buildPrompt({
		rules: "RULE-ONE",
		agentsMd: "CURRENT-MEMORY",
		sessions: "SESSION-TEXT",
	});

	assert.match(prompt, /RULE-ONE/);
	assert.match(prompt, /CURRENT-MEMORY/);
	assert.match(prompt, /SESSION-TEXT/);
	assert.match(prompt, /No high-signal memory updates\./);
	assert.match(prompt, /```markdown/);
});

test("buildPrompt notes a missing AGENTS.md", () => {
	const prompt = buildPrompt({ rules: "r", agentsMd: null, sessions: "" });

	assert.match(prompt, /does not exist|missing/i);
});

test("parseProposalResponse accepts the exact no-change line", () => {
	assert.deepEqual(
		parseProposalResponse("  No high-signal memory updates.\n"),
		{ kind: "no-change" },
	);
});

test("parseProposalResponse takes the first markdown fence and ignores prose", () => {
	const response = [
		"Two bullets added.",
		"```markdown",
		learned(["a"], ["b"]).trimEnd(),
		"```",
		"trailing note",
	].join("\n");

	const parsed = parseProposalResponse(response);

	assert.equal(parsed.kind, "proposal");
	assert.ok(
		parsed.kind === "proposal" &&
			parsed.content.includes("## Learned User Preferences"),
	);
	assert.ok(parsed.kind === "proposal" && parsed.content.endsWith("\n"));
});

test("parseProposalResponse rejects a response with no fence", () => {
	assert.equal(parseProposalResponse("just prose").kind, "invalid");
});

test("parseProposalResponse rejects an empty fence", () => {
	assert.equal(parseProposalResponse("```markdown\n\n```").kind, "invalid");
});

test("validateProposal accepts a file with both learned sections", () => {
	assert.deepEqual(validateProposal(learned(["a"], ["b"]), null), {
		ok: true,
	});
});

test("validateProposal rejects a missing section and too many bullets", () => {
	assert.equal(
		validateProposal("## Learned User Preferences\n- a\n", null).ok,
		false,
	);
	assert.equal(
		validateProposal(
			learned(
				Array.from({ length: 13 }, (_, i) => `p${i}`),
				["b"],
			),
			null,
		).ok,
		false,
	);
});

test("validateProposal rejects a changed hand-written section", () => {
	const proposed = currentFile.replace("Hand-written rule.", "Changed rule.");

	assert.equal(validateProposal(proposed, currentFile).ok, false);
});

test("validateProposal accepts other sections only when byte-identical", () => {
	const proposed = currentFile.replace("- prefer pnpm", "- prefer pnpm always");

	assert.deepEqual(validateProposal(proposed, currentFile), { ok: true });
});

test("countChanges reports added, removed, and position-wise updates", () => {
	assert.deepEqual(countChanges(null, learned(["a", "b"], [])), {
		added: 2,
		updated: 0,
		removed: 0,
	});

	assert.deepEqual(countChanges(learned(["a"], []), learned([], [])), {
		added: 0,
		updated: 0,
		removed: 1,
	});

	assert.deepEqual(countChanges(learned(["a"], []), learned(["b"], [])), {
		added: 0,
		updated: 1,
		removed: 0,
	});
});
