# Continual learning, out of band

Date: 2026-10-24
Status: awaiting approval

## Intent

Continual learning currently interrupts the conversation it is supposed to
learn from. On `agent_settled`, after N turns and M minutes, the extension
sends a follow-up message into the live session. That starts a new agent turn
wherever the user happens to be, asks for permission, stashes uncommitted
work, writes `AGENTS.md`, and commits in the middle of the user's task. The
run also appends its own transcript to the session, which later runs then
mine.

The user wants the loop to behave like this instead:

1. Ask once, at the start of a new session, after X sessions.
2. Run out of band when they say yes, without entering the conversation.
3. Keep a local log of every run.
4. Produce a proposal, never write `AGENTS.md` directly.
5. Let the user pick the model; default to the model the session was started
   with.

## Goals

- **G1 Trigger.** Count new sessions. At the start of a new session, once the
  counter reaches X, ask a single yes/no question. Never trigger from
  `agent_settled`, turns, or elapsed minutes.
- **G2 Consent without a turn.** The question is a startup dialog
  (`ctx.ui.confirm`), not a user message. No model turn, no tokens, no
  transcript entry.
- **G3 Out-of-band execution.** On yes, the extension makes a single model
  call in the background. No agent turn, no tools, no child process, nothing
  added to the current conversation.
- **G4 Proposal only.** The model call returns the complete proposed
  `AGENTS.md` text. The extension writes it to `AGENTS.proposal.md` in the
  project root. No run writes `AGENTS.md`.
- **G5 Log.** Every attempt appends one local JSONL record: updated,
  no-change, declined, failed, aborted, applied.
- **G6 Apply.** `/continual-learning apply` shows a diff against the current
  `AGENTS.md`, asks for confirmation, and writes only on yes.
- **G7 Manual run.** `/continual-learning` starts the same run immediately,
  without the startup dialog. `/continual-learning log` prints recent runs.
- **G8 Model.** The model is configured in
  `~/.pi/agent/extensions/continual-learning/config.json`. If that file or its
  `model` key is absent, the run uses the model the session was started with.

## Non-goals

- Syncing logs or proposals across machines. The log stays under `.pi/`;
  the proposal is a root file.
- Applying a proposal automatically, or committing on your behalf.
- Mining sessions from unrelated projects.
- Changing the two-section `AGENTS.md` format.
- Keeping the old turn/minute cadence.

## Anti-goals

The following would make this a failure even if it technically works:

- Any automatic write to `AGENTS.md`.
- Stashing or reverting the user's working tree.
- An unattended commit, or a push.
- Any agent turn, follow-up message, or toast that lands mid-task.
- A proposal that silently diverges from the `AGENTS.md` it was based on.

## Constraints

- `pi-sandbox` is an extension that wraps tool execution; it does not sandbox
  the pi process or its extensions. The obsolete `PI_SBX_*` variables are not
  part of this design.
- Print mode (`-p`) has `ctx.hasUI === false`; UI methods are no-ops. A run
  cannot ask for permission at runtime, so the design must not need one.
- A second `pi` is not guaranteed to be launchable from this install: the
  `subagent` tool failed to start one here with `MODULE_NOT_FOUND` on
  `dist/bundle/cli.js`. The design must not depend on spawning.
- Global rule: never commit without explicit approval. `apply` writes only;
  committing stays a separate user action.
- The repo has `tsc --noEmit` and Biome, no test runner.

## Approaches considered

| Approach | Why rejected |
|----------|--------------|
| Keep the in-session follow-up, tune cadence | Still starts a turn mid-work; stash and commit remain |
| Defer the same inline run to session start | Fixes timing, not the stash, commit, or transcript pollution |
| Pull-only (manual command, no prompt) | Memory rots when the user forgets; no cadence |
| Run inside a temporary git worktree | Removes git risk but not the interruption; extra merge surface |
| External scheduler (launchd, CI) | Needs repo hosting or an OS job; useless for local-only work |
| **Session-start consent + in-process model call + proposal + local log** | **Chosen** |

The chosen shape removes every failure mode at once: no turn is started, no
agent tool exists to misuse, the working tree is never touched, and the only
artifact is a proposal the user reviews.

## Design

### 1. Session counter and prompt

`pi.on("session_start")` handles everything. It runs only when:

- `ctx.hasUI` is true. Non-interactive runs (`-p`, `--mode json`) never count
  or prompt.
