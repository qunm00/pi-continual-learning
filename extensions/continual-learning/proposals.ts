/**
 * Proposal file handling. A run writes the proposal; only an explicit apply
 * turns it into AGENTS.md.
 */

import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const PROPOSAL_FILE = "AGENTS.proposal.md";

export type ExecFn = (
	command: string,
	args: string[],
) => Promise<{ stdout: string }>;

export function proposalPath(cwd: string): string {
	return join(cwd, PROPOSAL_FILE);
}

export function writeProposal(cwd: string, content: string): string {
	const path = proposalPath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf-8");
	return path;
}

export function readProposal(cwd: string): string | null {
	const path = proposalPath(cwd);
	if (!existsSync(path)) return null;
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return null;
	}
}

export function deleteProposal(cwd: string): void {
	const path = proposalPath(cwd);
	if (!existsSync(path)) return;
	try {
		rmSync(path, { force: true });
	} catch {
		// Losing the delete is harmless: the next run overwrites the file.
	}
}

export function hashContent(content: string): string {
	return createHash("sha256").update(content, "utf-8").digest("hex");
}

export async function buildDiff(cwd: string, exec: ExecFn): Promise<string> {
	try {
		const result = await exec("git", [
			"diff",
			"--no-index",
			"--unified=3",
			"--",
			"AGENTS.md",
			"AGENTS.proposal.md",
		]);
		return result.stdout;
	} catch {
		return `Diff unavailable. Compare ${join(cwd, "AGENTS.md")} with ${join(cwd, "AGENTS.proposal.md")} manually.`;
	}
}
