# 26b candidate evidence

The candidate implements saved, app-owned current chat preparation and question continuations. It is not a claim that the full agent blueprint or device-control roadmap is complete.

## Final pre-acceptance Stop correction

Source browser acceptance reproduced another blocker against source `81719d32f482e66d0bf682a7d3fb527b4696119b`: Stop sent while the acceptance POST was held before transport received 404, then the released request launched preparation. The source acceptance README/protocol evidence is in the parent's smoke worktree at `docs/screenshots/agent-experience/26b-source-acceptance/`; those files were read, not changed.

The correction persists explicit cancellation intent by opaque request identity. A dedicated request-cancellation route returns a versioned `pending_acceptance` result without pretending a run exists. Acceptance consumes that intent transactionally and records a cancelled run before any model ownership/tool invocation. Existing accepted-run cancellation and the legacy event union remain compatible. Only explicit Stop writes intent; subscriber disposal still does not cancel. CLI adds `agent cancel <request-id> --request`.

Current base remains `e2e2eab5be53542727f342d33193e3bbd65a7e8d`; source tree is `19c6ce5232673a0a6b2b74ffbf4c489437854758`, source/test snapshot `addae420e38bd2f2464a609a3dd3f4288282c5d0`. Parent-owned dirty edits in blueprint chapters 13/14/29 were discovered during this correction, preserved untouched, and excluded from the worker-owned snapshot.

Verification, run serially before direct typecheck:

- **516 pass, 0 fail, 3,714 assertions**, across 75 scoped files, 15.61s. This includes all web tests and the existing durable/Codex/presentation/CLI regressions. The sync-frame error log remains an intentional negative test.
- New transport regression holds the unchanged initial POST before the real route, records Stop, releases acceptance, deliberately loses its acknowledgement, then recovers by GET. Observed: one acceptance POST, cancelled run, zero model calls, zero preparations, unchanged config count. Unknown run cancellation still returns 404.
- New app regression issues Stop through a separate SQLite handle while `startAgentRun` is suspended at its `await messageModel`; acceptance consumes intent, launches nothing, returns the original cancelled run on repeat, and rejects changed payload.
- Bounded-storage regression fills 1024 intents, verifies an explicit not-recorded error at capacity, rejects new non-matching acceptance, then consumes a matching cancelled identity without model execution. Intents are not expired or evicted.
- CLI regression verifies the pending request result contains no invented run ID.
- Direct typecheck, dependency rules (641 modules, 2664 dependencies) and whitespace passed. Existing dependency-cruiser TypeScript-7 warning remains. Inline TS/simplifier found no new unsafe assertions or event-union changes. Changed-line anti-slop reports **26 retained findings**: the prior 25 convention/boundary findings plus the same intentional unknown-error callback pattern for pending Stop.

No heavy suite/build was queued, no live provider or device used, and no real app/server/install touched. Parent owns actual-browser rerun and final whole-suite/compile/release gates. A failed Stop request is an explicit unavailable/error state, never a guarantee of cancellation; pending storage capacity is a documented fail-closed limit. No new server/browser process or scratch resource was created for this correction beyond normal test fixtures.

## Earlier corrected candidate (before the Stop blocker)

The parent rejected the initial candidate with two reproduced journey failures: committed receipts were missing from rendered chat in the commit/observation crash gap, and consecutive Codex execs reused `item_0`, making a new question inherit the old answer.

Both invariants are corrected:

- Chat retains receipt facts separately from observer operations and renders allowlisted references through the existing rows. History carries those facts by original user-message owner, including after a later turn. Unknown operations remain unknown. Invalid/no-reference validation receipts are not green. The normal completed view is unchanged.
- New Codex exec call/result/pending IDs share a fresh execution namespace. Old canonical history and inner MCP protocol IDs are not rewritten. The earlier deferred malformed-question completion predicate remains unchanged.

Corrected source is based on `e2e2eab5be53542727f342d33193e3bbd65a7e8d`, including focus commit `b5b90c4ca6b600d51b604e40667b6b72ac279ada` unchanged and the subsequent 0.42.1 release metadata. Source subtree: `81719d32f482e66d0bf682a7d3fb527b4696119b`; source/test snapshot: `4f68ef165da097b30e8b7d302eb47fe20c57c8ba`.

