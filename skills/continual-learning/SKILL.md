---
name: continual-learning
description: Orchestrate continual learning by mining session transcripts for durable user preferences and workspace facts, updating AGENTS.md incrementally.
disable-model-invocation: true
---

# Continual Learning

Keep `AGENTS.md` current by mining session transcripts for reusable, high-signal information.

## Trigger

Use when the user asks to mine prior chats, maintain `AGENTS.md`, or run the continual-learning loop. Also triggered automatically by the continual-learning extension after enough turns and elapsed time.

## Operating rules

These rules always apply, for both the manual trigger and the automatic trigger:

- **Ask permission before running.** Use `ask_user` and wait for a clear yes before touching any file. Do not start the update while the request is unanswered or skipped.
- **Run inline.** Do the discovery, parsing, and merge yourself in the current session. Do not delegate to a subagent.
- **Stash before running.** If the working tree has uncommitted changes, run `git stash push -u -m "continual-learning: pre-run stash"` first. Note the stash name so it can be reported later. Do not pop it during the run — the files you write must not mix with the user's work in progress.
- **Commit when finished.** After a successful run that produced changes, stage the updated `AGENTS.md` (and the index file if it is tracked) and commit with the message `docs: update AGENTS.md via continual-learning`. Do not push. Leave the user's stash in place and tell the user it exists, so they can pop it themselves.

If the run produces no changes to `AGENTS.md`, still refresh the index and do not create an empty commit.

## Workflow

1. Read existing `AGENTS.md` from the project root. If it does not exist, create it with only:
   - `## Learned User Preferences`
   - `## Learned Workspace Facts`

2. Discover session files that are new or have been modified since the last update. Search in this order:
   - **Project level** first: `.pi/sessions/` under the project root
   - **User profile level** second: `~/.pi/agent/sessions/`
   Process project-level files first. Use `find` and `stat` to check mtimes relative to `.pi/state/continual-learning-index.json`.

3. For each new or changed session file, parse the JSONL content to extract high-signal, durable insights:
   - Recurring user preferences or corrections (things the user asked for more than once)
   - Stable workspace facts (project structure, conventions, architecture decisions)
   - Exclude one-off/transient details, secrets, private data, and process instructions

4. Update `AGENTS.md`:
   - Update matching bullets in place
   - Add only net-new bullets
   - Deduplicate semantically similar bullets
   - Keep each learned section to at most 12 bullets
   - Use plain bullet points only (no evidence/confidence tags)
   - Keep only the two sections: `## Learned User Preferences` and `## Learned Workspace Facts`

5. Track processed session files in `.pi/state/continual-learning-index.json`:
   - Record filename and mtime for each processed session
   - Remove entries for deleted session files
   - Update mtimes for reprocessed files

6. If the merge produces no changes to `AGENTS.md`, leave it unchanged but still refresh the index.

7. If no meaningful updates exist, respond exactly: `No high-signal memory updates.`

## Guardrails

- Use plain bullet points only
- Keep only these sections:
  - `## Learned User Preferences`
  - `## Learned Workspace Facts`
- Do not write evidence/confidence tags
- Do not write process instructions, rationale, or metadata blocks
- Exclude secrets, private data, one-off instructions, and transient details
- Be conservative — only extract recurring or stable information

## Output

- Updated `AGENTS.md` and `.pi/state/continual-learning-index.json` when changes are made
- A single commit for the changes, and a note about any pre-run stash
- Otherwise exactly `No high-signal memory updates.`
- If the user declines or skips the permission question, stop immediately and make no changes
