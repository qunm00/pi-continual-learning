## Learned User Preferences

- When asking for the continual-learning memory update, ask permission first, run it inline, stash current changes before running, and commit once it finishes
- Prefer delegating the memory update to the `continual-learning-updater` subagent instead of doing the work inline in the main agent
- Search session files at the project level (`.pi/sessions/`) first, then the user profile level (`~/.pi/agent/sessions/`)
- Review changes before committing, then commit and push to `origin/main`

## Learned Workspace Facts

- `.pi/` is git-ignored local runtime state: it holds session transcripts and `continual-learning.json` cadence state
- The package is a pnpm workspace using Biome for lint/format and `tsc --noEmit` for typecheck
- `CONTINUAL_LEARNING_MESSAGE` in `extensions/continual-learning/constants.ts` tells the agent to launch the updater subagent with a self-contained prompt
- The skill (`skills/continual-learning/SKILL.md`) and the subagent (`agents/continual-learning-updater.md`) intentionally describe the same pipeline from two perspectives
- `AGENTS.md` holds only the `Learned User Preferences` and `Learned Workspace Facts` sections, with plain bullets