- `event.reason` is `"startup"` or `"new"`. Skip `"resume"`, `"fork"`, and
  `"reload"`.
- The current session file, from `ctx.sessionManager.getSessionFile()`,
  differs from `state.lastCountedSessionFile`. This deduplicates a reload that
  re-emits `session_start`.

Flow:

1. Increment `state.sessionsSincePrompt` and store
   `state.lastCountedSessionFile`; persist.
2. If `state.inFlight` is set and not stale (see section 7), stop — another run
   is already working in this project.
3. Compute the effective X. Trial mode uses `TRIAL_SESSIONS` while
   `now - state.trialStartedAtMs < TRIAL_DURATION_MINUTES`; otherwise
   `SESSION_INTERVAL` (default 5).
4. If `sessionsSincePrompt < X`, stop.
5. `ctx.ui.confirm("Continual learning", "Run a memory proposal from the last N sessions in the background?", { timeout: ... })`.
   - No timeout by default. The dialog appears before the first turn, so the
     only cost of leaving it unanswered is a session that waits.
6. On **yes**: reset the counter to 0, persist, then start the run
   (section 3). The run's own record is written when it finishes.
7. On **no** or dismiss: reset the counter to 0, persist, append a `declined`
   log record.

Declining therefore snoozes for another X sessions, as requested.

### 2. What a run reads

The extension decides which session files are in scope:

- **Project level:** `<cwd>/.pi/sessions/**/*.jsonl`.
- **User profile level:** `<agentDir>/sessions/**/*.jsonl`, filtered to files
  whose first JSONL line has `"cwd"` equal to the project root. This replaces
  the old behaviour of scanning every project's sessions.
- Exclude the current session file (it has nothing to learn from yet).
- Keep only files whose `mtimeMs` exceeds the indexed `mtimeMs` for that path.
  Unknown paths are new.
- Sort by `mtimeMs` ascending (oldest first) and take at most `MAX_SESSIONS`
  (default 20). Files past the count cap stay out of the index so the next run
  picks them up.
- Read each file and build a condensed transcript: keep only `type: "message"`
  entries with `message.role` of `user` or `assistant`, and inside them only
  `content[].type === "text"` blocks. Drop thinking, tool calls, tool results,
  and images. Cap each user message at 2 KiB and each assistant message at
  1 KiB, and take only the last 40 messages per file.
- Concatenate with a `### session <basename> (<ISO mtime>)` header per file,
  oldest first, until `MAX_INPUT_CHARS` (default 200000) is reached. Whole
  files only; never truncate mid-file. Files that do not fit are logged as
  `deferred` and left unindexed for the next run.

If the resulting list is empty, no model call is made: append a `no-change`
log record and stop. This keeps an idle project from burning a call.

### 3. The model call

The run is one non-streaming `complete()` call made from the extension, in the
pi process. No agent loop, no tools, no child process:

```ts
const model = resolveModel(ctx); // config.json model, else ctx.model
const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
const response = await complete(
  model,
  { messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }] },
  { apiKey: auth.apiKey, headers: auth.headers, env: auth.env, signal: AbortSignal.timeout(TIMEOUT_MS) },
);
```

- Model resolution:
  1. `model` from `~/.pi/agent/extensions/continual-learning/config.json`,
     when present and non-empty;
  2. otherwise `ctx.model`, the model the session was started with.

  The path is built from `getAgentDir()` rather than a hardcoded home, so an
  agent-directory override still finds it. A configured value is `provider/id`,
  split at the first `/`, and resolved with
  `ctx.modelRegistry.find(provider, id)`. An explicitly configured model that
  cannot be resolved, or has no auth, fails the run with
  `reason: "no-model"`; it does not silently fall back to the session model.
  An unreadable or malformed config file fails the run with
  `reason: "bad-config"`.
- `ctx.model` is read when the run starts and never stored in state, so a
  manual run after `/model` uses the newly selected model. A startup run uses
  whichever model the session started with.
- The request carries one user message: the rules file, the current
  `AGENTS.md`, the condensed sessions, and the output contract (section 4).
- The call is not awaited by the `session_start` handler. It proceeds in the
  background while the session is used normally; the promise is caught and
  logged.
- `TIMEOUT_MS` (default 600000) aborts it through the signal.
- Usage from the response goes into the log.
- One run per project at a time: `state.inFlight` is claimed before the call
  and cleared in a `finally`.