### Corrected checks

- All web tests plus durable app/CLI, presentation ownership and Codex adapter/pause/identity regressions: **512 pass, 0 fail, 3,694 assertions**, 15.62s across 73 files. The sync-frame error log is an intentional negative test.
- Direct typecheck, dependency rules (640 modules, 2663 dependencies) and whitespace checks passed. The existing dependency-cruiser TypeScript-7 warning remains.
- Changed-file React Doctor: no issues reported, 84/100. Inline TS/simplifier review retained no new correction-specific findings; the original 25 changed-line anti-slop convention/boundary findings remain reported, not suppressed.
- The new rendered crash-gap test uses a preceding read so observer `op_2` is deliberately not receipt `effect_1`. A real child exits after synchronous receipt commit but before the awaited tool observation. Rendered chat and read-only CLI show the same original config reference; the operation remains unknown. No-reference validation receipts remain unconfirmed. Later history retains the old receipt.
- The new real Codex/MCP regression asks two questions in separate executions, accepts different answers, repeats both accepted answer identities without execution, reloads answered history, and verifies legacy `item_0` rows remain byte-for-byte unchanged.

Parent crash-gap command now exits 0 and prints `status: interrupted`, `committedPreparations: 1`, `runHasConfigReference: true`, `visibleInProjection: true`, `operationStatuses: [unknown]`.

Parent question-ID command prints distinct `codex_<execution>_item_0` IDs, first answer `Left` and second answer `null`, so its original assertion passes. The unchanged scratch probe then starts a third run and closes SQLite without waiting/draining, producing `Cannot use a closed database` and exit 1. Its parent-owned file was not edited. A retained owned copy, `keyloom26b-question-ids-drained.ts`, adds the required wait/drain and exits 0 with answers `Left`, `Right`, then a third unanswered question. The repository regression uses proper lifetime management as well.

