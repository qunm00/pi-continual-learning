# Memory rules

These rules decide what belongs in `AGENTS.md`. They are the single source of
truth for both the out-of-band run and the interactive skill.

## What counts as durable

- A preference or correction the user stated more than once, or stated once as
  a standing rule that will apply to future work.
- A stable workspace fact: project structure, conventions, architecture
  decisions, tooling choices, commands that are not obvious from the code.
- A constraint that would otherwise be rediscovered the hard way.

## What to exclude

- One-off or transient instructions ("use the staging URL for this test").
- Secrets, credentials, tokens, private data, and anything personal.
- Process instructions, rationale, evidence, confidence, dates, or metadata.
- Anything already covered by an existing bullet; merge into it instead.
- Speculation and anything the user did not say or demonstrate.

## How to merge

- Read the current `AGENTS.md` first.
- Update matching bullets in place rather than adding near-duplicates.
- Add only net-new bullets.
- Deduplicate semantically similar bullets.
- Keep each learned section to at most 12 bullets. Drop the least durable one
  when over the limit.
- Use plain bullet points only. No evidence, confidence, dates, or tags.
- Keep only these two sections:
  - `## Learned User Preferences`
  - `## Learned Workspace Facts`
- Preserve every other part of `AGENTS.md` exactly as it is. If the file does
  not exist, create it with only the two learned sections.

## Response shape

- Nothing durable: the single line `No high-signal memory updates.`
- Otherwise: a short summary line, then one fenced `markdown` block with the
  complete proposed `AGENTS.md`.