Why in-process rather than a spawned agent: the task is one shot, so a second
process adds an entry point to resolve, a lifecycle to supervise, and a class
of failure we have already seen. In-process also keeps auth resolution, the
model default, and the log in one place. The trade-off is no agent loop and no
adaptive file reading; the condensed transcript has to carry everything the
model needs, which section 2 ensures by construction. If the first proposals
turn out thin, the fix is a two-stage call rather than a child process.

### 4. Prompt and rules

The prompt is built in the extension and embeds the rules file directly, so
the model needs no tools:

- the contents of `skills/continual-learning/rules.md`, resolved relative to
  the extension module;
- the current `AGENTS.md`, or a note that it does not exist;
- the condensed sessions from section 2;
- the output contract below.

`rules.md` holds the extraction, merge, and format rules and nothing about
process. `SKILL.md` becomes a thin interactive wrapper that says: reads are
produced by the extension, never write `AGENTS.md` directly, use the rules file
for content. This keeps one definition of what counts as durable memory while
removing the interactive steps that no longer apply.

Output contract in the prompt:

- If nothing durable is found, output exactly `No high-signal memory updates.`
  and nothing else.
- Otherwise output one summary line, then exactly one fenced block beginning
  ```` ```markdown ```` containing the complete proposed `AGENTS.md`. It may
  contain only the sections `## Learned User Preferences` and
  `## Learned Workspace Facts`, at most 12 bullets each.

### 5. Output validation and proposal

The extension extracts the first fenced `markdown` block and validates:

- non-empty, at most 20 KiB;
- both `##` headings present; any other `##` heading must exist unchanged in
  the current `AGENTS.md`;
- each section has at most 12 top-level bullets;
- **non-learned content is preserved**: strip the two learned sections from
  both the current `AGENTS.md` and the proposal; the remainders must be
  identical. A project with hand-written instructions or other sections keeps
  them byte for byte. If `AGENTS.md` does not exist, the proposal contains
  only the two learned sections.

A failed validation is logged as `failed` with `reason: "invalid-output"`,
plus a 2 KiB excerpt; the raw text is written to
`.pi/state/proposals/rejected-<stamp>.txt` for debugging. No proposal file is
created.

On success, write the proposed file to `<cwd>/AGENTS.proposal.md`:

- It is a single fixed path, not a history. Each successful run replaces it.
  The previous `proposalSha256` stays in the log, so overwrites are traceable.
- It is untracked in git, so it shows up in `git status` until applied or
  deleted. The extension never adds it to `.gitignore`.
- `/continual-learning apply` deletes it after writing `AGENTS.md`.
- There is no proposal retention to manage; the log keeps the history.

Rejected raw output still goes to `.pi/state/proposals/rejected-<stamp>.txt`,
retaining the newest 5.

Record in the log the proposal path, its SHA-256, the SHA-256 of the
`AGENTS.md` it was based on, and the counts of added, updated, and removed
bullets.

### 6. Log

`.pi/state/continual-learning-runs.jsonl`, append-only, one JSON object per
line, local and git-ignored. Written only by the extension. Trim to the last
200 records on each append.

Record shapes:

```json
{"type":"run","at":"ISO","trigger":"startup|manual","model":"provider/id",
 "startedAt":"ISO","finishedAt":"ISO","durationMs":1234,
 "sessions":[{"path":"...","mtimeMs":1}],"deferred":["..."],
 "outcome":"proposal|no-change|failed","proposalPath":"...",
 "proposalSha256":"...","baseAgentsSha256":"...","baseAgentsMtimeMs":1,
 "changes":{"added":2,"updated":1,"removed":0},
 "usage":{"input":0,"output":0,"cost":0},
 "error":"..."}

{"type":"declined","at":"ISO","sessionsSincePrompt":5}
{"type":"aborted","at":"ISO","startedAt":"ISO"}
{"type":"applied","at":"ISO","proposalPath":"...","proposalSha256":"..."}
```

`/continual-learning log` formats the last 10 records into a short markdown
table and shows it in the transcript with
`pi.sendMessage({customType:"continual-learning-log", content, display:true}, {triggerTurn:false})`.
No turn is started and no tokens are spent. In modes without UI, fall back to
`ctx.ui.notify` with the newest three lines.

### 7. State, index, and crash handling

`.pi/state/continual-learning.json`, version 2:

```ts
type State = {
  version: 2;
  sessionsSincePrompt: number;
  lastCountedSessionFile: string | null;
  trialStartedAtMs: number | null;
  inFlight: { startedAtMs: number; trigger: "startup" | "manual" } | null;
};
```

