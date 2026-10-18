# 26a backend/CLI candidate

Status: backend implementation and targeted verification complete; queued whole-suite/typecheck and compiled-candidate checks pending. Product/UI approval, integration and deployment remain open. No production web UI, styles or transcript reducer changed. No reviewer agent, paid model, hardware operation or real data directory was used.

## Provenance

- Fresh fetch at implementation start: `origin/main` unchanged at `c5efcb583c69df8841d154990fd3e63e92f9207b`.
- Base = HEAD: `c5efcb583c69df8841d154990fd3e63e92f9207b`.
- HEAD tree: `ff249fe5e51dce5887621267e36ead15bcb56f7a`.
- Final implementation tree, HEAD plus all changed/new `src/` and `test/` files: `f6751391fb08a9c1507adb960cf4e25c53dd3edb`. Created with a temporary alternate index; no commit or real-index staging. Documentation is excluded to avoid a self-referential report hash.
- Branch/worktree: `spike/agent-lifecycle`, `/Users/bhekanik/code/planetaryescape/.worktrees/keyloom-agent-s54`.
- Original S54 experiment tree remains `b88e3b80a30812a623750b36529f7c5c59538c20`; its archived harness has unchanged SHA-256 `4ae6da11eba6562a45d489a913f937bf2cd169d0dc844cff6134d9f76afafdbe` at `S54-characterization.test.txt`. Copy it to `test/spikes/S54.test.ts` only in a separate ORIGINAL-base checkout to reproduce that historical evidence. It is not in the ordinary test suite now.

## Implemented paths

| Path | Responsibility |
|---|---|
| `src/agent/observation.ts` | `AgentObservation`, `toolObserver`: local invocation IDs, start/finish facts, per-invocation validation/results via existing ports, AsyncLocalStorage isolation for parallel calls, 64-execution cap, abort preflight |
| `src/agent/model.ts`, `run-turn.ts` | Optional neutral `ModelRequest.onPublicMessage` and `AgentCallbacks.onObservation`; existing tools/recorder/providers retained |
| `src/agent/anthropic-model.ts` | Completed public-message boundaries for both Anthropic and OpenRouter; only valid pausing input becomes a pending question |
| `src/agent/codex-model.ts` | Whole-public-message fallback, status-only failed replay normalization, no post-question public messages/tool continuation, malformed question repair, checked pending-call narrowing |
| `src/app/chat-presentation.ts` | Server-owned labels, safe code/reference allowlists, bounded text, snapshots, partial-effect warnings, question-resolution projection |
| `src/app/conversations.ts` | Original user-message ownership; snapshot persistence on observations and terminal errors/cancellation; canonical message links; answer and old waiting-snapshot resolution in one transaction; unattached reads are unobserved |
| `src/persistence/chat-presentations.ts` | Storage schema, 64 KiB byte enforcement, upsert/list |
| `src/persistence/migrations/0012_chat_presentations.sql`, `migrations.ts` | Additive table/index; presentation rows cascade with messages/conversations; canonical provider replay untouched |
| `src/api/http.ts` | Opt-in version field, `ChatPresentationSchema`, `ObservedChatEventSchema`, inferred `ChatPresentation`/`ObservedChatEvent`, additive optional conversation detail |
| `src/server/chat-backend.ts`, `chat-routes.ts`, `src/cli/chat-backend.ts` | Negotiated transport, legacy-event filtering, additive read projection; existing Host/token checks and routes retained |
| `src/cli/commands/chat.ts` | `conversations show <id>` in table/JSON/ids formats, without executing a model |

Semantic results come from typed `check`/`propose` port returns, not tool-result prose. A normal JavaScript return can be `declined` or `partial`; failed parsing/throws become `failed`. Unknown operations cannot become successful just because a handler returned. References are observed saved IDs, not atomic effect/idempotency receipts. The existing recorder's `ok` retains its historical transport meaning; new presentation status is the domain-aware source.

The bounds are 64 actual executions and at most 64 operations/messages per turn, 64 KiB serialized presentation, an 8 KiB JSON-encoded public-text budget, four allowlisted validation codes and two generated-ID references per operation. Extra detail is visibly truncated; canonical messages/proposals remain available. No raw inputs/results/exceptions, config names, macro text, priority statements or opaque provider thinking enter operation metadata. Public assistant text is intentionally public conversation content, not a sanitizer guarantee about arbitrary model prose.

## Downstream UI packet

The full contract and sample terminal frame are in [26a-contract.md](26a-contract.md). Request the existing chat route with:

```json
{"message":"Inspect my layout","presentationVersion":1}
```

Parse `ObservedChatEventSchema`, not a modified legacy `ChatEventSchema`. A new frame is a replacement snapshot:

