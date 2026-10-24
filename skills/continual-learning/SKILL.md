---
name: continual-learning
description: Explain how continual learning works, where the proposal and log live, and how to apply a pending proposal.
disable-model-invocation: true
---

# Continual Learning

Runs are produced by the extension, out of band. A run never edits
`AGENTS.md`; it writes `AGENTS.proposal.md` at the project root.

## Content rules

The rules for what counts as durable memory, how to merge bullets, and the
allowed output shape live in `rules.md` next to this file. Read it before
writing or judging a proposal.

## What to tell the user

- `/continual-learning` starts a run in the background immediately.
- `/continual-learning apply` shows a diff and writes `AGENTS.md` if accepted.
- `/continual-learning log` shows the recent runs.

The proposal is written to `AGENTS.proposal.md`; the log and the state live in
`.pi/state/`, which is local and git-ignored.

## Rules of engagement

- Never write `AGENTS.md` directly. Only `/continual-learning apply` writes it.
- Never stash, commit, or push on the user's behalf as part of a run.
- Config for the model lives in
  `~/.pi/agent/extensions/continual-learning/config.json`; with no file, the
  run uses the session's model.
