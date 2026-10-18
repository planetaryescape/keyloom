# 29: The agent operates the same app as the user

Status: 26a observation and 26b durable execution are released in v0.42.0 and v0.43.0. App-wide capabilities remain proposals. The [26b contract](../research/spikes/26b-contract.md) specifies the released versioned routes, CLI commands and receipt boundaries; [public-client evidence](../screenshots/agent-experience/26b-published-0.43.0/README.md) records their tested scope. Original source baseline: `71934e13f8c0c8b702b6dc1beb57ca25993f7cf3`. Product requirement: D-396 and D-400; execution/presentation direction: D-399, D-403 to D-406 and D-411.

Reconciled with origin/main at `72370d0494497ae4bdd6036106fcec9d3f6c1aab`: the coverage inventory includes the separate case/keycap controls (D-319), and renderers inherit the current no-stripe/no-sparkle rule.

Released 26a: `presentationVersion: 1` negotiates replacement snapshots on the existing chat stream; conversation detail and `conversations show` expose them. That legacy route retains socket-owned execution and its strict event union. Released 26b adds `app/agent-runs`, `/api/agent/v1/` routes and `keyloom agent start/show/answer/cancel` without changing that contract. Its browser reads sequenced snapshots rather than replaying an append-only event log. The broader route, capability and storage sketches below remain proposals where the 26b contract does not implement them.

The agent must be able to complete app workflows, not just explain how BK could complete them. It needs a current view of Keyloom, a bounded set of capabilities over existing use cases, and results the UI can render. It must not become a second implementation of the app.

## Reuse the current domain services and provider seam

[The baseline reading](../research/agent-native-baseline.md) records the code at the named SHA. The app already has a provider-neutral `AgentModel`, injectable `AgentPorts`, validated proposals, questions, config creation, cross-board mapping, a pure transcript reducer and real sync states. Extend these seams.

```text
Web / desktop agent UI            CLI chat and agent run commands
          |                                      |
          +---------- typed requests -------------+
                             |
                     app/agent-runs
          context snapshot / capability policy / effect receipts
                   |                         |
             agent/ tools                 app/ use cases
          provider-neutral loop      configs, changes, lab, sync,
                   |                history, settings, keyboard add
             AgentModel                       |
       Anthropic / OpenRouter / Codex   validator / firmware / SQLite
                   |
           correlated lifecycle
                   v
        stored sanitized events -> SSE -> pure UI projection
```

Keep `src/agent/` independent of `app/` and persistence. Add narrow port methods; compose them in `src/app/`. The capability registry describes allowed operations but is not a plugin framework or a generic remote execution endpoint. Pure layout and validation modules stay pure.

## The prompt knows the app, and tools know its current state

Assemble context from four layers:

1. Stable keyboard-specialist instructions: intent, domain language, firmware constraints, no silent loss, and the difference between a preview and a verified device outcome.
2. An app guide and capability descriptions generated from the registry: what can be done, how to discover an operation, what needs human approval, and where each structured result belongs.
3. A compact collection index and this request's focus: board/config/layer/selection, pending drafts, stored priorities, pending questions and plans. Details come from reads, not a giant prompt containing every keymap.
4. The conversation's public messages, typed answers and effect receipts. Provider replay stays provider-specific behind `AgentModel`; it is not the presentation model.

Refresh collection facts and revision heads when a tool runs. Include a read timestamp with connection state. A stale USB observation does not prove a keyboard is still connected. A missing credential is a setup state, not an invitation to ask the model for secrets.

The existing prompt's blanket "After he applies one, he still has to build and flash it" is not a sufficient account of auto-sync. Generate that explanation from the target config and sync policy instead. Never say "I can't access your other keyboard" before checking the registered collection.

## Coverage is an inventory of workflows, not a growing tool count

S56 produces the exact action inventory at the implementation SHA. This table specifies required coverage groups; it does not claim they are all agent tools today.

The [source inventory at c5efcb5](../research/agent-capability-inventory.md) traces the current UI/API/app/CLI/agent routes and their gaps. It is source evidence, not an executed parity check. In particular, current agent blank-config creation differs from the UI/CLI firmware-default path, and `put_config` prepares a destination rather than selecting what its keyboard runs.

