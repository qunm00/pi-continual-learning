import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	buildDiff,
	deleteProposal,
	hashContent,
	proposalPath,
	readProposal,
	writeProposal,
} from "./proposals.ts";

function tempProject(): string {
	return mkdtempSync(join(tmpdir(), "cl-proposal-"));
}

test("proposalPath points at the project root", () => {
	assert.equal(
		proposalPath("/project"),
		join("/project", "AGENTS.proposal.md"),
	);
});

test("writeProposal then readProposal returns the content", () => {
	const cwd = tempProject();
	writeProposal(cwd, "## Learned User Preferences\n- a\n");

	assert.equal(readProposal(cwd), "## Learned User Preferences\n- a\n");
});

test("deleteProposal removes the file and does not throw when missing", () => {
	const cwd = tempProject();
	writeProposal(cwd, "x");

	deleteProposal(cwd);
	assert.equal(readProposal(cwd), null);

	deleteProposal(cwd);
});

test("hashContent is stable and differs for different content", () => {
	assert.equal(hashContent("abc"), hashContent("abc"));
	assert.notEqual(hashContent("abc"), hashContent("abd"));
	assert.match(hashContent("abc"), /^[a-f0-9]{64}$/);
});

test("buildDiff passes AGENTS.md and AGENTS.proposal.md to git diff --no-index", async () => {
	const calls: { command: string; args: string[] }[] = [];
	const diff = await buildDiff("/project", async (command, args) => {
		calls.push({ command, args });
		return { stdout: "diff-output" };
	});

	assert.equal(diff, "diff-output");
	assert.deepEqual(calls, [
		{
			command: "git",
			args: [
				"diff",
				"--no-index",
				"--unified=3",
				"--",
				"AGENTS.md",
				"AGENTS.proposal.md",
			],
		},
	]);
});

test("buildDiff returns a manual-comparison message when the command throws", async () => {
	const diff = await buildDiff("/project", async () => {
		throw new Error("not a git repository");
	});

	assert.match(diff, /Compare .*AGENTS\.md.*AGENTS\.proposal\.md manually/);
});