```text
event: presentation
data: {"type":"presentation","presentation":{"version":1,"userMessageId":"msg_example","status":"running","operations":[{"id":"op_1","tool":"get_layout","label":"Read layout","status":"running","durationMs":0,"validationCodes":[],"references":[],"accepted":0,"declined":0}],"messages":[],"effectsMayHaveOccurred":false,"warning":null,"detailsTruncated":false}}
```

- Key the whole snapshot by `userMessageId`; operation/public IDs are local to that turn. An answer can emit an updated **older** waiting snapshot before the new turn's snapshot. Do not route every frame to the newest assistant turn.
- Turn states: `running`, `waiting_user`, `completed`, `incomplete`, `failed`, `cancelled`, `unobserved`. Operation states: `running`, `succeeded`, `failed`, `declined`, `partial`, `unknown`.
- `messages` contains `{id, kind: working_note|answer, text, messageId?}`. Use these groups once a presentation frame appears; do not concatenate the legacy `text` stream into a second answer. Whole-message observation is intentional. Canonical message IDs appear at completion.
- `questionToolUseId?` links the exact waiting card. Existing question/proposal APIs still own answering and Apply. A valid answer completes the previous waiting presentation; a stale/duplicate answer is rejected before a new message is written.
- `completed` describes model completion, not all operations succeeding, no pending Apply, or device verification. Failed/declined/partial/unknown operations must remain inspectable. Existing unanswered question/unapplied proposal state must not be hidden.
- `warning`, `effectsMayHaveOccurred`, and `detailsTruncated` are explicit presentation flags. On local Stop, the socket can close before its terminal snapshot is delivered: read the existing conversation or use a conservative partial-preparation warning. Never say "Nothing was changed" from absence of a received effect.
- `unobserved` means this process has no live owner for a stored running snapshot. Another server process may still be working. Show the supplied warning and unknown operation states; do not label it successful, conclusively stopped or automatically resume it.
- Missing/empty `ConversationDetail.presentations` means legacy fallback. Old servers can ignore `presentationVersion: 1` and return only readable legacy events. This server rejects unsupported versions with HTTP 400 `usage` before execution and an upgrade/omit-version instruction.
- No automatic resend, reconnect execution or `/api/agent/runs` routes exist. New UI code, Q30 approval, screenshots and pure-reducer integration belong to the parent/UI owner.

CLI parity:

```sh
keyloom conversations show <conversation-id> --format json --data-dir <scratch-dir>
keyloom conversations show <conversation-id> --format table --data-dir <scratch-dir>
```

JSON uses the existing output envelope and contains `presentations`. Table output includes safe operation status/duration/codes and warnings. IDs format prints the conversation ID. It does not replay provider history or run tools.

## Verification and failed attempts

Observed passing checks:

- Initial existing provider/route regression run: `bun test test/agent/turns.test.ts test/agent/ask-user.test.ts test/agent/codex.test.ts test/agent/providers.test.ts test/server/chat-routes.test.ts`: **77 pass**, 309 assertions, 18.83 s.
- Final broad targeted run: `bun test test/agent/activity.test.ts test/app/chat-presentation.test.ts test/server/chat-presentation.test.ts test/cli/chat.test.ts test/agent/ask-user.test.ts test/agent/codex.test.ts test/agent/turns.test.ts test/agent/providers.test.ts test/server/chat-routes.test.ts`: **113 pass**, 507 assertions, 21.82 s.
- After replacing the pending-call cast with checked narrowing: `bun test test/agent/codex.test.ts test/agent/activity.test.ts test/app/chat-presentation.test.ts test/server/chat-presentation.test.ts test/cli/chat.test.ts`: **59 pass**, 310 assertions, 15.05 s.
- `bun run typecheck`: final direct run **passed**. It also passed repeatedly during implementation; earlier test-only undefined-value expectations were corrected without assertions/casts.
- `bun run depcruise`: **passed**, 630 modules and 2,616 dependencies. It prints the existing TypeScript 7 compiler-API warning; the repository already configures SWC parsing. No module-table changes.
- Alternate-index `git diff --cached --check` over all source/test changes: **passed**. The real index was not changed.
- Archive SHA-256: **matches exactly**.

New desired-behavior tests cover all three deterministic providers, real wrapped starts/results, malformed input, normal-return validation refusal, mixed alternatives, valid macro/priority canaries, prototype-named extra input keys, status-only Codex error flags, parallel same-named completion ordering, 64-call cap, abort preflight, cancelled/failed turns after committed preparation, safe references, immutable frames, bounded UTF-8/JSON text, opaque-thinking exclusion, missing-terminal unknowns, busy/stale/retry ownership, negotiated/legacy schemas/routes, unsupported major versions refusing writes, and CLI inspection/fallback.

