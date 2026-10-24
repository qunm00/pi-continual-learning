# Continual Learning Out-of-Band Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move continual learning from an interrupting in-session follow-up to a session-start consent prompt that runs a one-shot model call and writes a proposal file.

**Architecture:** The extension counts new sessions, asks once at session start, then makes a single `complete()` call with condensed transcripts and writes `AGENTS.proposal.md`. `AGENTS.md` is only written by an explicit `/continual-learning apply`. All pure logic lives in small modules tested with `node --test`; `index.ts` only adapts pi events and commands.

**Tech Stack:** TypeScript, pi extension API, `@earendil-works/pi-ai` `complete()`, Node 24+ built-in test runner, Biome.

**Spec:** `docs/superpowers/specs/2026-10-24-continual-learning-out-of-band-design.md`

## Global Constraints

- Node `>=24`, pnpm `>=11.5.0`; the only new dependency is `@earendil-works/pi-ai` (peer + dev).
- Runs never write `AGENTS.md`, never stash, never commit, never push. Only `apply` writes `AGENTS.md`, and it never commits.
- Proposal path is exactly `<cwd>/AGENTS.proposal.md`; it is replaced by each successful run and deleted after apply.
- Log path is exactly `<cwd>/.pi/state/continual-learning-runs.jsonl`, append-only, trimmed to the newest 200 records, local only.
- Model config is exactly `<agentDir>/extensions/continual-learning/config.json`; no env override for the model.
- `AGENTS.md` keeps exactly the sections `## Learned User Preferences` and `## Learned Workspace Facts`, at most 12 bullets each, plain bullets only.
- Env vars: `CONTINUAL_LEARNING_SESSION_INTERVAL` (5), `CONTINUAL_LEARNING_TIMEOUT_MS` (600000), `CONTINUAL_LEARNING_MAX_SESSIONS` (20), `CONTINUAL_LEARNING_MAX_INPUT_CHARS` (200000), `CONTINUAL_LEARNING_TRIAL_MODE`, `CONTINUAL_LEARNING_TRIAL_SESSIONS` (1), `CONTINUAL_LEARNING_TRIAL_DURATION_MINUTES` (1440); legacy `CONTINUOUS_LEARNING_*` aliases stay accepted.
- Plain `.ts` imports with explicit `.ts` extensions, tabs, Biome formatting, `tsc --noEmit` clean.

## Review Focus