| App workflow | Existing use cases or source to reuse | Required agent result |
|---|---|---|
| Browse and explain boards/configs/layers/keys | `layouts.ts`, `boards.ts`, current read tools | Navigable collection or key references |
| Change bindings, macros, combos, layers, conditions, timing and lighting | `changes.ts`, existing `ChangeOp` union and validator | The same proposals, warnings and canvas previews |
| Priorities and decision outcomes | `decisions.ts`, current memory tools | Editable/retirable memory records with scope |
| New/copy/import/rename/archive/restore/delete config | `configs.ts`, `import-upload.ts`, `layouts.ts` | Config result; typed confirmation for destructive effects |
| Compare, name or restore a version; undo | `versions.ts`, `history.ts`, `changes.ts` | Existing diff and restore result |
| Read reviews, request a review, hide/restore a finding | `review.ts`, `review-engine.ts` | Existing findings, target keys and proposals |
| Copy a setup or part of one to another board | `keyboard-put.ts`, deterministic correspondence and copy plans | Transfer report plus destination proposals |
| Generate/build firmware, sync, choose config on keyboard, pause/resume/enable sync | `firmware.ts`, `sync.ts`, current safety checks | Job reference and actual per-device state |
| Remapper setup, proof of exit chord, disable remapping | `remapper.ts` | Guided local action and verified remapper state |
| Typing lab start/stop/analyse/delete and findings | `lab.ts` | Explicit recording controls and aggregate findings |
| Detect/add a keyboard and import/export | `keyboard-detect.ts`, `keyboard-add.ts`, import/generator use cases | Board preview, import report or downloadable export |
| Provider selection, theme, separate case/keycap colors and app navigation | `chat-model.ts`, web shell/settings handlers | Typed app setting or local UI intent |
| Diagnostics and emulation | `doctor.ts`, `emulate.ts` | Findings, script/result summary and safe recovery actions |

For every action record: stable action ID, owning use case, CLI command, API/UI entry point, agent tool, input schema, availability rule, effect class, renderer and an end-to-end test. Maintain a conformance test over the explicit inventory. It must fail when a shipped app action is deliberately added without an agent route or a justified human-only step. It cannot infer correct coverage merely by counting exports.

OS permission dialogs, credential entry and a browser file chooser may require BK's local gesture. The agent brings up the appropriate in-app control and resumes with its typed result. Raw credentials do not enter the conversation. Contributor source-editing and arbitrary coding-agent work are outside the app's runtime workflows; do not smuggle in a shell to claim parity.

## Effects decide whether the agent runs or prepares an action

The registry assigns one of these policies. Q32 must be resolved before mutating capabilities ship.

| Policy | Examples | Rule |
|---|---|---|
| Read | List configs, inspect keys, compare versions, read diagnostics | Run without confirmation; no domain mutation |
| Local view | Open History, select a layer, set this browser's theme | Typed client intent; acknowledgement reports whether the view actually changed |
| Safe preparation | Create a separate config, save proposals, record an explicit priority | Existing reversible defaults remain; record the effect and return an openable result |
| Config mutation | Apply a preview, restore a version, change firmware settings | Prepare a validated plan; BK approves its exact scope |
| Device or recording effect | Put a config on a keyboard, restart/sync, enable auto-sync, start recording | Explicit device/recording disclosure and the existing safety gates |
| Irreversible | Delete a config or recording | Exact existing confirmation requirements; no model bypass |

Applying to the active config may trigger already enabled auto-sync. The Apply card must say so before confirmation. Do not present it as a harmless local save. Editing an inactive config does not activate it. Preserve first-flash consent, exit-chord proof, typed-name deletion and firmware compatibility checks.

Use typed tools for coherent jobs rather than dozens of arbitrary mutations. Existing read/propose/map tools remain. New operations may use a schema-discriminated `prepare_action` over registry action IDs; it cannot name an unregistered handler. The model cannot invoke the confirmation endpoint or mint a user approval.

```ts
// Proposed shared contract; illustrative type names, not current exports.
type TargetRef = { boardId: string; configId: string; revisionId: string };
type PreparedAction = {
  id: string;
  runId: string;
  actionId: string;
  targets: TargetRef[];
  digest: string;                 // server-computed canonical plan fingerprint
  effects: string[];              // plain, server-derived disclosures
  changeSetIds: string[];
  deviceEffect: "none" | "auto_sync" | "explicit_sync" | "remapper_reload";
  status: "pending" | "confirmed" | "completed" | "stale" | "cancelled" | "failed";
};
```

A request such as "apply that" is a user action, not a model's claim of consent. Keyloom may resolve it only to one existing pending plan that BK was shown, with unchanged digest and targets. If several plans fit, ask which one. The same message cannot approve a newly generated, unseen plan. Persist one confirmation receipt and enforce idempotency in the use case (D-403).

## Events describe operations, artifacts and public messages

Replace the name-only activity stream with a versioned event envelope. Retain the old chat route during migration; do not make old conversations unreadable.