Failures corrected while iterating:

- A new deletion test initially deleted a conversation before its legacy messages; the existing schema correctly refused that FK order. The test now follows the existing deletion path; presentation rows cascade when the message is deleted.
- A compatibility fixture used Zod `.omit()` on a refined schema, which Zod rejects. The old-server simulation now uses its original object shape without the new optional property.
- Malformed `ask_user` revealed real provider defects: Anthropic/OpenRouter intercepted before schema validation; Codex later selected the first failed question instead of the valid repaired one. Both paths now validate/select the actual pending question, and the provider regression passes.
- Answered waiting snapshots initially stayed waiting. Resolution is now committed with the answer and emitted to opted-in clients.
- An unattached running snapshot initially inferred "interrupted" from a process-local set. It now honestly says `unobserved`, including separate-process CLI inspection.

### External queue checks

The first `agent-work run -- bun test` / `agent-work run -- bun run typecheck` jobs (9174/9175) waited over two minutes without starting, then the shell timeout removed them. No full-suite success is inferred from those attempts. A single `pueue wait` confirmed those IDs no longer existed; no manual polling loop was used.

Replacement background jobs have no shell timeout: **9179** runs `agent-work run -- bun test`; **9180** runs `agent-work run -- bun run typecheck`. The full-suite log shows actual test start after roughly two minutes of resource waiting. These jobs were queued before the final question/unobserved fixes, so their result cannot by itself certify the final implementation tree if they had already loaded those modules. A compiled CLI candidate build was also queued with `agent-work run -- bun build src/cli/main.ts --compile --outfile node_modules/keyloom-26a`; no real installed binary is overwritten. Final results/smoke evidence will be appended on completion. Do not treat pending checks as passed.

## Inline TypeScript and simplifier review

No extra agents or second-opinion reviewers were started. The inherited model performed both requested skills inline over the owned diff.

- Type review: external negotiation uses zod; exported API types derive from schemas; no agent-to-app/persistence/API dependency was added. Persistence/wire schemas are intentionally structural counterparts because of the existing module table, with contract tests and adapter assignability checking them. Removed the touched Codex pending-step cast in favor of checked narrowing. No new `any`, double casts or tsconfig relaxation.
- Simplifier reuse/altitude: retained existing tools, ports, validator, recorder, provider loops, SQLite migrations, output helper and routes. Per-invocation port observation owns semantic result classification; no duplicated tool-output parser or new capability registry.
- Simplifier efficiency/simplicity: snapshots overwrite one bounded row per turn, not per-token event rows; references replace raw result dumps. AsyncLocalStorage is used only to keep existing synchronous ports correctly associated with overlapping async tool calls.
- `anti-slop-check --base origin/main`: final run reports **five** conditional-empty-object-spread findings in `cli/chat-backend.ts`, `agent/run-turn.ts` (two), `app/conversations.ts`, and `agent/codex-model.ts`. They match the immediate established optional-property pattern and are deliberately retained under the skill's repository-convention rule. It is not a clean lint exit. A sixth finding on the touched pending-call cast was fixed. Untouched hidden findings remain out of scope.

## Dirty files and remaining gates

Source/test changes (19):

```text
src/agent/anthropic-model.ts
src/agent/codex-model.ts
src/agent/model.ts
src/agent/observation.ts
src/agent/run-turn.ts
src/api/http.ts
src/app/chat-presentation.ts
src/app/conversations.ts
src/cli/chat-backend.ts
src/cli/commands/chat.ts
src/persistence/chat-presentations.ts
src/persistence/migrations.ts
src/persistence/migrations/0012_chat_presentations.sql
src/server/chat-backend.ts
src/server/chat-routes.ts
test/agent/activity.test.ts
test/app/chat-presentation.test.ts
test/cli/chat.test.ts
test/server/chat-presentation.test.ts
```

Documentation/evidence (4): `docs/research/spikes/S54.md`, `S54-characterization.test.txt`, `26a-contract.md`, and this report. No shared ledger, parked checkout, production web files, dependency files or release files changed. No commit, push, PR, merge or release was performed.

This is **26a**, not durable execution. Socket loss may abort; Stop cannot undo committed preparation; effects and snapshots are not transactional receipts; there is no request deduplication or guaranteed continuation after process restart. Active progress observed from another process is explicitly unknown. Canonical public messages/provider replay remain available separately from capped presentation text. Live-provider format drift, full durable reconnect and UI comprehension are not verified here. Deployment is N/A for this worker, not complete.
