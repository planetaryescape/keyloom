# 26a backend contract

Implementation scope: current layout-owned chat observation only. No durable runs, execution recovery, automatic resend, new capabilities or UI changes. Default legacy SSE events remain unchanged.

## Negotiation and exports

- `ChatRequestSchema` accepts optional `presentationVersion: 1`. Omission selects the legacy stream. An unsupported version returns HTTP 400 `usage` before any message/model/tool execution, with an upgrade/omit-version instruction.
- `ChatEventSchema` remains the old strict union. New `ObservedChatEventSchema` extends it with `{type:"presentation", presentation: ChatPresentation}`. Only opted-in requests receive these frames. Each frame is a complete bounded turn snapshot, not an append-only replay log.
- `ConversationDetailSchema` gains optional `presentations: ChatPresentation[]`. Old servers omit it; missing/empty means working details unavailable. Old clients strip the additive field. `ChatPresentationSchema` and `ObservedChatEventSchema` are exported from `src/api/http.ts`.
- CLI adds `keyloom conversations show <id>` using the existing table/json/ids contract. JSON includes safe `presentations`; no raw model replay is exposed.

## Snapshot shape

```json
{"type":"presentation","presentation":{"version":1,"userMessageId":"msg_...","status":"running","operations":[{"id":"op_1","tool":"get_layout","label":"Read layout","status":"running","durationMs":0,"validationCodes":[],"references":[],"accepted":0,"declined":0}],"messages":[],"effectsMayHaveOccurred":false,"warning":null,"detailsTruncated":false}}
```

`status`: `running | waiting_user | completed | incomplete | failed | cancelled | unobserved`.

Operation `status`: `running | succeeded | failed | declined | partial | unknown`. IDs correlate invocation start and terminal update, including parallel repeated tools. Safe metadata includes validation counts/codes and typed stable references only. Labels are server-owned, with no raw inputs/results/exceptions or user-defined names. `durationMs` is measured at execution.

Operation/public-message IDs are unique within their `userMessageId` namespace, not globally. A running operation's `durationMs: 0` is a placeholder; elapsed time is known on completion. Unknown operations are not projected as successful merely because their handler returned.

Public messages: `{id:"public_1", kind:"working_note"|"answer", text:"...", messageId?:"msg_..."}`. Only provider public text enters this array; never opaque thinking. Whole completed messages are emitted at safe boundaries; this channel does not promise token streaming. `messageId` is added after existing model messages are stored. A terminal incomplete/refused response is not a successful answer. Live/reloaded public message grouping is identical for a completed turn.

Waiting comes from the model's valid pending `ask_user`, even if its handler never executes. `questionToolUseId?: string` links the exact waiting call; accepting its answer completes the old waiting snapshot atomically with the answer message and emits the updated old snapshot to opted-in clients. Always route snapshots by `userMessageId`, not the newest assistant turn.

Failure/Stop snapshots retain completed work, turn still-running operations to `unknown`, and warn that preparation may have happened whenever a mutating tool entered. Stop is not rollback. Socket loss still may abort. A stored running snapshot with no owner in this process reads as `unobserved`, not success or proof that execution stopped. This includes inspection from a separate CLI process: work might still be running in the server. The warning says so. No execution recovery is attempted.

## Bounds and safety

At most 64 operation executions; stop before admitting a 65th. At most 64 KiB serialized snapshot. Static labels are at most 80 characters; each operation stores at most four allowlisted validation codes and two generated-ID references. Public text has an 8 KiB shared JSON-encoded budget and is marked truncated when clipped. Existing canonical messages/provider replay are not rewritten; `messageId` can retrieve full canonical text when details were clipped. Up to 64 operations/public-message entries; no per-token persistence. A snapshot may be larger than S54's suggested 4 KiB individual event because it replaces the entire bounded turn projection, rather than appending an unbounded event stream. Snapshot persistence occurs on observations and terminal paths, linked by original user message with conversation-delete cascade. Domain mutations and observations are NOT an atomic effect receipt.

Opted-in streams still include legacy `text`, proposal/priority and `done` frames. Once the first `presentation` frame is seen, use its public-message grouping rather than concatenating legacy `text` into another answer. No presentation frame means old-server fallback. No events are synthesized for tools that did not execute. No UI should auto-resend a request when observation is lost.

On local Stop the socket may close before the terminal snapshot arrives. Read the existing conversation to inspect the saved warning; do not infer rollback from the last received frame. A successful model turn does not mean all operations succeeded: leave `failed`, `declined`, `partial` and `unknown` operation results inspectable. Existing unanswered question and unapplied proposal cards still own their attention state.

## Sample terminal frame

```text
event: presentation
data: {"type":"presentation","presentation":{"version":1,"userMessageId":"msg_example","status":"completed","operations":[{"id":"op_1","tool":"propose_changes","label":"Prepare proposals","status":"declined","durationMs":3,"validationCodes":["firmware_unsupported"],"references":[],"accepted":0,"declined":1}],"messages":[{"id":"public_1","kind":"answer","text":"The proposal was declined.","messageId":"msg_answer"}],"effectsMayHaveOccurred":true,"warning":null,"detailsTruncated":false}}
```

The count/status, not the model's answer text, establishes that validation refused the proposal. `effectsMayHaveOccurred` is conservative: it is set when a preparation/memory-writing tool enters, not a claim that a mutation actually committed. Stable references identify observed saved results where available; they are not idempotency receipts.

This note is a backend handoff, not a deployed contract. Exact runtime schemas/tests and final completion packet govern integration. Product/UI approval and release gates remain open.