The old candidate's queued full-suite task 9215 and compile task 9216 were explicitly cancelled by the parent. Both follow commands exited 143 with `The task to be followed doesn't exist`; neither produced a test or compile result. Those are incomplete old-candidate gates, not corrected-source evidence. No replacement full suite or compile was queued: parent selects those gates after review.

## Initial candidate provenance (rejected; not final-source verification)

- Assigned branch/worktree: `feat/agent-durable-runs`, `keyloom-agent-closeout`.
- HEAD/base: `7735586ed08335f8038f404974084000e5e6463e`.
- Frozen source subtree: `3e2bcca76b3f49d91a2509634a42d98bd7bb6cab`.
- Frozen source/test snapshot tree: `d70c6fc984ee324c1edc2df4bc9dd824fc16f32c` (documentation added afterward).
- Dependencies installed with `bun install --frozen-lockfile`; lockfile unchanged.
- No commit, push, merge, release, global installation, real-data server, paid model or device operation was performed.

## Observed checks

- Targeted combined app/CLI/browser-transport/presentation/legacy/Codex-pause checks: **37 pass, 0 fail, 216 assertions**, 3.97s.
- Typecheck passed. Dependency rules passed: 640 modules, 2662 dependencies. The existing TypeScript-7 compatibility warning from dependency-cruiser remains; its configured SWC parser was not changed.
- React Doctor changed-file scan: no reported issues, score 84/100. No dependency/configuration was installed in the project.
- Whitespace check passed.
- Full suite and arm64 compilation were initially queued against this source, then cancelled by the parent before execution; see the corrected-gate record above.

### Commit-gap fault evidence

The tests inject an aborting SQLite trigger before receipt insertion, after actual synchronous domain code has run. Temporarily removing the outer receipt transaction produced **0 pass, 2 fail**:

- `Must roll back` config survived when the test required no config.
- Proposal count increased from 1 to 3 when the test required the original 1.

Restoring the transaction made the tests green. The expanded test exercises the entire proposal array, cross-board `put_config`, priority insertion and decision-outcome update; every receipt-insert failure preserves the pre-call domain state. Invalid validation outcomes also return the original retained result without validating again.

### Lifetime and identity evidence

`test/app/agent-runs.test.ts` exercises simultaneous first acceptance, a vanished acknowledgement, subscriber cancellation after a committed copy, same-ID/different-input refusal, busy input without another user message, original result retention, exact duplicate answer acceptance, answered history, live foreign-process inspection/cancellation, and abrupt child-process death after preparation. The restart case reads `interrupted` plus one committed preparation and refuses to rerun the model on repeated acceptance.

`test/web/chat-run-transport.test.ts` routes the browser transport through the real backend. Its accepted POST response is deliberately lost after server acceptance. GET by request identity reaches the original completed work, with one POST and one model call. A 404 allows legacy fallback; invalid-version/ambiguous failures do not.

`test/web/chat-saved-runs.test.ts` rejects duplicate/older sequences after terminal state, retains the uncapped canonical answer, and routes a completed snapshot to its original user-message owner rather than a newer turn.

`test/cli/agent-runs.test.ts` drives `runCli` with a synthetic provider and scratch data through start/show/answer/repeated-answer/cancel. The continuation runs once and completed cancellation remains completed. This is source CLI parity, not installed-release proof.

An additional retained scratch harness, `keyloom26b-concurrency.ts`, exercised two separate Bun processes answering the same question/answer identity at the same barrier. Both returned the same continuation ID; the shared model-call marker contained exactly one call. It also changed the target revision before answering and observed refusal with no additional message, then explicitly stopped a run after `create_config` committed and observed `cancelled`, one receipt and the original config reference. The initial harness attempt used the wrong synthetic blank-layer ID and failed validation; reading the actual layer ID corrected the harness only, with no production change.

The source command `bun src/cli/main.ts --data-dir <scratch> --format json agent show explicit-stop` then returned `status: cancelled`, `cancelRequested: true`, `committedPreparations: 1`, the original generated config reference, a succeeded Create config operation, and the existing Stop-is-not-rollback warning.

## Inline review

- TypeScript review: API/persistence JSON boundaries use zod; module-table checks pass. The generic private receipt replay uses one explicitly justified `as T`: only the matching typed callback writes the immutable result, bound to exact operation/input. No broad assertion or compiler relaxation was introduced.
- Simplifier: removed an unnecessary input-storage IIFE and duplicate ownership assignment; reused one latest-run lookup in history projection. Existing app/server/client seams remain in their established layers.
- Changed-line anti-slop: **25 findings retained**, all reported rather than suppressed. They are the repository's conditional optional-property spreads; deliberately unknown JSON/error/receipt boundaries; and canonical JSON's runtime object test. Generic receipt input is parsed by existing tool schemas before the port, while server JSON is immediately parsed by the route schema. Existing hidden findings remain out of scope.

## Not observed / later gates

- No live paid provider, hardware, unsafe device-job cancellation, actual browser screenshot matrix, installed/released-binary journey or new device capability.
- No workspace conversation migration, physical keyboard identity, plan/approval system or new question/artifact kind.
- Parent owns final integration/release/status updates. The corrected candidate includes the committed Cmd+K focus delta and release metadata without changing its behavior.
- A live foreign PID is conservatively retained as potentially running; PID reuse cannot establish exact foreign process ownership. Cancellation is an honest request, not a guessed cancelled flag.

Resource cleanup is not authorized. Preserve the isolated worktree, ignored dependencies/build output, temporary alternate index and synthetic test data. Under the approved OpenCode temporary folder, this run created `keyloom26b-concurrency.ts`, `keyloom26b-question-ids-drained.ts`, `keyloom26b-index-s66dihjk`, and synthetic directories `keyloom26b-evidence-s4j7YR` (initial harness validation failure) and `keyloom26b-evidence-cYRhzw` (passing checks). Parent-probe reruns also created their normal synthetic fixture/Codex directories there. There is no owned dev server, browser session or desktop process, and no active queued gate from this worker. React Doctor retained its normal diagnostic directories under the OS temporary folder.