Migration: a version 1 file becomes version 2 with `sessionsSincePrompt: 0`,
`lastCountedSessionFile: null`, `inFlight: null`, and its
`trialStartedAtMs` preserved. All other fields are discarded.

`.pi/state/continual-learning-index.json` keeps its shape:
`{ "version": 1, "files": { "<abs path>": { "mtimeMs": number, "size": number, "processedAt": "ISO" } } }`.
The parent updates it after a successful proposal or no-change run, adding the
files that were included in the payload, and removing entries for deleted
files. Deferred, failed, and aborted runs leave the index untouched so the
next run retries those files.

All state, index, log, and proposal writes go through `withFileMutationQueue`
to serialise concurrent sessions in the same project. The in-flight claim is
its own queued read-modify-write, taken before the prompt appears, so two
sessions starting at once cannot both ask; the counter update is a separate
queued operation.

Crash handling: at `session_start`, if `inFlight` is present and
`Date.now() - startedAtMs > TIMEOUT_MS + 300000`, append an `aborted` record
and clear it. A call that is still running when pi quits leaves this marker
behind.

### 8. Commands

- `/continual-learning` — manual run. Skips the dialog (an explicit command is
  consent), logs `trigger: "manual"`, makes the call. If a run is already in
  flight, notify and do nothing.
- `/continual-learning apply` — reads `AGENTS.proposal.md`:
  1. Compute the diff with
     `git diff --no-index --unified=3 -- AGENTS.md AGENTS.proposal.md` (exit
     code 1 is expected when they differ). If the repo is not a git repo, fall
     back to a plain line-by-line comparison summary.
  2. If the current `AGENTS.md` SHA-256 differs from the proposal's
     `baseAgentsSha256`, prefix the confirmation with a staleness warning. The
     base hash is read from the newest `run` record in the log whose
     `proposalPath` matches the current proposal file.
  3. Show `ctx.ui.confirm("Apply proposal?", diff, ...)`, truncating the diff to
     160 lines with a pointer to both files.
  4. On yes, write the proposal content to `AGENTS.md` inside the mutation
     queue, delete `AGENTS.proposal.md`, append an `applied` record, notify the
     path, and stop. No commit.
  5. On no, change nothing.
- `/continual-learning log` — render the recent records as described in
  section 6.

If `AGENTS.proposal.md` does not exist, `apply` notifies that none is
waiting.

## Configuration

One file per machine, next to the extension's own directory:

```
~/.pi/agent/extensions/continual-learning/config.json
{"model": "anthropic/claude-haiku-4-5"}
```

- Built from `getAgentDir()` at run time, never cached.
- Only `model` is read in this version; unknown keys are ignored so the file
  can grow without breaking.
- Absent file, absent key, empty string, or `null` means "use the session's
  model".
- Malformed JSON or a non-string `model` fails the run with `bad-config`.
- The extension never creates or edits the file; it only reads it.
- The directory holds no `index.ts`, so pi's extension discovery
  (`~/.pi/agent/extensions/*/index.ts`) does not try to load it.

Precedence: config file → session model. There is no environment override for
this setting.

| Variable | Default | Meaning |
|----------|---------|---------|
| `CONTINUAL_LEARNING_SESSION_INTERVAL` | `5` | X — new sessions between prompts |
| `CONTINUAL_LEARNING_TIMEOUT_MS` | `600000` | Abort the request |
| `CONTINUAL_LEARNING_MAX_SESSIONS` | `20` | Files per run |
| `CONTINUAL_LEARNING_MAX_INPUT_CHARS` | `200000` | Condensed payload cap |
| `CONTINUAL_LEARNING_TRIAL_MODE` | off | Enables trial window |
| `CONTINUAL_LEARNING_TRIAL_SESSIONS` | `1` | X during trial |
| `CONTINUAL_LEARNING_TRIAL_DURATION_MINUTES` | `1440` | Trial window |

Legacy `CONTINUOUS_LEARNING_*` names stay accepted as aliases, as today. The
old `MIN_TURNS`, `MIN_MINUTES`, `TRIAL_MIN_TURNS`, and `TRIAL_MIN_MINUTES`
variables are removed from the docs and ignored at runtime.

## Risks

**A second pi may not launch.** The `subagent` tool failed here with
`MODULE_NOT_FOUND` on `dist/bundle/cli.js`, for reasons not established. The
design avoids spawning entirely, so that failure cannot affect it. If a
spawned agent is wanted later, verify the entry point first; do not assume the
example's `getPiInvocation` works in every install layout.

