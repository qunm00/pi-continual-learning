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
 * The agent reads these instructions and uses its built-in tools to perform
 * the update directly — no separate subagent process needed.
 */
export const CONTINUAL_LEARNING_MESSAGE = `Run the continual-learning memory update now.

## Instructions

1. Read existing \`AGENTS.md\` from the project root. If it does not exist, create it with:
   - \`## Learned User Preferences\`
   - \`## Learned Workspace Facts\`

2. Discover session files under \`~/.pi/agent/sessions/\` that are new or have been modified
   since the last update. Use \`find ~/.pi/agent/sessions/ -name "*.jsonl"\` and \`stat\` to check mtimes
   relative to the index at \`.pi/state/continual-learning-index.json\`.

3. For each new or changed session file, parse the JSONL content to extract high-signal,
   durable insights:
   - **Recurring user preferences or corrections** — things the user asked for more than once
   - **Stable workspace facts** — project structure, conventions, architecture decisions
   - Exclude one-off/transient details, secrets, private data, and process instructions

4. Update \`AGENTS.md\`:
   - Update matching bullets in place
   - Add only net-new bullets
   - Deduplicate semantically similar bullets
   - Keep each learned section to at most 12 bullets
   - Use plain bullet points only (no evidence/confidence tags)
   - Keep only the two sections: \`## Learned User Preferences\` and \`## Learned Workspace Facts\`

5. Track processed session files in \`.pi/state/continual-learning-index.json\`:
   - Record filename and mtime for each processed session
   - Remove entries for deleted session files
   - Update mtimes for reprocessed files

6. If the merge produces no changes to \`AGENTS.md\`, leave it unchanged but still refresh the index.

7. If no meaningful updates exist, respond exactly: \`No high-signal memory updates.\`

## Important

- Use plain bullet points only
- Do not write evidence/confidence tags
- Do not write process instructions, rationale, or metadata blocks
- Exclude secrets, private data, one-off instructions, and transient details
- Be conservative — only extract recurring or stable information`;
