/**
 * Constants for the continual-learning extension.
 */

import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

export const STATE_DIR_RELATIVE = `${CONFIG_DIR_NAME}/state`;
export const STATE_FILE_RELATIVE = `${STATE_DIR_RELATIVE}/continual-learning.json`;
export const INDEX_FILE_RELATIVE = `${STATE_DIR_RELATIVE}/continual-learning-index.json`;

export const DEFAULT_MIN_TURNS = 10;
export const DEFAULT_MIN_MINUTES = 120;
export const TRIAL_DEFAULT_MIN_TURNS = 3;
export const TRIAL_DEFAULT_MIN_MINUTES = 15;
export const TRIAL_DEFAULT_DURATION_MINUTES = 24 * 60;

/**
 * Follow-up message sent to the agent when the memory update cadence is met.
 * The agent runs the update inline: it asks permission, stashes pending work,
 * discovers session files first at the project level (.pi/sessions/), then at
 * the user profile level (~/.pi/agent/sessions/), and commits the result.
 */
export const CONTINUAL_LEARNING_MESSAGE = `Run the continual-learning memory update now. Follow the \`continual-learning\` skill.

## Before you start

1. Ask the user for permission using the \`ask_user\` tool and wait for a clear
   yes. If the question is skipped or declined, stop and change nothing.

2. If \`git status --porcelain\` reports uncommitted changes, stash them first:

   \`\`\`
   git stash push -u -m "continual-learning: pre-run stash"
   \`\`\`

   Do not pop the stash during this run. Remember that it exists so you can tell
   the user about it at the end.

## Instructions

1. Run the update inline in this session. Do not delegate to a subagent.

2. Session discovery order — search the project level first, then the user profile level:
   a. **Project level**: \`.pi/sessions/\` under the project root
      (\`find .pi/sessions/ -name "*.jsonl"\` from the project root)
   b. **User profile level**: \`~/.pi/agent/sessions/\`
      (\`find ~/.pi/agent/sessions/ -name "*.jsonl"\`)
   Process project-level files first, then user-profile files. For each file, use
   \`stat\` to compare its mtime against the index and process only files that are
   new or changed. If a file appears in both locations, prefer the project-level one.

3. Memory update rules:
   - Read existing \`AGENTS.md\` from the project root. If missing, create it with
     \`## Learned User Preferences\` and \`## Learned Workspace Facts\`
   - Parse each new or changed session JSONL and extract only high-signal, durable
     insights: recurring user preferences or corrections, and stable workspace facts;
     exclude one-off/transient details, secrets, private data, and process instructions
   - Update matching bullets in place, add only net-new bullets, deduplicate
     semantically similar bullets, keep each learned section to at most 12 bullets,
     use plain bullet points only
   - Track processed session files in \`.pi/state/continual-learning-index.json\`
     (record filename and mtime per file, remove entries for deleted files, update
     mtimes for reprocessed files)
   - If the merge produces no changes to \`AGENTS.md\`, leave it unchanged but still
     refresh the index

4. After the merge, stage \`AGENTS.md\` (plus the index file if it is tracked) and
   commit with: \`docs: update AGENTS.md via continual-learning\`. Do not push, and
   do not create an empty commit when nothing changed.

5. Report the outcome, including whether a pre-run stash was created. If the run
   produced no meaningful updates, respond exactly: \`No high-signal memory updates.\`

## Important

- Ask permission first; stop if it is not granted
- Run the discovery and merge yourself — do not delegate to a subagent
- Search project-level sessions (\`.pi/sessions/\`) before user-profile sessions
  (\`~/.pi/agent/sessions/\`)
- Stash pending changes before running and leave the stash in place
- Commit the result when it changes \`AGENTS.md\`; never push
- Plain bullet points only; no evidence/confidence tags
- Do not write process instructions, rationale, or metadata blocks
- Exclude secrets, private data, one-off instructions, and transient details
- Be conservative — only extract recurring or stable information`;
