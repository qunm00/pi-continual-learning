# Continual Learning for pi

Automatically and incrementally keeps `AGENTS.md` up to date from session transcripts.

The plugin combines:

- An **extension** that hooks `agent_settled` events and decides when to trigger learning
- A **skill** (`continual-learning`) that orchestrates the learning flow

When the extension triggers, the main agent runs the flow inline. It asks the user for permission, stashes pending changes, mines new or changed session transcripts, updates `AGENTS.md`, and commits the result without pushing.

It is designed to avoid noisy rewrites by:

- Reading existing `AGENTS.md` first and updating matching bullets in place
- Processing only new or changed session files
- Writing plain bullet points only (no evidence/confidence metadata)
- Being conservative — only extracting recurring user preferences and stable workspace facts

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

On eligible `agent_settled` events, the extension may send a follow-up message that tells the agent to run the continual-learning memory update flow.

The extension keeps local runtime state in:

- `.pi/state/continual-learning.json` (cadence state)

The memory update uses an incremental session index at:

- `.pi/state/continual-learning-index.json`

## Trigger cadence

Default cadence:

- minimum 10 completed agent turns
- minimum 120 minutes since the last run
- session file mtime must advance since the previous run

Trial mode defaults (opt-in via env var):

- minimum 3 completed turns
- minimum 15 minutes
- automatically expires after 24 hours, then falls back to default cadence

### Manual trigger

You can also trigger the memory update manually at any time:

```text
/continual-learning
```

Or by invoking the skill:

```text
/skill:continual-learning
```

## Environment overrides

| Variable | Legacy variable | Default |
|----------|----------------|---------|
| `CONTINUAL_LEARNING_MIN_TURNS` | `CONTINUOUS_LEARNING_MIN_TURNS` | `10` |
| `CONTINUAL_LEARNING_MIN_MINUTES` | `CONTINUOUS_LEARNING_MIN_MINUTES` | `120` |
| `CONTINUAL_LEARNING_TRIAL_MODE` | `CONTINUOUS_LEARNING_TRIAL_MODE` | (disabled) |
| `CONTINUAL_LEARNING_TRIAL_MIN_TURNS` | `CONTINUOUS_LEARNING_TRIAL_MIN_TURNS` | `3` |
| `CONTINUAL_LEARNING_TRIAL_MIN_MINUTES` | `CONTINUOUS_LEARNING_TRIAL_MIN_MINUTES` | `15` |
| `CONTINUAL_LEARNING_TRIAL_DURATION_MINUTES` | `CONTINUOUS_LEARNING_TRIAL_DURATION_MINUTES` | `1440` (24h) |

Set any of these in your environment or `.env` file to override the defaults.

## Output format in AGENTS.md

The memory update writes only:

```markdown
## Learned User Preferences
## Learned Workspace Facts
```

Each item is a plain bullet point, with no metadata or evidence tags.

## Project structure

```
pi-continual-learning/
├── package.json                          # Pi package manifest
├── README.md                             # This file
├── LICENSE                               # MIT License
├── extensions/
│   └── continual-learning/
│       ├── constants.ts                 # Trigger cadence + follow-up message
│       ├── index.ts                      # Event hook + /continual-learning command
│       ├── state.ts                      # Cadence state persistence
│       └── types.ts
└── skills/
    └── continual-learning/
        └── SKILL.md                      # Skill definition
```

## License

MIT
