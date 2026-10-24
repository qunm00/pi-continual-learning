/**
 * Prompt construction, response parsing, and proposal validation.
 */

const PREFERENCES_HEADING = "## Learned User Preferences";
const FACTS_HEADING = "## Learned Workspace Facts";
const NO_CHANGE = "No high-signal memory updates.";
const MAX_BYTES = 20 * 1024;
const MAX_BULLETS = 12;

export interface PromptInput {
	rules: string;
	agentsMd: string | null;
	sessions: string;
}

export function buildPrompt(input: PromptInput): string {
	const agents =
		input.agentsMd === null
			? "AGENTS.md does not exist yet. The proposal must create it and contain only the two learned sections below."
			: input.agentsMd.trimEnd();
	const sessions = input.sessions.trim()
		? input.sessions.trimEnd()
		: "(no new session text was available)";

	return `You maintain AGENTS.md, a memory file with durable user preferences and stable workspace facts.

## Rules

${input.rules.trimEnd()}

## Current AGENTS.md

${agents}

## Session transcripts

Only user and assistant text is included. Tool traffic was removed.

${sessions}

## Output

Respond with exactly one of these two shapes and nothing else:

1. If there is nothing durable to add or change, respond with exactly:

${NO_CHANGE}

2. Otherwise write one short summary line, then exactly one fenced block that starts with \`\`\`markdown and contains the complete proposed AGENTS.md:

\`\`\`markdown
${PREFERENCES_HEADING}
- ...

${FACTS_HEADING}
- ...
\`\`\`

Requirements:

- Keep every section of the current AGENTS.md that is not one of the two learned sections, unchanged.
- Keep each learned section to at most ${MAX_BULLETS} bullets.
- Use plain bullet points only: no evidence, confidence, dates, or metadata.
- Update matching bullets in place, add only net-new bullets, and deduplicate semantically similar ones.
- Do not include secrets, private data, one-off instructions, or process notes.`;
}

export type ParsedResponse =
	| { kind: "no-change" }
	| { kind: "proposal"; content: string }
	| { kind: "invalid"; detail: string };

export function parseProposalResponse(text: string): ParsedResponse {
	if (text.trim() === NO_CHANGE) return { kind: "no-change" };

	const fence = /```markdown\r?\n([\s\S]*?)```/.exec(text);
	if (!fence) return { kind: "invalid", detail: "no ```markdown fence" };

	const content = fence[1].trim();
	if (!content) return { kind: "invalid", detail: "empty markdown fence" };

	return { kind: "proposal", content: `${content}\n` };
}

interface SplitFile {
	preferences: string[];
	facts: string[];
	rest: string;
}

function bullets(lines: string[]): string[] {
	return lines
		.filter((line) => /^-\s/.test(line))
		.map((line) => line.replace(/^-\s+/, "").trim());
}

function splitFile(markdown: string): SplitFile | { detail: string } {
	const lines = markdown.replace(/\r\n/g, "\n").split("\n");
	const sections: { heading: string | null; lines: string[] }[] = [
		{ heading: null, lines: [] },
	];

	for (const line of lines) {
		if (/^##\s+/.test(line)) {
			sections.push({ heading: line.trim(), lines: [] });
		} else {
			sections[sections.length - 1].lines.push(line);
		}
	}

	const preferences = sections.filter(
		(section) => section.heading === PREFERENCES_HEADING,
	);
	const facts = sections.filter((section) => section.heading === FACTS_HEADING);
	if (preferences.length !== 1) {
		return { detail: `${PREFERENCES_HEADING} must appear exactly once` };
	}
	if (facts.length !== 1) {
		return { detail: `${FACTS_HEADING} must appear exactly once` };
	}

	const rest = sections
		.filter(
			(section) =>
				section.heading !== PREFERENCES_HEADING &&
				section.heading !== FACTS_HEADING,
		)
		.map((section) =>
			[section.heading, ...section.lines]
				.filter((line): line is string => line !== null)
				.join("\n"),
		)
		.join("\n")
		.trim();

	return {
		preferences: bullets(preferences[0].lines),
		facts: bullets(facts[0].lines),
		rest,
	};
}

/**
 * A current file with no learned sections is normal (hand-written notes, or a
 * first run). Its whole text is treated as preserved content.
 */
function currentSections(markdown: string | null): SplitFile {
	if (markdown === null) return { preferences: [], facts: [], rest: "" };
	const split = splitFile(markdown);
	if ("detail" in split) {
		return {
			preferences: [],
			facts: [],
			rest: markdown.replace(/\r\n/g, "\n").trim(),
		};
	}
	return split;
}

export type ValidationResult = { ok: true } | { ok: false; detail: string };

export function validateProposal(
	proposed: string,
	current: string | null,
): ValidationResult {
	const trimmed = proposed.trim();
	if (!trimmed) return { ok: false, detail: "the proposal is empty" };
	if (trimmed.length > MAX_BYTES) {
		return { ok: false, detail: "the proposal exceeds 20 KiB" };
	}

	const next = splitFile(trimmed);
	if ("detail" in next) return { ok: false, detail: next.detail };
	if (next.preferences.length > MAX_BULLETS) {
		return {
			ok: false,
			detail: `${PREFERENCES_HEADING} has more than ${MAX_BULLETS} bullets`,
		};
	}
	if (next.facts.length > MAX_BULLETS) {
		return {
			ok: false,
			detail: `${FACTS_HEADING} has more than ${MAX_BULLETS} bullets`,
		};
	}

	const previous = currentSections(current);
	if (next.rest !== previous.rest) {
		return {
			ok: false,
			detail: "content outside the two learned sections changed",
		};
	}

	return { ok: true };
}

function sectionDiff(
	previous: string[],
	next: string[],
): { added: number; updated: number; removed: number } {
	if (previous.length === next.length) {
		let updated = 0;
		for (let index = 0; index < previous.length; index++) {
			if (previous[index] !== next[index]) updated++;
		}
		return { added: 0, updated, removed: 0 };
	}

	const remaining = [...next];
	let removed = 0;
	for (const bullet of previous) {
		const index = remaining.indexOf(bullet);
		if (index === -1) removed++;
		else remaining.splice(index, 1);
	}
	return { added: remaining.length, updated: 0, removed };
}

export function countChanges(
	current: string | null,
	proposed: string,
): { added: number; updated: number; removed: number } {
	const next = splitFile(proposed);
	const previous = currentSections(current);

	const nextPreferences = "detail" in next ? [] : next.preferences;
	const nextFacts = "detail" in next ? [] : next.facts;

	const preferences = sectionDiff(previous.preferences, nextPreferences);
	const facts = sectionDiff(previous.facts, nextFacts);

	return {
		added: preferences.added + facts.added,
		updated: preferences.updated + facts.updated,
		removed: preferences.removed + facts.removed,
	};
}
