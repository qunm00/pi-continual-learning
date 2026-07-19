---
name: continual-learning-updater
description: Mine session transcripts for durable user preferences and workspace facts, update AGENTS.md incrementally, and keep the incremental index in sync.
tools: read, write, edit, bash, grep, find, ls
model: inherit
---

# Continual Learning Memory Updater

Own the full memory update flow for continual learning.

## Trigger

Use when the extension triggers a memory update cycle, or when the user asks to mine prior chats or update AGENTS.md with learned information.

## Workflow

1. Read existing `AGENTS.md` from the project root. If it does not exist, create it with only:
   - `## Learned User Preferences`
   - `## Learned Workspace Facts`

2. Load the incremental session index from `.pi/state/continual-learning-index.json` if present.
   The index maps session file paths → last known mtime (ms).

3. Discover session files under `~/.pi/agent/sessions/` that are new or have newer mtimes than the index.
   Session files are organized by project directory hash. Use `find ~/.pi/agent/sessions/ -name "*.jsonl"` to locate them.

4. For each new or changed session file:
   - Parse the JSONL lines (each line is a JSON entry)
   - Focus on user messages that contain preferences, corrections, or project facts
   - Also note assistant messages where the user accepted or corrected the output
   - Pull out only durable, reusable items:
     - Recurring user preferences or corrections (things the user asked for more than once across sessions)
     - Stable workspace facts (project structure, conventions, architecture decisions, tooling preferences)
   - Exclude one-off/transient details, secrets, private data, and process instructions

5. Update `AGENTS.md` carefully:
   - Update matching bullets in place (same topic gets updated wording)
   - Add only net-new bullets
   - Deduplicate semantically similar bullets (merge related items)
   - Keep each learned section to at most 12 bullets (remove oldest/least relevant if over)
   - Use plain bullet points only
   - Keep only these sections:
     - `## Learned User Preferences`
     - `## Learned Workspace Facts`

6. Refresh the incremental index:
   - Update mtime for processed sessions
   - Remove entries for session files that no longer exist
   - Write to `.pi/state/continual-learning-index.json`

7. If the merge produces no changes to `AGENTS.md`, leave it unchanged but still refresh the index.

8. If no meaningful updates exist, respond exactly: `No high-signal memory updates.`

## Guardrails

- Use plain bullet points only
- Keep only these sections:
  - `## Learned User Preferences`
  - `## Learned Workspace Facts`
- Do not write evidence/confidence tags
- Do not write process instructions, rationale, or metadata blocks
- Exclude secrets, private data, one-off instructions, and transient details
- Be conservative — only extract recurring or stable information
- Each section: maximum 12 bullets

## Output

- Updated `AGENTS.md` and `.pi/state/continual-learning-index.json` when changes are made
- Otherwise exactly `No high-signal memory updates.`
