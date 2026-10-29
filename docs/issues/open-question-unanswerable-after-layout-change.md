# A question that waits can't be answered once the layout head moves by any means but an apply of its conversation's proposal

Status: open. Found by the A2 verifier in round 3, who reproduced it by applying an unrelated proposal. A2 closes that case: applying any agent proposal of the conversation now closes its open question (D-452). The cases below are not covered. Checked against origin/main `e90ab9eaf9536495be26b10f8625d63a98f1c167` (v0.58.0), where it already happens.

The agent asks a question and the turn pauses; BK sees the options. If the layout changes before he answers, the card still offers its options, the run stays `waiting_user`, and picking one fails. Typing a message instead still works and ends the run.

## What refuses the answer

Two guards, both from `7a98f81` (durable runs, 2026-10-18, D-411). Each refuses an answer once the layout head is not the one the run paused on:

- `src/app/agent-runs.ts:148` in `answerAgentRun`: `if (row.status !== "waiting_user" || getLayout(app, row.layout_id).revision.id !== row.revision_id) throw new UsageError("that question or its target is no longer current")`.
- `src/app/conversations.ts:226` in `storeMessage`: `if (input.answer !== undefined && waiting?.status === "waiting_user" && waiting.revision_id !== view.revision.id) throw new UsageError("that question's target has changed")`.

Both lines are as at `e90ab9e`. `agent_runs.revision_id` is the head when the run was accepted (`startAgentRun`).

## Repro

Any revision on the layout moves the head. This one uses an editor edit, on a scratch app and a scripted model (`test/helpers/*`; run with `bun test`):

```ts
const { app, layoutId } = await commandShiftApp();
const { client } = fakeAnthropic([{ blocks: [{ tool: "ask_user", input: { question: "Which hand is free?", options: [{ label: "Left" }, { label: "Right" }] } }] }]);
const model = anthropicModel(client);
const run = await startAgentRun(app, { version: 1, requestId: "r1", layoutRef: layoutId, input: { message: "put F5 on F16" } }, { model });
await waitForAgentRun(app, run.id);                                     // waiting_user, the question open
const { conversationId } = run;
const toolUseId = showConversation(app, conversationId).messages.flatMap((m) => (m.question ? [m.question] : []))[0]?.toolUseId ?? "";
applyOps(app, layoutId, { baseRevisionId: getLayout(app, layoutId).revision.id, ops: setKey(6, "F5"), summary: "edit F16" });
// The conversation still shows the question open and the run still waits:
//   the question's `answer` is null, and inspectAgentRun(app, run.id).status is "waiting_user"
await answerAgentRun(app, run.id, "a1", { toolUseId, text: "Left" }, { model });   // throws "that question or its target is no longer current"
await startAgentRun(app, { version: 1, requestId: "a2", layoutRef: layoutId, input: { conversationId, answer: { toolUseId, text: "Left" } } }, { model }); // throws "that question's target has changed"
```

Observed on `e90ab9e` (unmodified, extracted with `git archive`): before the edit `run waiting_user | question answer null`; after it `run waiting_user | question answer null (still offered)`; both calls above throw the messages quoted; a `startAgentRun` with a `message` instead returns `completed` and the old run becomes `completed`. On the A2 branch an undo and an apply of a proposal from another conversation leave the same state (checked with throwaway tests); the other paths that append a revision (`upgradeLayout` and the two backfills in `src/app`) go through the same `appendRevision` and the same head comparison, but I did not run them.

## Why A2 does not fix it

The orchestrator settled that this stage keeps both guards and does not loosen durable-run semantics. A2 instead closes the question at the one point it controls, the apply of an agent proposal of the conversation (`closeOpenQuestion`, `src/app/question-skip.ts`), and when such an apply lands while the turn is still running. It cannot see a change made by the editor, an undo or another conversation's apply.

## Options

1. Close it on any head change. Wherever a revision is appended to a layout, close every open question of conversations on that layout, with the Closed result the apply rule already stores ("The layout has changed since you asked ... ask again if it still matters") and the run completed. One rule for every way the head moves, and the card tells BK why. The cost is that a question he is thinking about disappears when something unrelated happens, and the append sits in the persistence layer, which cannot import `src/app`, so the hook has to be an app-level wrapper around the callers of `appendRevision` (`applyChange`, `applyOps` and `undo` in `changes.ts`, `upgradeLayout`, and the two backfills).
2. Allow the answer, with a note to the model. Drop the two guards for a question whose head moved and prefix the answer's result with a note that the layout changed after it was asked, so the model re-reads before it revises. The question stays answerable and nothing disappears. The cost is that D-411's guards were written to stop an answer being applied to a layout the question was not about; a revision built on a stale reading of the layout still has to pass the validator against the head (D-014), but the model is working from an answer to a question about keys that may have moved.

Option 1 keeps both guards and what they mean; option 2 keeps the answer BK was about to give. Whichever is chosen, `test/app/question-endings.test.ts` is where the editor-edit, undo and other-conversation cases belong.