**Payload quality.** Condensing transcripts to user and assistant text can drop
context that mattered, for example a fact established through tool output. The
rules should prefer repeated user statements and corrections, which survive
condensation. If proposals turn out thin, the remedy is a two-stage call
(per-file extraction, then merge), not a return to agent children.

## Files to change

- `extensions/continual-learning/cadence.ts` (new) — pure session-count decision.
- `extensions/continual-learning/index.ts` — session_start handler, commands,
  in-flight lock, orchestration.
- `extensions/continual-learning/config.ts` (new) — read and validate
  `config.json`, resolve the model.
- `extensions/continual-learning/model.ts` (new) — auth, `complete()` call,
  response extraction, usage.
- `extensions/continual-learning/extract.ts` (new) — session discovery,
  header filtering, JSONL condensation, payload caps.
- `extensions/continual-learning/prompt.ts` (new) — prompt builder and output
  validation.
- `extensions/continual-learning/proposals.ts` (new) — write, read, delete,
  diff, apply.
- `extensions/continual-learning/log.ts` (new) — append, trim, format.
- `extensions/continual-learning/state.ts` — v2 schema, migration, session
  dedupe, in-flight, index update.
- `extensions/continual-learning/types.ts`, `constants.ts` — new types,
  defaults, env names, paths.
- `skills/continual-learning/rules.md` (new) — extraction and format rules.
- `skills/continual-learning/SKILL.md` — thin interactive wrapper.
- `README.md` — new behaviour, configuration, commands.
- `package.json` — version 2.0.0.

## Verification

- `pnpm typecheck` and `pnpm biome:fix` pass.
- With `CONTINUAL_LEARNING_SESSION_INTERVAL=1`, starting a fresh session in a
  git repo shows exactly one dialog; declining writes a `declined` record and
  no dialog appears on the next session.
- Accepting makes one model call, leaves `AGENTS.md` untouched, and writes
  `AGENTS.proposal.md` plus a `run` record, with nothing appended to the
  current session transcript.
- `/continual-learning apply` shows a diff; cancel leaves both files
  unchanged; confirm writes `AGENTS.md` and deletes the proposal; no commit is
  created.
- With `~/.pi/agent/extensions/continual-learning/config.json` naming a valid
  model, the run uses it; deleting the file falls back to the session model.
- A malformed config file logs `failed` with `reason: "bad-config"` and makes
  no call.
- A configured but unknown model logs `failed` with `reason: "no-model"`
  instead of falling back.
- With a project containing more changed session files than the payload cap
  allows, the leftovers appear in `deferred` and are processed on a later run.
- `git status` is clean after a run except for files the user already had.
- A call that is interrupted by quitting pi is logged as `aborted` on the next
  start.

## Calls I made

1. X defaults to 5.
2. Declining resets the counter (snooze X), per the user's answer.
3. The proposal is a complete file, not a patch, written to
   `AGENTS.proposal.md` at the project root. Each successful run replaces it
   and `apply` deletes it; the log holds the history.
4. `apply` writes only; committing stays manual, per the global rule.
5. Everything runs inside the extension: it reads sessions, calls the model,
   and writes the proposal, index, and log. No spawned process; a second `pi`
   is not guaranteed to launch and adds nothing to a one-shot call.
6. A call interrupted by quitting pi is lost and logged as `aborted` next time.
7. Model comes from `~/.pi/agent/extensions/continual-learning/config.json`;
   with no file or key, the session's model. Resolved per run, never cached.
8. Session discovery is filtered to this project's sessions, including the
   matching user-profile directory.
9. Failed runs consume the cadence; the next prompt is X sessions away.
10. Trial mode is expressed in sessions rather than turns and minutes.
11. Extraction rules move to `rules.md`; `SKILL.md` becomes a thin wrapper.
12. A proposal preserves every non-learned section of `AGENTS.md` verbatim;
    only the two learned sections change.
13. Model config is a single per-machine file at
    `~/.pi/agent/extensions/continual-learning/config.json`; no project file,
    no environment override for it.

## Left to the builder

- Exact prompt wording and the response parsing details.
- The diff rendering fallback for a non-git directory.
- Retention implementation details for rejected outputs.
- Exact condensation limits; the defaults are a starting point, not a spec.
- Any additional unit-test scaffolding; the repo has none today.