1. `AGENTS.md` with hand-written sections must survive a proposal byte for byte, or the proposal must be rejected — test in Task 5.
2. An empty, truncated, or text-free session JSONL must not crash discovery or condensation — test in Task 4.
3. A config file with valid JSON but a non-string `model` (number, object, array) must fail as `bad-config`, never be coerced — test in Task 3.
4. Two sessions starting at once must produce exactly one run; the second claim must lose — test in Task 1 and Task 2.
5. A model response with prose before/after the fence, or two fenced blocks, must parse deterministically (first ```markdown fence) or fail — test in Task 5.

---

### Task 1: Test harness and v2 state

**Files:**
- Modify: `package.json` (add `test` script)
- Modify: `extensions/continual-learning/types.ts` (replace v1 types)
- Modify: `extensions/continual-learning/state.ts` (v2 state, index, in-flight lock)
- Replace: `extensions/continual-learning/index.ts` (inert factory until Task 10)
- Test: `extensions/continual-learning/state.test.ts`

**Interfaces:**
- Consumes: `withFileMutationQueue(filePath, fn)` and `CONFIG_DIR_NAME` from `@earendil-works/pi-coding-agent`.
- Produces:
  - `type Trigger = "startup" | "manual"`
  - `interface ContinualLearningState { version: 2; sessionsSincePrompt: number; lastCountedSessionFile: string | null; trialStartedAtMs: number | null; inFlight: { startedAtMs: number; trigger: Trigger } | null }`
  - `interface SessionFile { path: string; mtimeMs: number; size: number }`
  - `interface SessionIndexEntry { mtimeMs: number; size: number; processedAt: string }`
  - `interface SessionIndex { version: 1; files: Record<string, SessionIndexEntry> }`
  - `state.ts`: `getStateFilePath(cwd): string`, `getIndexFilePath(cwd): string`, `getDefaultState(): ContinualLearningState`, `loadState(cwd): ContinualLearningState`, `saveState(cwd, state): void`, `loadIndex(cwd): SessionIndex`, `saveIndex(cwd, index): void`, `mergeIndex(index, processed: SessionFile[], nowMs: number): SessionIndex`, `pruneIndex(index, exists: (path: string) => boolean): SessionIndex`, `updateState(cwd, fn: (state: ContinualLearningState) => ContinualLearningState): Promise<ContinualLearningState>`, `claimRun(cwd, trigger: Trigger, nowMs: number): Promise<boolean>`, `releaseRun(cwd): Promise<void>`, `reapStaleRun(cwd, timeoutMs: number, nowMs: number): Promise<{ startedAtMs: number } | null>`

- [ ] **Step 1: Write the failing tests**

`extensions/continual-learning/state.test.ts`, using `node:test`, `node:assert/strict`, `mkdtempSync(join(tmpdir(), "cl-state-"))`:

- `getDefaultState returns version 2 with a zero counter and no in-flight run`
- `loadState migrates a version 1 file and preserves trialStartedAtMs`
- `loadState falls back to defaults for corrupt JSON`
- `saveState then loadState round-trips all fields`
- `loadIndex returns an empty index when missing`
- `mergeIndex records processed files`
- `pruneIndex drops entries for deleted paths`
- `updateState serialises concurrent increments` — run two `updateState` calls with `Promise.all`, assert the counter is 2
- `claimRun allows one claim and rejects a second while in flight`
- `releaseRun clears the in-flight claim`
- `reapStaleRun returns null for a fresh claim and clears a stale one`

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test extensions/continual-learning/state.test.ts`
Expected: FAIL with `Cannot find module`/`is not a function` for the new exports.

- [ ] **Step 3: Implement types and state**

Write `types.ts` with the interfaces above. Rewrite `state.ts`: keep `parsePositiveInt`/`parseBoolean`/`readEnvValue`, drop `canTrigger` and `getSessionFileMtime`, implement v2 load/save with v1 migration (`version: 1` → `version: 2`, counter 0, `lastCountedSessionFile: null`, `inFlight: null`, keep numeric `trialStartedAtMs`), index helpers, and the three async state operations wrapped in `withFileMutationQueue(getStateFilePath(cwd), ...)`.

Replace `index.ts` with an inert factory:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (_pi: ExtensionAPI) {
	// Wired in Task 10: session_start trigger and commands.
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test extensions/continual-learning/state.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Add the test script and check the repo**

Add `"test": "node --test extensions/continual-learning/*.test.ts"` to `package.json` scripts.

Run: `pnpm typecheck && pnpm biome:fix && pnpm test`
Expected: no type errors, no lint errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json extensions/continual-learning/types.ts extensions/continual-learning/state.ts extensions/continual-learning/index.ts extensions/continual-learning/state.test.ts
git commit -m "feat: add v2 session-count state with in-flight lock"
```

---

### Task 2: Cadence decision

**Files:**
- Create: `extensions/continual-learning/cadence.ts`
- Test: `extensions/continual-learning/cadence.test.ts`

**Interfaces:**
- Consumes: `ContinualLearningState`, `RunConfig` (Task 3 defines `RunConfig`; declare it in `types.ts` in this task with the fields below).
- Produces:
  - `interface RunConfig { sessionInterval: number; timeoutMs: number; maxSessions: number; maxInputChars: number; trialEnabled: boolean; trialSessions: number; trialDurationMinutes: number }`
  - `type SessionStartReason = "startup" | "reload" | "new" | "resume" | "fork"`
  - `decideCadence(input: { state: ContinualLearningState; reason: SessionStartReason; hasUI: boolean; sessionFile: string | undefined; alreadyRunning: boolean; config: RunConfig; nowMs: number }): { action: "ignore" | "count" | "ask"; state: ContinualLearningState }`

- [ ] **Step 1: Write the failing tests**

Cases: `resume`, `fork`, and `reload` return `ignore` with the state untouched; `hasUI: false` returns `ignore`; a repeated `sessionFile` returns `ignore`; a first `startup` returns `count` with `sessionsSincePrompt: 1` and the file recorded; reaching `sessionInterval` returns `ask` with `sessionsSincePrompt: 0`; trial mode asks at `trialSessions` while inside `trialDurationMinutes`; `alreadyRunning: true` returns `ignore` without counting.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test extensions/continual-learning/cadence.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `decideCadence`**

Order of checks: running → ignore; reason not `startup`/`new` → ignore; `!hasUI` → ignore; same session file → ignore; otherwise increment and store the file; when trial mode is on and `trialStartedAtMs` is null, set it to `nowMs`; compute X (`config.trialEnabled` and inside the window → `trialSessions`, else `sessionInterval`); `>= X` → `ask` with counter reset to 0, else `count`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test extensions/continual-learning/cadence.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm typecheck && pnpm biome:fix`

```bash
git add extensions/continual-learning/cadence.ts extensions/continual-learning/cadence.test.ts extensions/continual-learning/types.ts
git commit -m "feat: add session cadence decision"
```

---

### Task 3: Run config and model config file

**Files:**
- Modify: `extensions/continual-learning/constants.ts`
- Create: `extensions/continual-learning/config.ts`
- Test: `extensions/continual-learning/config.test.ts`

**Interfaces:**
- Consumes: `RunConfig` (Task 2), `readEnvValue` (Task 1).
- Produces:
  - `DEFAULT_RUN_CONFIG: RunConfig`
  - `readRunConfig(env: NodeJS.ProcessEnv): RunConfig`
  - `modelConfigPath(agentDir: string): string` → `<agentDir>/extensions/continual-learning/config.json`
  - `readModelConfig(agentDir: string): { ok: true; model: string | null } | { ok: false; detail: string }`
  - `parseModelSpec(spec: string): { provider: string; id: string } | null`

- [ ] **Step 1: Write the failing tests**

Cases: empty env yields the documented defaults; each env var overrides; legacy `CONTINUOUS_LEARNING_*` names work; invalid values (`"0"`, `"-1"`, `"abc"`) fall back; trial booleans accept `1/true/yes/on`; `modelConfigPath` ends with `extensions/continual-learning/config.json`; missing file → `{ ok: true, model: null }`; `{"model":"anthropic/claude-haiku-4-5","other":1}` → that string; `{"model":""}` and `{"model":null}` → `null`; malformed JSON → `ok: false`; `{"model":42}`, `{"model":{}}`, `{"model":[]}` → `ok: false`; `parseModelSpec("a/b/c")` → `{ provider: "a", id: "b/c" }`; `"noslash"`, `"/x"`, `"x/"` → `null`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test extensions/continual-learning/config.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement config**

Use `readEnvValue(primary, legacy)` from `state.ts`. Add to `constants.ts` the default values and `MODEL_CONFIG_DIR_PARTS = ["extensions", "continual-learning"]`, `MODEL_CONFIG_FILE = "config.json"`. `readModelConfig` returns `ok: false` with the JSON error or the type error text; it never throws.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test extensions/continual-learning/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
git add extensions/continual-learning/config.ts extensions/continual-learning/config.test.ts extensions/continual-learning/constants.ts
git commit -m "feat: add run config and model config file"
```

---

### Task 4: Session discovery and condensation

**Files:**
- Create: `extensions/continual-learning/extract.ts`
- Test: `extensions/continual-learning/extract.test.ts`

**Interfaces:**
- Consumes: `SessionFile`, `SessionIndex`.
- Produces:
  - `readSessionCwd(filePath: string): string | null`
  - `condenseSession(jsonl: string): string`
  - `listCandidateSessions(input: { cwd: string; agentDir: string; currentSessionFile: string | undefined; index: SessionIndex; maxSessions: number }): SessionFile[]`
  - `buildPayload(files: SessionFile[], maxChars: number): { text: string; included: SessionFile[]; deferred: string[] }`

- [ ] **Step 1: Write the failing tests**

Fixtures are inline JSONL strings and temp directories.

- `readSessionCwd returns the header cwd and null for a malformed header`
- `condenseSession keeps user and assistant text and drops tool calls, tool results, thinking, and images`
- `condenseSession truncates a user message to 2048 chars and an assistant message to 1024`
- `condenseSession keeps only the last 40 messages`
- `condenseSession returns an empty string for empty or truncated JSONL`
- `listCandidateSessions skips unchanged files, the current session, and other projects' user-level sessions`
- `listCandidateSessions sorts oldest first and caps at maxSessions`
- `buildPayload includes whole files only and defers the overflow`

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test extensions/continual-learning/extract.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement extraction**

Walk `<cwd>/.pi/sessions` and `<agentDir>/sessions` for `*.jsonl`. Filter user-level files by `readSessionCwd(file) === cwd`. Exclude `currentSessionFile`. Compare `statSync(file).mtimeMs` against `index.files[file].mtimeMs`. Condense per the spec's limits; per-file header `### session <basename> (<ISO mtime>)`. `buildPayload` appends whole files in order until the next file would exceed `maxChars`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test extensions/continual-learning/extract.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
git add extensions/continual-learning/extract.ts extensions/continual-learning/extract.test.ts
git commit -m "feat: add session discovery and condensation"
```

---

### Task 5: Prompt building and proposal validation

**Files:**
- Create: `extensions/continual-learning/prompt.ts`
- Test: `extensions/continual-learning/prompt.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks except `RunConfig` where needed.
- Produces:
  - `buildPrompt(input: { rules: string; agentsMd: string | null; sessions: string }): string`
  - `type ParsedResponse = { kind: "no-change" } | { kind: "proposal"; content: string } | { kind: "invalid"; detail: string }`
  - `parseProposalResponse(text: string): ParsedResponse`
  - `validateProposal(proposed: string, current: string | null): { ok: true } | { ok: false; detail: string }`
  - `countChanges(current: string | null, proposed: string): { added: number; updated: number; removed: number }`

- [ ] **Step 1: Write the failing tests**

- `buildPrompt includes the rules, the current AGENTS.md, the sessions, and the output contract`
- `buildPrompt notes a missing AGENTS.md`
- `parseProposalResponse accepts the exact no-change line`
- `parseProposalResponse takes the first markdown fence and ignores surrounding prose`
- `parseProposalResponse rejects a response with no fence`
- `validateProposal accepts a file with both learned sections`
- `validateProposal rejects a missing section, 13 bullets in one section, and a changed hand-written section`
- `validateProposal accepts other sections only when they are byte-identical to the current file`
- `countChanges reports added and removed bullets and position-wise updates`

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test extensions/continual-learning/prompt.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement prompt and validation**

Output contract text (exact): respond with `No high-signal memory updates.` alone, or one summary line followed by exactly one ` ```markdown ` fence holding the complete proposed `AGENTS.md`. Validation: non-empty, ≤20 KiB, both headings present, ≤12 top-level bullets per section, and the text outside the two learned sections identical to the current file (empty when the file is absent). `countChanges` compares bullet lines inside the learned sections; when a section has the same bullet count in both, changed positions count as `updated`, otherwise set differences count as `added`/`removed`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test extensions/continual-learning/prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
git add extensions/continual-learning/prompt.ts extensions/continual-learning/prompt.test.ts
git commit -m "feat: add prompt building and proposal validation"
```

---

### Task 6: Proposal file handling

**Files:**
- Create: `extensions/continual-learning/proposals.ts`
- Test: `extensions/continual-learning/proposals.test.ts`

**Interfaces:**
- Produces:
  - `proposalPath(cwd: string): string` → `<cwd>/AGENTS.proposal.md`
  - `writeProposal(cwd: string, content: string): string`
  - `readProposal(cwd: string): string | null`
  - `deleteProposal(cwd: string): void`
  - `hashContent(content: string): string`
  - `buildDiff(cwd: string, exec: (cmd: string, args: string[]) => Promise<{ stdout: string }>): Promise<string>`

- [ ] **Step 1: Write the failing tests**

- `proposalPath points at the project root`
- `writeProposal then readProposal returns the content`
- `deleteProposal removes the file and does not throw when missing`
- `hashContent is stable and differs for different content`
- `buildDiff passes AGENTS.md and AGENTS.proposal.md to git diff --no-index`
- `buildDiff returns a manual-comparison message when the command throws`

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test extensions/continual-learning/proposals.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement proposal handling**

`writeProposal` calls `mkdirSync` for the parent and writes UTF-8. `buildDiff` invokes `exec("git", ["diff", "--no-index", "--unified=3", "--", "AGENTS.md", "AGENTS.proposal.md"])`, returns `stdout`, and catches a rejection into `"Diff unavailable. Compare AGENTS.md with AGENTS.proposal.md manually."`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test extensions/continual-learning/proposals.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
git add extensions/continual-learning/proposals.ts extensions/continual-learning/proposals.test.ts
git commit -m "feat: add proposal file handling"
```

---

### Task 7: Run log

**Files:**
- Create: `extensions/continual-learning/log.ts`
- Test: `extensions/continual-learning/log.test.ts`

**Interfaces:**
- Consumes: `SessionFile`.
- Produces:
  - `type LogRecord = RunRecord | DeclinedRecord | AbortedRecord | AppliedRecord` in `types.ts`, with:
    - `RunRecord { type: "run"; at: string; trigger: Trigger; model: string; startedAt: string; finishedAt: string; durationMs: number; sessions: SessionFile[]; deferred: string[]; outcome: "proposal" | "no-change" | "failed"; proposalPath?: string; proposalSha256?: string; baseAgentsSha256?: string; changes?: { added: number; updated: number; removed: number }; usage?: { input: number; output: number; cost: number }; reason?: string; error?: string }`
    - `DeclinedRecord { type: "declined"; at: string; sessionsSincePrompt: number }`
    - `AbortedRecord { type: "aborted"; at: string; startedAt: string }`
    - `AppliedRecord { type: "applied"; at: string; proposalPath: string; proposalSha256: string }`
  - `getLogPath(cwd: string): string` → `<cwd>/.pi/state/continual-learning-runs.jsonl`
  - `appendLog(cwd: string, record: LogRecord): void`
  - `readLog(cwd: string, limit: number): LogRecord[]`
  - `formatLog(records: LogRecord[]): string`

- [ ] **Step 1: Write the failing tests**

- `appendLog then readLog returns records newest last`
- `appendLog keeps only the newest 200 records`
- `readLog skips malformed lines`
- `readLog returns an empty array when the file is missing`
- `formatLog renders a markdown line per record with date, trigger, and outcome`

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test extensions/continual-learning/log.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the log**

One JSON object per line. `appendLog` reads, appends, trims to the last 200 lines, writes once. `formatLog` returns `- YYYY-MM-DD HH:mm <trigger> <outcome>[ <detail>]` lines, newest first, and never throws on unknown record types.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test extensions/continual-learning/log.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
git add extensions/continual-learning/log.ts extensions/continual-learning/log.test.ts extensions/continual-learning/types.ts
git commit -m "feat: add local run log"
```

---

### Task 8: Model resolution and call

**Files:**
- Modify: `package.json` (add `@earendil-works/pi-ai` to `peerDependencies` and `devDependencies`)
- Create: `extensions/continual-learning/model.ts`
- Test: `extensions/continual-learning/model.test.ts`

**Interfaces:**
- Consumes: `readModelConfig`, `parseModelSpec` (Task 3).
- Produces:
  - `type CompleteFn = typeof complete`
  - `type ResolvedModel = { ok: true; model: Model<Api>; source: "config" | "session" } | { ok: false; reason: "bad-config" | "no-model"; detail: string }`
  - `resolveModel(input: { agentDir: string; sessionModel: Model<Api> | undefined; registry: { find(provider: string, id: string): Model<Api> | undefined } }): ResolvedModel`
  - `callModel(input: { model: Model<Api>; auth: { apiKey?: string; headers?: Record<string, string>; env?: Record<string, string> }; prompt: string; signal: AbortSignal; completeFn?: CompleteFn }): Promise<{ text: string; usage: { input: number; output: number; cost: number } }>`

- [ ] **Step 1: Write the failing tests**

Use fake `Model` objects cast through a helper.

- `resolveModel prefers a configured model found in the registry`
- `resolveModel falls back to the session model when the file or key is absent`
- `resolveModel returns bad-config for a malformed file`
- `resolveModel returns no-model when a configured model is unknown`
- `resolveModel returns no-model when neither source exists`
- `callModel concatenates text blocks and reports usage`
- `callModel returns empty text when the response has no text blocks`

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test extensions/continual-learning/model.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement model resolution and the call**

Add the dependency, then:

```bash
pnpm install
```

`resolveModel`: config file first (via `readModelConfig`/`parseModelSpec`/`registry.find`), else `sessionModel`. `callModel`: `complete(model, { messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }] }, { apiKey, headers, env, signal })`, then join `content` blocks where `type === "text"`; usage from `response.usage` with `0` fallbacks and `cost` defaulting to `0` when absent.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test extensions/continual-learning/model.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
git add package.json pnpm-lock.yaml extensions/continual-learning/model.ts extensions/continual-learning/model.test.ts
git commit -m "feat: add model resolution and call"
```

---

### Task 9: One-shot run orchestration

**Files:**
- Create: `extensions/continual-learning/run.ts`
- Test: `extensions/continual-learning/run.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces:
  - `type RunOutcome = { outcome: "proposal"; proposalPath: string } | { outcome: "no-change" } | { outcome: "failed"; reason: string; detail?: string }`
  - `runOnce(input: { cwd: string; agentDir: string; currentSessionFile: string | undefined; trigger: Trigger; config: RunConfig; sessionModel: Model<Api> | undefined; registry: { find(provider: string, id: string): Model<Api> | undefined; getApiKeyAndHeaders(model: Model<Api>): Promise<{ ok: boolean; apiKey?: string; headers?: Record<string, string>; env?: Record<string, string>; error?: string }> }; rulesPath: string; now: () => number; completeFn?: CompleteFn }): Promise<RunOutcome>`

  `runOnce` assumes the caller already holds the in-flight claim (Task 10) and always releases it in `finally`.

- [ ] **Step 1: Write the failing tests**

Each test builds a temp `cwd` with `.pi/sessions/*.jsonl`, a temp `agentDir`, a rules file, and a fake registry + `completeFn`.

- `runOnce writes a proposal and a run record on success`
- `runOnce updates the index only for sessions it processed`
- `runOnce returns no-change when the model answers with the sentinel and still refreshes the index`
- `runOnce returns failed and leaves the index untouched when the model cannot be resolved`
- `runOnce releases the in-flight claim when completeFn rejects`
- `runOnce returns failed and writes no proposal when validation rejects the output`
- `runOnce defers files beyond the payload cap and logs them`
- `runOnce writes the proposal at the project root and never touches AGENTS.md`

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test extensions/continual-learning/run.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `runOnce`**

Flow: read `AGENTS.md`; compute `baseAgentsSha256` from it (empty string when absent); read the rules file (unreadable → log `failed`/`no-rules`, return); resolve model (not ok → log `failed` with that reason, return); resolve auth (not `ok` → log `failed`/`no-model`, return); list candidates (empty → log `no-change`, return); build payload; `buildPrompt`; `callModel` with `AbortSignal.timeout(config.timeoutMs)` (throw or abort → log `failed`/`call-failed`, return); parse (invalid → rejected dump + log `failed`/`invalid-output`, return); validate (invalid → rejected dump + log `failed`/`invalid-output`, return); on a proposal, write the file and compute `proposalSha256` plus `countChanges(current, proposed)`; in both success paths, `mergeIndex(index, included, now)` then `pruneIndex` then `saveIndex`, append the run record with base hash, proposal hash, change counts, and usage; release in `finally`.

Rejected dumps go to `.pi/state/proposals/rejected-<ISO stamp>.txt`, newest 5 kept.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test extensions/continual-learning/run.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
git add extensions/continual-learning/run.ts extensions/continual-learning/run.test.ts
git commit -m "feat: add one-shot run orchestration"
```

---

### Task 10: Wire `session_start` and commands

**Files:**
- Modify: `extensions/continual-learning/index.ts`
- Modify: `extensions/continual-learning/constants.ts` (remove dead turn/minute constants)

**Interfaces:**
- Consumes: `decideCadence`, `readRunConfig`, `readModelConfig`, `resolveModel`, `runOnce`, `reapStaleRun`, `updateState`, `loadState`, `claimRun`, `releaseRun`, `readLog`, `formatLog`, `buildDiff`, `readProposal`, `writeProposal`, `deleteProposal`, `hashContent`, `getAgentDir`, `withFileMutationQueue`, `pi.exec`, `pi.sendMessage`.
- Produces: registered command `continual-learning` with subcommands `apply` and `log`.

- [ ] **Step 1: Implement the `session_start` handler**

```ts
pi.on("session_start", async (event, ctx) => { ... })
```

- `reapStaleRun(cwd, config.timeoutMs, Date.now())`; if it returns a claim, append an `aborted` record.
- `alreadyRunning` is `loadState(cwd).inFlight !== null`.
- `decideCadence(...)` with `alreadyRunning`, `sessionFile: ctx.sessionManager.getSessionFile()`.
- `ignore` → return; `count` → `await updateState`; `ask` → persist the reset state, then `claimRun(cwd, "startup", Date.now())`; if it returns false, return without prompting; otherwise show the dialog (`"Run a memory proposal from the last N sessions in the background?"`). On no or on a thrown dialog, call `releaseRun` and append `declined` only when the user said no. On yes, start `runOnce(...)` with `void runOnce(...).catch(...)`; `runOnce` releases the claim itself.

`claimRun` sets only `inFlight`; it never changes the counter.

Compute `agentDir` with `getAgentDir()` and `rulesPath` with `resolve(dirname(fileURLToPath(import.meta.url)), "../../skills/continual-learning/rules.md")`.

Never `await runOnce` inside the handler.

- [ ] **Step 2: Implement the commands**

- `/continual-learning` (no args): `claimRun(cwd, "manual", Date.now())`; if false, notify and return; otherwise start `runOnce` with `trigger: "manual"` and notify when it settles.
- `/continual-learning apply`: `readProposal`; missing → notify; read the newest `run` record from `readLog` to get `baseAgentsSha256`; build the diff via `pi.exec` through `buildDiff`; if the current `AGENTS.md` hash differs, prefix the confirmation with the staleness warning; `ctx.ui.confirm("Apply proposal?", diff)`; on yes write `AGENTS.md` through `withFileMutationQueue`, append `applied`, delete the proposal, notify; on no change nothing.
- `/continual-learning log`: `formatLog(readLog(cwd, 10))` through `pi.sendMessage({ customType: "continual-learning-log", content, display: true }, { triggerTurn: false })`, with `ctx.ui.notify` fallback when `!ctx.hasUI`.

- [ ] **Step 3: Move the proposal path into a single accessor**

Use `proposalPath(cwd)` in every handler; do not build the filename inline anywhere.

- [ ] **Step 4: Typecheck, lint, test**

Run: `pnpm typecheck && pnpm biome:fix && pnpm test`
Expected: clean, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add extensions/continual-learning/index.ts extensions/continual-learning/constants.ts
git commit -m "feat: wire session-start trigger and commands"
```

---

### Task 11: Rules, skill, README, version

**Files:**
- Create: `skills/continual-learning/rules.md`
- Modify: `skills/continual-learning/SKILL.md`
- Modify: `README.md`
- Modify: `package.json` (version `2.0.0`)

**Interfaces:**
- Produces: `rules.md` is read at run time by Task 9 via `rulesPath`; the skill and README describe the new flow.

- [ ] **Step 1: Extract the rules**

Move the memory rules from the current `SKILL.md` into `rules.md`: what counts as durable, in-place updating, deduplication, the 12-bullet limit, the two allowed sections, the plain-bullet rule, and the exclusions (secrets, private data, one-offs, process instructions). No paths, no workflow.

- [ ] **Step 2: Rewrite the skill**

Keep the frontmatter (`name`, `description`, `disable-model-invocation: true`). Body: runs are produced by the extension; never write `AGENTS.md` directly; content rules are in `rules.md`; `/continual-learning`, `/continual-learning apply`, `/continual-learning log`.

- [ ] **Step 3: Rewrite the README**

Cover the trigger, consent, out-of-band call, proposal file, apply, log, config file, env table, and the removal of turn/minute cadence. Remove the old stash/commit instructions and the `CONTINUAL_LEARNING_MODEL` row.

- [ ] **Step 4: Bump the version and verify**

Set `"version": "2.0.0"` in `package.json`; run `pnpm typecheck && pnpm biome:fix && pnpm test`; grep the README for stale names: `grep -n "MIN_TURNS\|MIN_MINUTES\|TRIAL_MIN\|stash" README.md` must print nothing.

- [ ] **Step 5: Commit**

```bash
git add skills/continual-learning/rules.md skills/continual-learning/SKILL.md README.md package.json
git commit -m "docs: document out-of-band continual learning"
```

---

### Task 12: End-to-end verification

**Files:** none; verification only.

- [ ] **Step 1: Run the full suite**

Run: `pnpm typecheck && pnpm biome:fix && pnpm test`
Expected: all pass, no diff after `biome:fix` beyond formatting.

- [ ] **Step 2: Smoke the trigger**

In a scratch git repo with one prior session file, run `pi -e .` from the repo root with `CONTINUAL_LEARNING_SESSION_INTERVAL=1` and a config naming a real model. Expect one startup dialog, then a proposal at `AGENTS.proposal.md`, a `run` record, an updated index, `AGENTS.md` untouched, and no new entry in the current session transcript.

- [ ] **Step 3: Smoke the decline and the snooze**

Decline the dialog: expect a `declined` record, no proposal, and no dialog on the next session until X more sessions.

- [ ] **Step 4: Smoke apply**

Run `/continual-learning apply`: expect a diff, cancel leaves both files unchanged, confirm writes `AGENTS.md`, deletes `AGENTS.proposal.md`, appends `applied`, and creates no commit.

- [ ] **Step 5: Smoke failures**

Point the config at an unknown model → `failed`/`no-model`, index untouched. Corrupt the config JSON → `failed`/`bad-config`. Kill pi mid-run → `aborted` on the next start.

- [ ] **Step 6: Report**

Report the outcomes and `git status`; do not commit anything produced by the smoke tests.
