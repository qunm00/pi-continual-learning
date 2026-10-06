## Learned User Preferences

- When asking for the continual-learning memory update, ask permission first, run it inline, stash current changes before running, and commit once it finishes
- Prefer running the memory update inline in the main agent instead of delegating to a subagent
- Search session files at the project level (`.pi/sessions/`) first, then the user profile level (`~/.pi/agent/sessions/`)
- Review changes before committing, then commit and push to `origin/main`

## Learned Workspace Facts

- `.pi/` is git-ignored local runtime state: it holds session transcripts and `continual-learning.json` cadence state
- The package is a pnpm workspace using Biome for lint/format and `tsc --noEmit` for typecheck
- `CONTINUAL_LEARNING_MESSAGE` in `extensions/continual-learning/constants.ts` tells the agent to launch the updater subagent with a self-contained prompt
- The skill (`skills/continual-learning/SKILL.md`) is the single definition of the update pipeline
- `AGENTS.md` holds only the `Learned User Preferences` and `Learned Workspace Facts` sections, with plain bullets