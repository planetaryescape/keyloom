# The agent extension starts from existing tools and a narrower execution scope

Source baseline: freshly fetched `origin/main` at `71934e13f8c0c8b702b6dc1beb57ca25993f7cf3`, read on 2026-10-18. These are source observations, not a browser audit or evidence that a hardware workflow passed. The new [experience](../blueprint/28-agent-experience.md), [app control](../blueprint/29-agent-app-control.md) and [keyboard context](../blueprint/30-agent-keyboard-context.md) chapters are proposals.

A design change landed during writing. The worktree was fast-forwarded to `72370d0494497ae4bdd6036106fcec9d3f6c1aab`, and its diff was read before final verification. It adds [the no-accent-stripe/no-sparkle rule](../blueprint/18-visual-design.md#patterns-keyloom-doesnt-use) and D-319's separate case/keycap controls. The new chapters inherit both. None of the agent/runtime/persistence paths cited in the source table changed in that commit.

BK described the desired experience in this session. We did not research external chat products or add a UI framework. The implementation should first reuse Keyloom's own components and use cases. No code from another repository is proposed for copying.

## The existing seams already cover important parts of the request

All paths below refer to the full source SHA above. Line ranges describe that commit, not future implementations.

| Observation | Source | Consequence for the blueprint |
|---|---|---|
| Stored model blocks distinguish text, tool use, tool result and opaque provider data. `AgentModel` is provider-neutral. | [src/agent/model.ts](../../src/agent/model.ts), lines 7–16 and 49–83 | Add a presentation projection; do not render provider replay or opaque thinking |
| The common tool wrapper reports a tool name on start and records duration/success after execution; no result callback is exposed to the UI there. | [src/agent/run-turn.ts](../../src/agent/run-turn.ts), lines 23–29 and 67–83 | Extend this shared seam with correlated start/terminal events |
| The wire event union has text, a name-only tool event, proposals, priorities, done and error; it has no durable per-operation lifecycle. | [src/api/http.ts](../../src/api/http.ts), lines 309–320 | Do not pretend the current event shape can drive completed/failed activity rows |
| User and assistant components are already separate. The assistant shows a spinner/activity line, a question card and proposals. | [src/web/chat/Turns.tsx](../../src/web/chat/Turns.tsx), lines 14–29 and 75–162 | Improve hierarchy and composition; do not describe these features as wholly absent |
| Several older tool names have labels; everything else falls back to "Working…". | [src/web/chat/activity.ts](../../src/web/chat/activity.ts), lines 1–11 | Expand semantic labels through capability metadata rather than accumulating a second manual tool catalog |
| The pure transcript reducer keeps one activity string and concatenated text. Reload attaches all conversation proposals to the last assistant turn. | [src/web/chat/transcript.ts](../../src/web/chat/transcript.ts), lines 7–23, 64–90 and 159–183 | Add an event/run projection and explicit artifact ownership; retain legacy fallback |
| The registered tool list includes reads, checked proposals, mapping, put-config, findings, questions and config creation. | [src/agent/tools/index.ts](../../src/agent/tools/index.ts), lines 21–36 | Reuse these 13 tools; broader app coverage requires more than a visual reskin |
| The agent can read other layouts, but checking/proposing and memory methods close over one layout ID. | [src/agent/ports.ts](../../src/agent/ports.ts), lines 128–157; [src/app/agent-ports.ts](../../src/app/agent-ports.ts), lines 33–104 | Make execution target explicit per operation, retaining per-config validation and memory |
| `put` already creates a config and proposals elsewhere and returns mapping details. Its proposals are not raised as ordinary cards in the origin chat. | [src/app/agent-ports.ts](../../src/app/agent-ports.ts), lines 55–61; [src/agent/ports.ts](../../src/agent/ports.ts), lines 117–126 | Return transfer artifacts referencing the existing proposal IDs, not duplicate proposals |
| `QuestionCard` supports option buttons, optional free text and answered state; its first option is always marked recommended. | [src/web/chat/QuestionCard.tsx](../../src/web/chat/QuestionCard.tsx), lines 13–108 | Extend to typed domain inputs; make recommendation explicit |
| Questions are stored as open tool calls and answers become tool results; another text message can answer instead. | [src/app/conversations.ts](../../src/app/conversations.ts), lines 104–113 and 181–190 | Preserve pause/resume; do not keep a process alive while BK chooses |
| A conversation is rejected if its layout differs from the request's current layout. The carried thread is read-only. | [src/app/conversations.ts](../../src/app/conversations.ts), lines 157–175; [src/web/chat/CarriedThread.tsx](../../src/web/chat/CarriedThread.tsx), lines 4–9 | Conversation continuity is a real scope/migration decision, not a CSS change |
| Browser stream cancellation aborts the request; a five-second comment heartbeat keeps transport alive. | [src/server/chat-routes.ts](../../src/server/chat-routes.ts), lines 118–125 and 142–152 | Durable reconnect needs run ownership separate from the HTTP socket |
| App use cases already expose config/version, import, firmware, sync, review, remapper, diagnostics and lab operations. | [src/app/index.ts](../../src/app/index.ts), lines 4–70 | Build typed capabilities over those functions rather than shell wrappers |
| The command matcher offers lab, config creation, config switch and putting a config on the current board. | [src/web/chat/commands.ts](../../src/web/chat/commands.ts), lines 4–16 and 27–63 | Keep local shortcuts, but do not mistake this subset for whole-app agent coverage |
| Supported board definitions and saved layouts are listed separately by the CLI. | [src/cli/main.ts](../../src/cli/main.ts), lines 84–99 and 137–151 | Supported keyboards are not necessarily BK's registered collection |
| On-keyboard config and auto-sync proof are keyed by board ID. Conversations have a non-null layout owner. | [0010_configs_and_versions.sql](../../src/persistence/migrations/0010_configs_and_versions.sql), lines 9–13; [0008_keyboard_sync.sql](../../src/persistence/migrations/0008_keyboard_sync.sql), lines 7–13; [0004_conversations_and_messages.sql](../../src/persistence/migrations/0004_conversations_and_messages.sql), lines 3–9 | Duplicate-model physical identity and no-focus conversations require a migration, not just aliases |
| Sync has real building/restarting/writing/verifying phases, offline and needs-hand states, and auto-sync facts. | [src/api/http.ts](../../src/api/http.ts), lines 424–509 | Link device progress to those facts; do not call a finished answer a verified keyboard |
| The prompt says other layouts are read-only and says BK still has to build/flash after applying. | [src/agent/prompts/system.md](../../src/agent/prompts/system.md), lines 3–6 and 19–32 | Change the target-scope instruction for the new capability; derive device wording from actual auto-sync state |
| A failed assistant message unconditionally appends "Nothing was changed." | [src/web/chat/Turns.tsx](../../src/web/chat/Turns.tsx), lines 163–170 | As capabilities gain effects, use receipts to state what did and did not change |

## Existing design and safety decisions remain authoritative

[23-design-concept.md](../blueprint/23-design-concept.md) supplies the approved visual world, board-first stage, semantic light, motion and screenshot gate. D-318 moved Ask keyloom to the side column; do not revive the foot bar just because older text still describes it.

[20-cross-board.md](../blueprint/20-cross-board.md) documents the deterministic correspondence and copy rules. The new scope does not replace those algorithms with model judgment. [25-configs-and-versions.md](../blueprint/25-configs-and-versions.md) distinguishes editing a config from choosing the one the keyboard runs.

We did not read BK's live database, attach to his current server, invoke a paid model, build firmware or flash anything for this source reading. Use synthetic scenarios and scratch data for the proposed checks. Existing hardware observations stay in their original spike records.

## Resolve these uncertainties by experiment

The source reading does not prove that provider adapters expose enough public message boundaries for the desired streaming UI, that arbitrary cross-config conversation ownership can migrate safely, or that two same-model devices can be distinguished. S54, S55 and S57 in [the spike ledger](../blueprint/15-open-questions.md) own those experiments. S56 owns the complete app-action inventory; the workflow groups in chapter 29 are required coverage, not a claim that this reading audited every app control.

## S54 reproduced the message and cancellation gaps

The S54 worker ran deterministic production-adapter/app-port experiments at `c5efcb583c69df8841d154990fd3e63e92f9207b`. Evidence is held in its isolated `spike/agent-lifecycle` worktree as `docs/research/spikes/S54.md` and a synthetic harness. This is not a live-provider or hardware check.

- All three provider paths execute ordinary tools through the common wrapper. Anthropic/OpenRouter stop at `ask_user` without executing its handler; Codex executes it. Waiting therefore needs a pending-question observation as well as tool instrumentation.
- A malformed input throws and is traced as unsuccessful. A validator-declined proposal returns normally and is currently traced as `ok: true`. Wrapper-return success cannot determine domain success.
- A public note followed by a tool and final answer becomes one live text string, but separate messages after reload. The final `ChatOutcome.text` is only the final answer. A safe public message boundary is needed; private thinking remains opaque.
- Cancelling immediately after a synthetic config is committed leaves that config and only the user request in model history. Explicit resend attempts the tool again. The same-name uniqueness check leaves one config, but it does not return the original successful receipt. This experiment did not observe a duplicate config; it observed a repeated attempt and missing receipt.
- Cancelling the HTTP response body aborts the backend. There is no persisted run cursor or request-ID deduplication at this baseline, so durable replay could not be proven against a nonexistent run implementation.

The worker reports 90 targeted tests passing (382 assertions), a later final spike/transcript run of 32 tests passing (111 assertions), and a successful typecheck. The parent read the complete harness/report and the existing SSE parser, chat hook and CLI seams before adopting the split. These checks characterize current behavior; they are not release acceptance for the new product.

D-408 splits rung 26 into 26a's honest presentation and 26b's durable ownership/recovery. The worker's proposed limits are 4 KiB per serialized event, 512-byte labels/summaries, bounded allowlisted detail, and 256 events/256 KiB per run with reserved terminal capacity. These are implementation defaults to validate, not measured user requirements. Do not persist token deltas or raw tool results to make the UI look busy.
