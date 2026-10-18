# Inspect the same saved agent work

Use the versioned run routes or `keyloom agent` commands to inspect accepted work without asking the model to execute it again. This contract shipped in v0.43.0. Conversations remain layout-owned; Q31/Q32 and new capabilities are not part of this slice.

## Accept and inspect

```text
POST /api/agent/v1/runs
{ "version": 1, "requestId": "unique-client-identity", "layoutRef": "lay_…",
  "input": { "message": "Prepare a copy" } }

GET /api/agent/v1/runs/<run-or-request-id>
GET /api/agent/v1/runs/<id>/events?after=<sequence>
GET /api/agent/v1/conversations/<conversation-id>/run
POST /api/agent/v1/runs/<id>/answer
{ "version": 1, "requestId": "unique-answer-identity",
  "answer": { "toolUseId": "exact-question", "text": "Left" } }
POST /api/agent/v1/runs/<id>/cancel
{ "version": 1 }
POST /api/agent/v1/requests/<opaque-request-id>/cancel
{ "version": 1 }
```

The existing Host/token guards still apply. Writes require JSON. Unsupported major versions refuse writes. Legacy `POST /api/layouts/:ref/chat`, its strict event union and presentation-version negotiation are unchanged.

Acceptance stores the request identity, exact canonical scope/input, conversation and user message in one immediate transaction before launching the model. Repeating an identical identity returns its original run, including after interruption; different scope/input refuses. Question matching and target-revision checks occur within acceptance, not under a process-local lock alone. Answers create an identity-linked continuation turn in the same conversation; repeating the answer identity returns that continuation rather than continuing twice.

A snapshot contains version, run/request/conversation/user-message IDs, status, sequence, cancellation-request state, committed-preparation count, allowlisted preparation references and the existing bounded presentation. Raw receipt inputs/results, credentials, opaque thinking and recordings are not exposed. Canonical uncapped answers remain in conversation history, separate from capped presentation text.

Conversation detail has optional `preparationReceipts`, grouped by original `userMessageId`, so an older interrupted turn retains its facts after later turns and reload. When work needs recovery, the existing operation list shows separate receipt rows with allowlisted references. `receipt:effect_N` is a distinct namespace from observer `op_N`; no association is guessed from names, ordinals or completion order, and an unknown observer operation remains unknown. A receipt with no saved reference is an unconfirmed recorded outcome, not a green preparation. Routine completed presentation is unchanged. The UI bounds the combined list at 128 rows: 64 observations plus 64 receipt facts.

New Codex executions namespace their emitted canonical call/result/pending IDs with a fresh execution identity. Codex's inner MCP IDs and stored historical IDs are unchanged. This prevents a new execution's `item_0` question from inheriting an earlier execution's answer.

`events` emits `snapshot` SSE frames with `id: <sequence>`. Catch-up coalesces to the latest complete snapshot; it is not a replay of every intermediate event. A client rejects duplicate/older sequences. The browser uses the same read-only snapshot contract through polling, then reads canonical history. It never resends acceptance to reconnect. Both snapshot and SSE subscriber disposal leave execution running.

## Stop and restart

The app owns each accepted run's controller. Closing chat, changing boards, loading history or losing a subscriber does not abort it. Explicit Stop persists a cancellation request; this process aborts its own run immediately, and a foreign owner observes the request through its cancellation poll. The response remains `running` plus `cancelRequested` until the owner records a terminal result. Stop does not remove already committed preparation.

Before acceptance, Stop uses the explicit request-cancellation route. It returns HTTP 202 with `{version:1,status:"pending_acceptance",requestId,cancelRequested:true}`: this is a stored intent, not an accepted or terminal run. If the request already exists, the route instead returns its normal snapshot with HTTP 200. The old run-cancellation route still returns 404 for an unknown run; it does not invent one.

Migration 0014 adds `agent_request_cancellations`. Acceptance consumes the matching intent inside the same immediate transaction that stores input and claims its run. It stores a cancelled run/presentation and never registers a model owner or invokes a tool. The intent survives credential-resolution awaits, separate readers and process restarts. Repeated input returns that same cancelled run; different payload/scope still refuses. A lost acknowledgement is recovered by GET, not another acceptance POST. Only explicit Stop writes intent; unmount/disconnect never does.

At most 1024 unaccepted cancellation intents are retained. They never expire or evict one another. When full, a new pending Stop visibly refuses as not recorded, and new non-matching acceptance fails closed; matching cancelled requests can still be accepted without execution and consume their intents. Network/server errors likewise remain visible failures, not optimistic cancelled claims. The browser retains a local Stop latch only to prevent a legacy fallback POST after an unsupported route response; server-side intent, not cancellation on acknowledgement, prevents the acceptance race.

Server shutdown aborts and drains owned runs before the CLI closes SQLite. On subsequent inspection/startup, a dead owner's unfinished run becomes `interrupted`; no model or tool is automatically replayed. A live foreign PID is not treated as dead simply because this reader does not own it. PID reuse is handled conservatively: the code does not assert that an unverified live foreign process has stopped.

No registered chat tool currently starts build/sync/flash jobs. This slice adds none and does not fabricate a device-job cancellation demonstration. Existing sync/build/flash authority is unchanged. The deployable promise is durable current chat preparation and questions, not new device control.

## Preparation receipts

`agent_runs` and `agent_effects` are additive tables. Existing conversations/messages/proposals retain their IDs and deletion ownership. `agent_effects` stores each synchronous preparation's original local result in the same outer SQLite transaction as its domain writes. Existing nested use-case transactions are savepoints, verified by receipt-insert fault tests.

All five writing ports are covered: `create_config`, `put_config`, `propose_changes` (including the whole alternatives array and invalid validation outcomes), `record_priority` and `update_decision_outcome`. Each receipt binds the run, application invocation ordinal, tool, layout/conversation and exact input. These are application invocation identities, not provider-call-ID deduplication. An interrupted model loop is never retried automatically because receipts exist.

## CLI

```sh
keyloom --data-dir <scratch> agent show <run-or-request-id>
keyloom --data-dir <scratch> agent start <layout> 'Ask once' --request-id <unique-id>
keyloom --data-dir <scratch> agent answer <run> <question-tool-id> Left --request-id <unique-answer-id>
keyloom --data-dir <scratch> agent cancel <run>
keyloom --data-dir <scratch> agent cancel <request-id> --request
```

`start` and `answer` wait for work owned by that CLI process. Inspection of another process's run never launches work. Table, JSON, JSONL and IDs use the existing output conventions. A browser stores only an opaque current request/run identity per layout, not message text or tokens. A lost acknowledgement can therefore be recovered by GET using that identity. Legacy fallback is permitted only after a definite 404 response, never after a timeout or ambiguous accepted POST failure.

## Verification

Run the preparation, protocol, projection and CLI regressions:

```sh
bun test test/app/agent-runs.test.ts test/cli/agent-runs.test.ts test/web/chat-run-transport.test.ts test/web/chat-saved-runs.test.ts
bunx tsc --noEmit
bun run depcruise
```

See [implementation evidence](26b-implementation.md) for the source checks and [public v0.43.0 acceptance](../../screenshots/agent-experience/26b-published-0.43.0/README.md) for the installed CLI and bundled-web journeys. That evidence does not certify native WebKit, paid-provider behaviour or hardware.