```ts
type RunEvent = {
  version: 1;
  runId: string;
  seq: number;                 // persisted, strictly increasing within a run
  at: number;                  // epoch milliseconds
  payload:
    | { type: "run_started"; contextId: string }
    | { type: "phase"; phase: "thinking" | "writing" | "waiting_user" | "waiting_confirmation" }
    | { type: "message_delta"; messageId: string; text: string }
    | { type: "message_finished"; messageId: string; role: "working_note" | "answer" }
    | { type: "operation_started"; operationId: string; tool: string; targets: TargetRef[]; summary: string }
    | { type: "operation_finished"; operationId: string; status: "succeeded" | "failed" | "cancelled"; summary: string; effectIds: string[] }
    | { type: "artifact"; artifactId: string }
    | { type: "waiting"; questionId?: string; planId?: string }
    | { type: "job_linked"; jobId: string; kind: "build" | "sync" | "lab" }
    | { type: "run_finished"; status: "completed" | "blocked" | "failed" | "cancelled" | "interrupted" };
};
```

Question and plan waiting variants must be exclusive in the real zod schema. Treat this code as a contract outline, not permission to implement optional-field states that can be contradictory.

Allocate an operation ID before calling a tool, persist start, then persist exactly one terminal event and any result/effect references. Different parallel calls have different IDs. A tool exception is failed, not success with an empty result. Schema-invalid or validator-rejected results are classified as unsuccessful even if the JavaScript function returned normally. A process crash may leave a start without a finish; recovery marks it interrupted or reconciles its durable effect, never guesses success.

The wrapper in `run-turn.ts` is the common instrumentation point for all provider tools. Add provider-neutral message-boundary observation where needed. Text before another tool call becomes a working note; only the terminal public answer is the final answer. The current `onText` callback alone cannot classify that distinction. If a provider lacks safe incremental boundaries, deliver its answer whole. Do not fabricate token streaming or fine-grained thinking events (S54).

Tool input and output summaries use per-capability allowlists and size caps. Keep operational labels separate from tool names. Opaque thinking, raw model replay, key material, full layout dumps and lab recordings do not belong in these events. Use artifact IDs for larger typed results.

## Runs survive reconnect; execution does not follow the socket

Proposed routes, with the existing localhost Host/token guards and zod-validated JSON:

| Route | Job |
|---|---|
| `POST /api/agent/runs` | Accept a unique client request ID, conversation ID or new-conversation request, user input and focus; return the persisted run |
| `GET /api/agent/runs/:id` | Current run snapshot, context, artifacts, waiting state, effects and linked job states |
| `GET /api/agent/runs/:id/events?after=<seq>` | Snapshot/catch-up plus live SSE; event ID is the run sequence |
| `POST /api/agent/runs/:id/answer` | Typed answer to the exact open question; resume with an idempotent answer ID |
| `POST /api/agent/plans/:id/confirm` | User-originated confirmation with the displayed digest and unique request ID |
| `POST /api/agent/runs/:id/cancel` | Stop future model/tool work and cancel only jobs that are safe to cancel |

This is an incremental successor to `POST /api/layouts/:ref/chat`, not a claim that chapter 01's historical stream URL is the current implementation. New runs may have no focused config, so listing keyboards works before one is open.

Persist run status as `running`, `waiting_user`, `waiting_confirmation`, `completed`, `blocked`, `failed`, `cancelled` or `interrupted`. A fresh request enters running; a question/plan moves it to its waiting state; a valid answer/approval resumes it; terminal outcomes do not implicitly restart. Continuing an interrupted task creates a new run linked to the old receipts. An approval is executed by the application and need not launch another model call.

Run status describes agent execution, not the linked device's state. `completed` with an unfinished sync still projects as "Sending" at task level. Follow existing sync/job events and join them into run snapshots; do not duplicate the sync engine inside agent status. Routine work folds only when no question, confirmation, failed step or linked unfinished job needs attention.

The first rung preserves explicit Stop but decouples a dropped browser connection from task cancellation. Closing the column or switching boards does not stop a run. Only one active foreground run per conversation is accepted; a second input gets a visible busy response and retains its draft. Supporting steering mid-run is deferred, not simulated by racing two loops.

Deduplicate `(runId, seq)` on reconnect, resume from the last sequence, and offer a current snapshot if old events were pruned. Unknown optional presentation events show a fallback; an unknown protocol major version refuses new writes and asks for a reload. A heartbeat proves transport liveness, not task progress. A quiet operation shows its actual elapsed time and last confirmed phase, not a made-up percentage.

On server restart, never automatically rerun a partially completed mutation. Reconcile saved effects and linked build/sync jobs first, mark the model run interrupted, and let BK continue. The existing sync engine owns flash recovery and safe cancellation. Stop during an unsafe write says "Stopping after this device write finishes"; it must not promise that the hardware can be interrupted safely.

## Persist presentation separately from model history

Proposed additions, with ULID-style IDs matching existing persistence and epoch-millisecond timestamps:

| Record | Minimum fields and constraints |
|---|---|
| `agent_runs` | `id PK`, `conversation_id FK`, `client_request_id UNIQUE`, `context_id FK`, status, started/finished times, last sequence; indexes on conversation/time and unfinished status |
| `agent_contexts` | `id PK`, conversation, user-message reference, immutable focus/source/target context JSON validated by schema; archived with conversation |
| `agent_events` | `(run_id, seq) PK`, event version, timestamp, sanitized payload; append-only and run-indexed |
| `agent_artifacts` | `id PK`, `run_id FK`, kind/version, scoped typed payload; index by run; proposal artifacts reference existing change sets |
| `agent_plans` | `id PK`, run, action ID, immutable canonical input/targets, digest, state, unique confirmation request ID when confirmed |
| `agent_effects` | `id PK`, run, operation, action ID, unique effect idempotency key, targets, typed result reference, completion time |

Record a local mutation's effect and domain change in the same SQLite transaction where possible. Existing synchronous use cases may need an idempotent wrapper or transaction hook; do not paper over the commit/receipt gap with a later log write. External jobs return stable job IDs and reconcile from their own records. A retry either returns the recorded result or proves the effect never committed before running it again.

Migrate additively. Old messages and change sets keep their IDs, provider data and original ownership. Old turns get a "Working details unavailable for this older conversation" fallback if opened; do not invent an activity history. New artifacts belong to their producing run/message instead of hanging every proposal off the last assistant reply.

No-focus and cross-board conversations need an explicit ownership migration (Q31/S55). Add `scope: layout | workspace`; existing rows remain layout-owned. Workspace rows have a nullable origin layout reference for indexing, not ownership, and may start with none. Preserve IDs and foreign keys when rebuilding SQLite's non-null conversation table. Deleting an origin config detaches a workspace origin, invalidates its affected pending plans and removes only config-owned domain data; it does not delete another target's revisions or the whole workspace conversation. The old config-owned deletion path remains for legacy conversations. This narrowly proposed change to D-308 is recorded in D-402.

Q36 assumes conversation-lifetime storage with bounded summaries. Deleting a conversation removes its presentation records through the existing deletion path; shared revisions and physical sync history follow their existing ownership rules, not an event cascade. Finalize actual per-event bounds and a total run budget during S54, then enforce them at the persistence boundary.

## A finite artifact union drives the UI

Start with `proposal`, `comparison`, `transfer`, `keyboard_list`, `key_locations`, `finding`, `question`, `confirmation`, `config_result`, `import_report`, `diagnostic` and `device_outcome`. Each kind has a version, scoped references and a zod schema. The renderer registry is an exhaustive app-owned mapping, not model-generated code (D-404).

Reuse `ProposalCard`, `ProposalCompare`, `QuestionCard`, the existing board renderer, history diff and lab/review views. Refactor their data adapters only where the new ownership requires it. UI-only commands use typed client intents; the client sends an acknowledgement before the agent claims a view or local setting changed. A disconnected CLI returns a navigable reference or an explicit unavailable view result, not a false success.

## The CLI can inspect and complete the same work

Proposed additions under `keyloom agent`:

```text
capabilities [--format json]
runs list
run show <run>
run events <run> [--after <seq>] [--follow]
run answer <run> --question <id> --value <json>
run cancel <run>
plan show <plan>
plan confirm <plan> --digest <digest>
```

Keep current `chat send` working. New commands call the same application layer and preserve the established output/error contract in [10](10-cli.md). Structured input values and exact command options are finalized alongside the zod wire schemas, not handwritten separately. No `--yes` flag bypasses validation, an ambiguous target or a first-device safeguard.

## Verification proves coverage and honest effects

- Script all provider adapters through read, tool failure, validator rejection, question/pause/resume, cancellation and final answer. No paid model call is part of the ordinary suite.
- Replay duplicate and out-of-order event deliveries into the pure reducer; final UI projection must equal the persisted snapshot. A failed tool cannot leave a running shimmer after termination.
- Disconnect after a safe config creation, then resume and retry. Exactly one config and one effect receipt must exist.
- Race confirmation with a CLI edit. The old plan is refused as stale without changing the target.
- Check the action inventory against direct UI and CLI behavior, including negative cases and OS-owned steps. Every shipped action has either a working agent capability or an explicit, tested local handoff.
- Verify no event, artifact, log or provider input contains a recorded typing passage, raw trace or credential. Keep provider replay available only to its existing storage/adapter boundary.
- Exercise through a scratch data directory and fake USB/flash adapters, then use installed-release checks appropriate to each rung. Real hardware permission is separate and per session.

The staged delivery and observed completion checks live in [13](13-roadmap.md). Do not replace them with "all tests pass" or claim app-wide coverage before the inventory is complete.
