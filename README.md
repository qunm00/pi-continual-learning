# Continual Learning for pi

Keeps `AGENTS.md` current without interrupting the work it learns from.

The extension counts new sessions. Once enough have passed, the next new
session asks one yes/no question. On yes, a one-shot model call reads the
recent transcripts in the background and writes a proposal file. Nothing is
written to `AGENTS.md` until you run `/continual-learning apply`.

## Why it works this way

Older versions sent a follow-up message into the live session. That started a
new agent turn mid-task, stashed uncommitted work, and committed on its own.
This version does none of that:

- the question appears at session start, before the first turn
- the run makes one model call and touches nothing in the conversation
- the run has no tools, so it cannot write, stash, or commit
- the only artifact is `AGENTS.proposal.md`, which you review and apply

## Installation

### From npm

```bash
pi install npm:pi-continual-learning
```

### From git

```bash
pi install git:github.com/user/pi-continual-learning
```

### From local path

```bash
pi install /path/to/pi-continual-learning
```

### Try without installing

```bash
pi -e /path/to/pi-continual-learning
```

### Activate

After installation, reload pi to activate the extension and skill:

```bash
/reload
```

Or restart pi.

## How it works

1. Each new session (`startup` or `new`, not `resume`, `fork`, or `/reload`)
   increments a counter in `.pi/state/continual-learning.json`.
2. When the counter reaches the interval, the session asks once:
   "Run a memory proposal from the last N sessions in the background?"
3. On yes, the extension condenses the new session transcripts (user and
   assistant text only) and makes one model call. No agent turn is involved.
4. The response is validated and written to `AGENTS.proposal.md`.
5. `/continual-learning apply` shows a diff and writes `AGENTS.md` if you
   accept it. No commit is created.

If you decline, the counter resets and it stays quiet for another interval.

## Commands

| Command | What it does |
|---------|--------------|
| `/continual-learning` | Starts a run now, without the startup question |
| `/continual-learning apply` | Shows the diff and applies `AGENTS.proposal.md` |
| `/continual-learning log` | Shows the last 10 runs |

## Model

The run uses the model in this file:

```
~/.pi/agent/extensions/continual-learning/config.json
```

```json
{
  "model": "anthropic/claude-haiku-4-5"
}
```

- `model` is `provider/id`.
- Unknown keys are ignored.
- No file, no `model` key, an empty string, or `null` means: use the model the
  session was started with.
- A malformed file, or a configured model that does not exist or has no auth,
  fails the run and is recorded in the log. It never falls back silently.

The extension only reads this file; it never creates or edits it.

## Output files

| Path | Purpose |
|------|---------|
| `AGENTS.proposal.md` | Proposed `AGENTS.md`, replaced by each successful run, deleted after apply |
| `.pi/state/continual-learning.json` | Session counter and in-flight claim |
| `.pi/state/continual-learning-index.json` | Which session transcripts were processed |
| `.pi/state/continual-learning-runs.jsonl` | Local run log, newest 200 records |
| `.pi/state/proposals/rejected-*.txt` | Raw model output that failed validation, newest 5 |

`AGENTS.proposal.md` is untracked, so it shows in `git status` until you apply
or delete it. Everything else lives under `.pi/`, which is git-ignored.

## Trigger cadence

Defaults:

- 5 new sessions between prompts
- declining resets the counter, so the next prompt is another 5 sessions away

Trial mode (opt-in via env var):

- 1 session between prompts
- applies for 24 hours after the first counted session

## Environment overrides

| Variable | Legacy variable | Default |
|----------|----------------|---------|
| `CONTINUAL_LEARNING_SESSION_INTERVAL` | `CONTINUOUS_LEARNING_SESSION_INTERVAL` | `5` |
| `CONTINUAL_LEARNING_TIMEOUT_MS` | `CONTINUOUS_LEARNING_TIMEOUT_MS` | `600000` |
| `CONTINUAL_LEARNING_MAX_SESSIONS` | `CONTINUOUS_LEARNING_MAX_SESSIONS` | `20` |
| `CONTINUAL_LEARNING_MAX_INPUT_CHARS` | `CONTINUOUS_LEARNING_MAX_INPUT_CHARS` | `200000` |
| `CONTINUAL_LEARNING_TRIAL_MODE` | `CONTINUOUS_LEARNING_TRIAL_MODE` | (disabled) |
| `CONTINUAL_LEARNING_TRIAL_SESSIONS` | `CONTINUOUS_LEARNING_TRIAL_SESSIONS` | `1` |
| `CONTINUAL_LEARNING_TRIAL_DURATION_MINUTES` | `CONTINUOUS_LEARNING_TRIAL_DURATION_MINUTES` | `1440` |

Set any of these in your environment or `.env` file.

## Output format in AGENTS.md

The proposal keeps only these sections in the learned part of the file:

```markdown
## Learned User Preferences
## Learned Workspace Facts
```

Each item is a plain bullet, at most 12 per section. Any other section of
`AGENTS.md` is preserved verbatim, and a proposal that changes it is rejected.

## Project structure

```
pi-continual-learning/
├── package.json                          # Pi package manifest
├── README.md
├── LICENSE
├── extensions/
│   └── continual-learning/
│       ├── index.ts                      # session_start trigger + commands
│       ├── cadence.ts                    # session counter decision
│       ├── config.ts                     # env config + model config file
│       ├── extract.ts                    # session discovery + condensation
│       ├── model.ts                      # model resolution + completion call
│       ├── prompt.ts                     # prompt, parsing, validation
│       ├── proposals.ts                  # proposal file + diff
│       ├── log.ts                        # local run log
│       ├── run.ts                        # one-shot orchestration
│       ├── state.ts                      # state, index, in-flight claim
│       ├── types.ts
│       └── constants.ts
├── skills/
│   └── continual-learning/
│       ├── SKILL.md                      # interactive wrapper
│       └── rules.md                      # memory rules
└── docs/
```

## License

MIT
