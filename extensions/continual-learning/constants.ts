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
 * The agent delegates the update to a subagent, which discovers session files
 * first at the project level (.pi/sessions/), then at the user profile level
 * (~/.pi/agent/sessions/).
 */
export const CONTINUAL_LEARNING_MESSAGE = `Run the continual-learning memory update now by delegating to a subagent.

## Instructions

1. Launch the \`continual-learning-updater\` subagent via the Agent tool
   (subagent_type: "continual-learning-updater"; fall back to "general-purpose"
   if that type is not registered). Run it in the foreground and wait for it to
   finish. Do not parse session files or edit \`AGENTS.md\` yourself.

2. Give the subagent a self-contained prompt that includes:
   - The project root (your current working directory), where \`AGENTS.md\` and
     \`.pi/state/continual-learning-index.json\` live
   - The session discovery order below
   - The memory update rules below

3. Session discovery order — search the project level first, then the user profile level:
   a. **Project level**: \`.pi/sessions/\` under the project root
      (\`find .pi/sessions/ -name "*.jsonl"\` from the project root)
   b. **User profile level**: \`~/.pi/agent/sessions/\`
      (\`find ~/.pi/agent/sessions/ -name "*.jsonl"\`)
   Process project-level files first, then user-profile files. For each file, use
   \`stat\` to compare its mtime against the index and process only files that are
   new or changed. If a file appears in both locations, prefer the project-level one.

4. Memory update rules for the subagent:
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

5. After the subagent finishes, report its outcome. If it produced no meaningful
   updates, respond exactly: \`No high-signal memory updates.\`

## Important

- Delegate the work to the subagent — do not run the discovery or merge yourself
- The subagent must search project-level sessions (\`.pi/sessions/\`) before
  user-profile sessions (\`~/.pi/agent/sessions/\`)
- Plain bullet points only; no evidence/confidence tags
- Do not write process instructions, rationale, or metadata blocks
- Exclude secrets, private data, one-off instructions, and transient details
- Be conservative — only extract recurring or stable information`;
