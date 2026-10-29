# One proposal, then refining questions: design note and comps (stage A2, round 1)

Written against origin/main `e2f7194` (v0.57.0 plus the calm cards, PR 193). Nothing in `src/` changed. BK's decisions that this follows: the agent builds the best proposal first and asks only to refine it (2026-10-22), the loop is one reusable piece for every agent task (2026-10-22), and D-020's "two or three concrete alternatives" is replaced, recorded as D-452 (2026-10-28). `D-452` is unused on main at `e2f7194` (D-451 and D-453 exist).

Comps: `comps.html` (open it; `?theme=light|dark&w=1440|390&open=1`), shot as `comps-<theme>-<width>.png`. "Before" panels are crops of the real-app screenshots in `../ui-audit/calm-cards/` (`after-proposal-*`, `after-question-*`), which are the app at `e2f7194`. The comp wording is illustrative; the model writes the real text.

## Round 2: what was built, and where it differs from this note

BK approved the comps ("Looks right, build it") and the defaults for the five questions below: a new request while a proposal is open sits beside it (the model declares `supersedes: null`); applying while a question is open closes it as "Skipped, you applied the proposal"; the prompt asks for at most three questions and the schema caps `of` at 5; "Question n of m" shows only when m is 2 or more; one live eval per provider, run by the orchestrator, not by the worker. The decision is D-452 in `../../blueprint/14-decision-log.md`.

Differences from round 1:

- `refines` was dropped, as recommended.
- The supersede link is `tradeoffs.supersedes` on the new row, not a column and not a migration: `tradeoffs` already carries `supersededDecisionIds`, so the key joins a validated JSON object that an older keyloom parses and ignores, and its installed binaries keep opening a data directory that holds revisions. A migration would have made them refuse it (D-455).
- A call with two or more `alternatives` is a tool error that says why, as recommended; one is read as a proposal.
- The Anthropic adapter runs a non-pausing call batched with the question before it stops (about twenty lines, `src/agent/anthropic-model.ts`), tested with a batched propose, ask and second ask.
- Three bugs found in round 1 were fixed: `cardOf` marked two options "Recommended"; a streamed card now marks the old one superseded in web state; the folded bar line and the board pin find the open proposal when the newest reply proposed nothing.
- Found in the real app and fixed: the question sat above the proposal it refines (it now sits under it), and the log left the final card under the fold when the model's closing line arrived after the proposal (the log now re-places a card it placed, until the person scrolls).
- The folded bar line also says "Drops F16", because it too offered Apply without naming what is lost.
- Applying closes the chat bar (existing behaviour), so "Skipped" is seen when the thread is opened again.

Evidence: screenshots of the real app (scripted model, scratch data, headless Chrome) are `after-first`, `after-revised`, `after-revised-superseded`, `after-final`, `after-quick` for light and dark at 1440 and 390, plus `after-skipped-light-1440.png`; `journey-transcript.md` is the chat text after each step and the decision applying wrote, from the scratch database. `bun scripts/refine-journey.ts` regenerates them. The comp screenshots (`comps-*.png`) are the round-1 design.

## Round 3: the verifier's findings

The cross-model verifier blocked `ec4ada9` on four findings and one should-fix, all accepted:

1. An answer with no revision was lost from the decision. Every answer is now a revision (the prompt no longer allows "the answer changes nothing"); source ids accumulate along the chain, and a revision also takes every message of BK's since the replaced proposal was saved, so an answer the model skipped still links.
2. Apply did not reliably skip a question asked in a later reply, and the skipped state turned into "answered in his own words" after the next message. Applying the newest agent proposal now stores a result for the open question in its transaction (`SKIPPED_ANSWER`), the card gets `skipped: true`, and the web reducer does the same at once.
3. A revision reached the board only when its reply was done. The board now takes the newest reply that holds an open proposal in any state, so it is pinned as it arrives and an interrupted reply keeps it.
4. The model schema allowed four options for a refining question. A single_choice question now has two or three; the pickers keep theirs; stored calls load through the lenient schema.
5. The live eval checked Command–Shift only in the final proposal and dropped `displacedShown`. Both are restored across every valid proposal in the chain.

## Round 4: the question's proposal is recorded, not inferred

Round 3 skipped the open question when the newest proposal was applied. The verifier showed that was wrong: a remembered-decision question asked before proposing (system.md, "Earlier decisions") would be consumed by applying an unrelated proposal, an apply between a proposal and its question left that question open and unanswerable, and reload showed the first `ask_user` call of a reply, not the one the turn paused on. The design now:

- The association is recorded when the question is stored: `questionRefines` in the pause's stored presentation (the last proposal saved earlier in the same turn; absent when none), shown on the card as `refines`. Applying that proposal skips that question; nothing else does. The web reducer uses the same field.
- A turn committed with its proposal already decided (applied while the turn ran) stores the question as skipped at once.
- Reload shows the question the turn paused on: the `ask_user` call with no error result.
- The eval's checks are in `evals/command-shift-checks.ts`, applied with `.every`, and a placement is judged by Command–Shift keys added, since the fixture's layout already satisfied the old whole-layout test.

## Round 5: no apply leaves a question the guards refuse, and a question refines only what came before it

The verifier blocked `e6ffc81` on two findings. Both reproduced on that commit before any change, with a throwaway test over the in-memory app and a scripted model.

1. Applying an unrelated proposal left the question open and unanswerable. P1 open, a later turn pauses on a remembered-decision question (it refines nothing), BK applies P1. The card still offered its options and the run stayed `waiting_user`. `answerAgentRun` refused with "that question or its target is no longer current" and `startAgentRun` with "that question's target has changed". Two guards do that: `src/app/agent-runs.ts` (`answerAgentRun`) and `src/app/conversations.ts` (`storeMessage`). Both come from `7a98f81` (durable runs, 2026-10-18, D-411), both are on main at `e90ab9e` (`conversations.ts:226`, `agent-runs.ts:148`), and both refuse an answer once the layout head has moved since the run paused. Round 4 stopped an unrelated apply from consuming the question, but every apply moves the head.
2. A proposal saved after the question became its association. P1 saved, then one reply `[ask_user(Q), propose_changes(P2, supersedes: null)]`: Q was recorded as refining P2, because the association took the last proposal of the whole turn and the Anthropic adapter runs the calls that follow the question. Applying P2 then skipped Q.

### Rule 1: applying any agent proposal of a conversation closes its open question

Both guards stay as they are; durable-run semantics are not loosened in this stage. Instead no apply can leave a question behind for them to refuse. `applyChange` calls `closeOpenQuestion` (`src/app/question-skip.ts`) inside its transaction. For an agent proposal in a conversation with an open question it stores a result for that question, resolves the presented question, and completes the run that paused on it, so nothing waits on an answer that cannot be accepted:

| Applied | Result stored for the question | Card |
|---|---|---|
| The proposal the question refines (its recorded `questionRefines`) | `BK applied the proposal without answering.` | Skipped, you applied the proposal |
| Any other agent proposal of the conversation | `BK applied another proposal ("<title>") without answering. The layout has changed since you asked, so this question is closed; ask again if it still matters.` | Closed, you applied another proposal |

The marker for Closed is the result's fixed opening words, read by `isClosedAnswer`, the way Skipped is read from its fixed text. It travels through `cardOf` as `closed: true`, through the API schema, and into the reducer, so a reload, a later message and the live card say the same thing, and the work row stops reading "Needs your answer" (the stored presentation is resolved to `completed`; the reducer overrides the stale one it holds until the next snapshot). The model reads the result in its next request.

The same rule has to hold when the apply comes while the turn is still running, before the question is stored. A turn that commits a question now compares the conversation's applied agent proposals with those applied when the turn started. If any became applied meanwhile, the question is stored with its result at once: Skipped when one of them is the proposal it refines, otherwise Closed. Round 4 did this only for the proposal the question refines, so an unrelated apply during the turn still produced the unanswerable state. A refined proposal that was only rejected, or revised by a call in the same reply, no longer counts as decided: nothing moved the head, so the question stays open and answerable, and the model is not told that BK applied something he did not.

Not covered, by decision: the head moving by other means while a question waits (an editor edit, an undo, an apply in another conversation; each reproduced). That leaves the same unanswerable state and already does on main. It is logged in `docs/issues/open-question-unanswerable-after-layout-change.md` with the two options (close it on any head change, or accept the answer with a note to the model). D-458 settled it afterwards with the second: both guards no longer compare the head, and the answer reaches the model behind a note.

### Where a question sits among the calls

The association is the last proposal saved before the pending `ask_user` call, in call order. Proposals from earlier replies of the turn count, and so do calls before the question in the paused reply. A proposal from a call after it never counts. `runAgentTurn` collects proposals in the order they are saved, so what it lacked was the question's place in that order. An adapter that knows where the question fell tells the turn when it reaches it (`ModelRequest.onPause`), and the turn keeps the proposals saved by then. A provider that does not say leaves the callback uncalled, and everything saved counts as before, which is the old behaviour.

| | Where call order is known | What the adapter does |
|---|---|---|
| Anthropic, OpenRouter | `message.content` is in the order the model wrote its blocks (OpenRouter serves the same Messages API, D-107). The adapter pauses on the first `ask_user` that passes the strict schema | It already ran the other calls of that reply after the pause, in content order (round 2, kept). It now walks the calls in content order and signals at the question's place, so a call before it runs first and a call after it runs second. Earlier replies of the turn were run by the SDK's tool runner before the next request, so they are before |
| Codex | Codex runs the loop and reaches keyloom's tools over the loopback MCP server, through its code mode (S20, finding 3). What was saved is decided by the tool server, which runs calls in the order the requests reach it. The first successful `ask_user` sets `paused`, and every call after it throws "keyloom is waiting for an answer" and saves nothing | Nothing can be saved after the question, so everything saved is before it and the adapter has nothing to signal: it takes the fallback above. A test sends a proposal after the question (its completion reported late, so the call certainly reaches the server while it is paused) and checks it is refused and never saved. The JSONL order only decides which steps are stored (steps after the question's completed item are dropped, as before) |

For Codex, what I did not check is the order Codex sends calls it holds together: `supports_parallel_tool_calls` is a per-server option in the installed codex-cli 0.165.0 (the key is in the binary) and `codexArgs` does not set it, and I did not run Codex. The association does not rest on it, because the tool server's order is the one that saves proposals. One thing I reasoned about and did not reproduce: the server sets `paused` one microtask after the question's work, so a call whose request was already queued could in principle run in that gap. It would still count as before the question, and nothing in the turn depends on it not happening.

### Every way a question can end

A question is open while its `ask_user` call has no result after it (`openQuestion`), its run is `waiting_user` and its presentation is `waiting_user`. These are the ways that ends or fails to. "Run" is the paused run's status afterwards.

| How it ends | Stored for the question | Card (live and after reload) | Work row | Run | In scope |
|---|---|---|---|---|---|
| BK answers by option or in the card | his text | his answer | completed | completed; the answer starts a run | yes |
| BK types a message instead | `BK did not pick an option; he wrote his own message instead.` | "Answered in your own words" live, the stored line after a reload | completed | completed | yes |
| BK applies the proposal it refines | the Skipped result | Skipped, you applied the proposal | completed | completed | yes |
| BK applies any other agent proposal of the conversation | the Closed result | Closed, you applied another proposal | completed | completed | yes |
| Either apply lands while the turn is still running | stored when the turn commits, as above | as above | completed | `completed` at commit, never `waiting_user` | yes |
| BK rejects the proposal it refines, or a call in the same reply revises it | nothing | stays open, answerable | Needs your answer | `waiting_user` | yes, unchanged: the head did not move |
| The head moves by other means (editor edit, undo, apply in another conversation, a change while the turn is working) | nothing; BK's answer is stored behind a note that the layout changed (D-458) | stays open and answerable; once answered it shows his words, not the note | Needs your answer | `waiting_user`, then `completed` by the answer | yes, fixed by D-458 |
| A call beside the question, or one before it, reaches the turn's 64-call activity limit | the question; the refused call has an error result and was not run | open, answerable | Needs your answer | `waiting_user` | yes, fixed in round 6 |
| A call beside the question throws | the question; that call has an error result | open, answerable | Needs your answer | `waiting_user` | yes, unchanged |
| Stop while the calls beside the question run | the question; each call not yet run has an error result ("The operation was aborted.") and saved nothing | open, answerable | Needs your answer | `waiting_user`, stop recorded | yes, unchanged |
| Stop before the question is reached | no question | none | stopped | `cancelled` | yes |
| Stop as the question arrives | the question, open | open, answerable | Needs your answer | `waiting_user` with the stop recorded | yes, unchanged |
| The turn fails | no question | none | failed | `failed` | yes |

Each in-scope row has a test: `test/app/question-endings.test.ts` (through `startAgentRun` and `answerAgentRun`, which `sendMessage` does not use and which carry the run row: its status and the head it was accepted at), `test/agent/turns.test.ts` (the activity limit), `test/agent/question-order.test.ts` (Anthropic, OpenRouter, Codex and the `onPause` contract) and `test/web/refine-cards.test.ts` (the card, the reducer, the work row). The real app shows the Closed card in `after-closed-light-1440.png` (`bun scripts/refine-journey.ts`, which now also runs `scripts/dev-command-shift.ts close`); `journey-transcript.md` has the chat text.

### Where this differs from the brief

- The brief put the rule in the apply's transaction. The same rule also has to run when the turn commits, or an unrelated apply during the turn recreates the unanswerable state (a test fails without it).
- Round 4 treated a refined proposal that was rejected or superseded, not only applied, as decided, and stored "BK applied the proposal without answering" for it. That told the model something false and closed a question nothing had made unanswerable. Only an apply counts now.
- The brief asked that Codex be checked, not changed. It needs no signal, and a test says why.

## Round 6: a valid question ends the turn waiting, whatever a call beside it did

The round-4 verifier blocked `df98bd9` on one finding, reproduced here on that commit before any change. After 64 successful calls, a reply `[ask_user(valid question), list_layouts({})]` ran the second call (the adapter runs the calls beside a question), the observer refused it as the 65th and marked the turn limited, and `runAgentTurn` turned `awaiting_answer` into `iteration_limit` while keeping the question. The run was `failed`, its presentation `incomplete`, the question open, and `answerAgentRun` refused ("that question or its target is no longer current") though the layout never changed. The same on Anthropic and OpenRouter, which share the adapter.

The status line was the whole problem, not the sibling. `observer.limited()` outranked everything in `runAgentTurn`, so the same state is reachable with no call beside the question: the limit hit in an earlier reply (the 65th call refused, the model reads that and asks). I reproduced that on unmodified main at `e90ab9e`, where the line has been since `33d5f98`. A fix that only skipped the sibling would leave that route open. So the rule is now in one place: a valid pending question makes the turn `awaiting_answer`, and only a turn with no question can end as `iteration_limit`. Stored question and run status can no longer disagree, because the question exists exactly when that status does.

The sibling the verifier suggested not running is already not run: the observer refuses a call past 64 before it reaches the tool and the adapter gives it an error result, so every `tool_use` still has exactly one `tool_result`. Its text says the turn stopped, which is not quite true beside a question; the model reads it once, on the next turn, and the answer follows it. I left the observer's wording alone, since it is also what the model reads when there is no question.

I checked the other ways a call beside the question can end. One that throws is caught by the adapter into an error result. Stop while those calls run makes every call that has not started throw the abort, so it does not run (a proposal beside the question is not saved), and the question is stored with the run `waiting_user` and the stop recorded, as when Stop arrives at the question itself. Neither stranded anything, and both rows are in the table above with tests. Codex counts its calls against `maxIterations` (12 unless the caller raises it) and refuses a call after its question before counting it, so it rarely reaches the observer's 64; if it does, the same rule applies, because the status is decided in `runAgentTurn` for every provider.

## The turn sequence for "one key for Command–Shift", two questions

A turn is one request from BK to the next pause. A reply is one request to the model inside a turn.

| Turn | Reply | What the model does | What BK sees |
|---|---|---|---|
| 1 (BK: "I want one key for Command–Shift") | 1 | `get_layout`, `find_function`, any `record_priority` | working steps |
| | 2 | `propose_changes` (P1, no `supersedes`). Result: "saved as cs_1", validation | P1 on the board and as a card |
| | 3 | `ask_user` alone: step 1 of 2, considerations, options, recommended first | Question 1 of 2 under P1; turn ends `awaiting_answer` |
| 2 (BK answers) | 1 | `propose_changes` with `supersedes: cs_1` (P2). The decision draft's reason carries the answer | P1 folds to "Superseded by the revised proposal"; P2 is on the board |
| | 2 | `ask_user`: step 2 of 2 | Question 2 of 2 under P2 |
| 3 (BK answers) | 1 | `propose_changes` with `supersedes: cs_2` (P3), then a one-line text | P2 folds; P3 is the card with Apply |

Every answer gets a revision, with the same ops when it only confirms the proposal (round 3; round 1 said an answer that changes nothing makes no call, which loses it from the decision). The proposal and question in one turn are in separate replies on purpose (next section).

## Where the brief needs correcting

1. **"Propose, then ask, in the same turn" already works, and "no other tool in that reply" must stay.** On Anthropic and OpenRouter the adapter stops at the reply that contains a pausing call and gives every other call in that reply an error result "Not run: you asked BK a question in the same reply" (`src/agent/anthropic-model.ts#L131`, `#L143-L146`). A model that batches `propose_changes` and `ask_user` in one reply therefore proposes nothing, and BK sees a question over an empty board, which breaks the promise. Codex's tool server behaves by order: a tool called after the pausing call throws "keyloom is waiting for an answer" (`src/agent/codex-model.ts#L85`), one called before it runs. So the prompt must say "propose first, read the result, then ask in a reply of its own", and the rule as written needs no change. I recommend also making the Anthropic adapter run the non-pausing calls of a pausing reply before it stops (about 15 lines) so a batched reply degrades to the right outcome instead of a wrong one. Codex needs no change: it already runs calls before the pause.
2. **The stored question must be read with a looser schema than the one the model is held to.** A question is not a stored record of its own. It is the `ask_user` tool call inside the stored assistant message, re-parsed with `AskUserSchema.safeParse` every time the conversation loads (`src/app/conversations.ts#L376`), and when the turn ends (`src/agent/run-turn.ts#L154`). `openQuestion` finds the open call by id with no parse (`#L151-L157`). If the new fields are required on that one schema, every conversation stored before this stage with a question open fails the parse: the card disappears while the conversation still waits for an answer. So there are two schemas: `AskUserSchema` for the model (considerations and step required) and a read schema where every new field is optional.
3. **`refines` has no consumer in this flow.** The question and its proposal always share a turn, so placement already ties them. The one case it would help, a question in a turn that saved no proposal, is a case the flow forbids ("propose first"). I recommend leaving `refines` out until A4 has a use for it. If you keep it, make it display-only and never validated, and I will say so in the schema. This is the orchestrator's call; the design works either way, because the field is optional and additive.
4. **Reusing `proposalGroup` for revisions looks free and is wrong.** `markApplied` supersedes every other `proposed` member of the group (`src/persistence/change-sets.ts#L124-L129`), `groupProposals` merges consecutive same-group cards into one tab row (`src/web/chat/compare.ts#L9-L20`), and `superseded` today means "a sibling was applied". A revision chain in one group would show tabs, and a stored group could not tell "replaced by a revision" from "set aside by an apply". Revisions get a fresh group of one and an explicit link (below).
5. **The decision's `sourceMessageIds` is only the last answer.** `createAgentPorts(app, layoutId, conversationId, [userMessage.id], ...)` (`src/app/conversations.ts#L265`) passes the message that started the current turn. For P3 that is BK's second answer, a tool-result-only message that the chat does not even display (`showConversation` skips messages with no text and no tool calls, `#L374`). The decision that Apply writes would link to the last answer and not to his request. The revision must inherit the superseded set's `sourceMessageIds` and add the current turn's. Priorities recorded in an answer turn have the same problem (observed, not changed).
6. **Prompt wording alone can't keep "only the newest can be applied" true.** If the model forgets `supersedes`, P1 stays `proposed` beside P2. The next section makes the model declare it.

## Tool contracts

### `propose_changes`

```
input = {
  title, ops, explanation, tradeoffs, decisionDraft,     // one proposal, the fields of today's alternative
  supersedes?: string | null                              // a change set id, or null
}
```

- **One proposal per call.** The array goes. Accepting a one-element `alternatives` array too is the recommendation, for one reason: the review run already calls it with one alternative, and its prompt says "propose the single best change ... not alternatives" (`src/agent/prompts/review.md#L16`, `src/app/review.ts#L181`), and 18 test files mention `alternatives`. Stored inputs are never re-parsed (history is replayed to the model, not to the tool), so no stored data needs migrating. The schema is a union of `{ alternatives: [one] }` and the flat shape; the tool description and prompt teach only the flat one; a call with two or more alternatives is a tool error that says "one proposal per call". The port keeps `propose(Proposal[])`, so `review.ts`, `observation.ts` and the receipts (`src/app/agent-ports.ts#L129`) change only by the extra option. Remove the union in a later stage once no caller sends it.
- **Declare, don't infer.** When this conversation has any `proposed` agent change set and `supersedes` is absent, the call saves nothing and returns "N proposals are open: <id, title>. Call again with supersedes: <id> if this replaces one, or supersedes: null if it stands beside it." The model decides, once, in a visible way. With nothing open the field can be left out. This is the one place I add a rule the brief did not state; it is what makes "only the newest can be applied" hold whatever the model does.
- **Supersede rules**, checked before validating the new proposal and returned as a readable tool error (never a throw out of the turn):
  1. The id exists, belongs to this conversation and this layout, and has status `proposed`. An applied, rejected or already superseded id is refused with its status and the list of open proposals. If BK applied it meanwhile, the message says to propose the revision as a new change with `supersedes: null`, against the head that now includes it.
  2. The new proposal must pass the validator against the head. If it does not, nothing is saved and nothing is superseded: the old one stays `proposed` and current (D-014). The result says so: "cs_1 is still the current proposal."
  3. The insert of the new set and the status change of the old one are one transaction (`proposeChange` is already in `transact`). Both happen or neither.
  4. The three-failed-attempts stop (`MAX_FAILED_PROPOSALS`) still counts invalid revisions.
  5. A stale or unknown id never crashes: `defineTool` turns a throw into an error result, and Codex's `callTool` does the same.
- The receipt for a replayed run (`effectReceipt`) is keyed by the input JSON, so the port must be called with `supersedes` inside the receipted input, or a replay with another target would return a stale result.

### `ask_user`

```
considerations: string[]   // 1 to 3 lines, each at most 100 characters: what matters for this choice
step: { n, of }            // integers, 1 <= n <= of <= 5
refines?: string           // see "Where the brief needs correcting" 3
```

Everything else is as today: the question (240), options (label 60, description 160, recommended flag, at most 10), the picker kinds, `allowOther`. `of` may change on a later question; the card shows the latest, and an answered question shows no count, so a changed `of` can't leave a wrong "1 of 2" behind.

- **Recommended first, whatever order the model sent.** Not by mutating the stored input (providers replay it exactly): `cardOf` (`src/app/conversations.ts#L123`) orders options at read time. The first option with `recommended: true` moves to the front and is the only one marked. With none marked, the first option is the recommendation. This also fixes today's `cardOf`, which marks option 1 recommended whenever it left the flag unset, even when option 2 is explicitly recommended (two "Recommended" marks). Answers go back by label or id, so order never matters to them. Number keys follow the displayed order.
- **Kicker only when `of` is at least 2.** A lone clarifying question (which keyboard?) shows "Question 1 of 1" as noise.
- **Schema strictness.** Required `considerations` and `step` break the tests that script `ask_user` with the old shape (15 test files mention `ask_user`, among them `test/agent/ask-user.test.ts`, `codex*.test.ts`, `activity.test.ts`, `test/web/chat-*.test.ts` and `test/helpers/fake-chat-backend.ts`); round 2 updates them. A call missing them is refused by the tool (the pause check uses the same schema, `anthropic-model.ts#L131`, `codex-model.ts#L181`) and the model sees the error and repeats the call.
- **The pause machinery is untouched** (D-382): one question ends the turn; the answer is the tool result; typing a message instead answers it with "BK did not pick an option".

### The answer revises

The prompt says: after an answer, call `propose_changes` with `supersedes` set to the proposal the question was about, with the decision draft's `reason` written from the answer in BK's own words ("You said your left hand stays free for the letter ..."); then ask the next question or stop. No decision is written per answer: decisions are written only on Apply (`remember` in `src/app/changes.ts`), so the final proposal's draft is the one that persists (D-022). My tests will prove the plumbing (the scripted model writes the reason; Apply stores it with the inherited `sourceMessageIds`). They can't prove the model writes a good reason; only a paid eval can, which I have not run.

## Stored shapes and how old conversations load

| Thing | Change | Old data |
|---|---|---|
| `ask_user` input (inside stored messages) | New fields; read through an all-optional schema | Loads as it did: no kicker, no considerations; recommended-first applies to it too |
| `QuestionCard` (API) | `considerations?`, `step?`, `refines?` (zod objects strip unknown keys, so an older client ignores them) | n/a |
| `change_sets.tradeoffs` JSON | One optional key `supersedes` on the new row; no migration | Absent on every existing row |
| `ProposalCard` (API) | `supersedes: string | null`, additive | Null |
| `propose_changes` stored inputs | Not re-parsed | `alternatives` calls stay in history unchanged |
| Alternatives groups | Unchanged | Tabs still render for a group of two or more |

On where the link lives (round 2 reverses my round-1 recommendation of a column): `tradeoffs` is a zod-validated JSON column (`TradeoffsSchema`, `src/persistence/change-sets.ts`) that already carries a link to other rows, `supersededDecisionIds`, written by `recordSupersededDecisionIds`. `supersedes` joins it as one more optional key, so there is no migration. The relation is read only in memory, from `listConversationChangeSets`, so nothing needs an index. A keyloom that predates it parses the row (zod objects ignore unknown keys) and shows the old set as `superseded` through the status column that already existed, so BK's installed 0.57 and 0.58 binaries keep opening a data directory that holds revisions. A column would instead make them refuse it (`SchemaTooNewError`, D-455). "Superseded by revision" is "status `superseded` and some card has `supersedes` equal to my id"; a stored sibling-superseded card keeps today's plain "Superseded".

Live updates: the `proposal` stream event carries the new card with `supersedes`; the web reducer marks that id `superseded` locally (today only apply updates statuses live, `transcript.ts#L253`). No new event type.

## How each provider pauses and resumes

| | Anthropic and OpenRouter (one adapter) | Codex |
|---|---|---|
| Propose then ask | Two replies in one turn. A batched reply loses the propose call today; round 2 runs it first (correction 1) | Codex runs its own loop; the tool server runs `propose_changes`, then `ask_user` marks the pause and the child is stopped at that call's completed item |
| After the question | Loop breaks at the reply; the call is stored with no result | Steps after the question are dropped; history is synthesised up to the open call |
| Resume | The answer is a `tool_result` in a new user message; the runner continues from history | The stored conversation is replayed as text (`transcriptPrompt`); the answer is rendered as a result |
| What the scripted tests use | `test/helpers/fake-anthropic.ts` | `test/helpers/fake-codex.ts`, as `codex-pause-order.test.ts` does |

Nothing in the adapters changes for the flow itself. The `supersedes` and declaration rules live in the tool and the port, which all three providers share. The Codex path is proved by a fake-Codex turn with a propose, then a question with the new shape, then the answer and a `supersedes` revision.

## Web

- The question card: kicker "Question n of m" (only when `of` >= 2), the question, the considerations as a short list, options with the recommended one first and marked, "Something else…" as today. Answered it stays the quiet line, without the count. See `comps.html` sections 1 and 2.
- The proposal card: the newest proposal is the card. A superseded one is one line, "Superseded by the revised proposal", with Details; the apply control is gone from it (the server already refuses applying a non-`proposed` set). Tabs show only when a group has two or more, so only stored conversations see them.
- The compact card names each dropped function and its reason at rest, from `validation.diff.dropped`. This folds in `docs/issues/compact-card-hides-dropped-functions.md`: see comps sections 3 and 4, and the test the issue asks for.
- The board pins the newest `proposed` set in the conversation. Today the pin effect looks only at the newest turn's proposals (`ChatPanel.tsx#L245-L252`), so an answer turn that proposes nothing would leave the pin on the old card, which is the right card, but the folded bar line would show no card at all (`lineProposal`, `#L346`). Round 2 takes the newest open proposal across the whole thread.
- `OpenProposals` keeps its tabs for stored groups and needs no change for revisions (only `proposed` sets are listed).

## Cost

Estimates from `docs/blueprint/12-cost-model.md` (a first turn about $0.12, a later cached turn about $0.08, output $20 per million tokens), not measurements. A request with nothing to ask drops from a proposal of up to three alternatives (about 2,000 to 4,000 output tokens) to one (about 1,000 to 1,500), so about $0.03 to $0.05 less. A task with two questions was two turns (ask, then three alternatives) and becomes three turns (propose and ask, revise and ask, revise): about $0.08 for the extra turn, partly offset by single proposals. Expect about $0.05 to $0.10 more for a two-question task and a little less for a quick one. Round 2 updates chapter 12 only if the logged turns say otherwise.

## Verification plan for round 2 (what I'd run, beyond the brief's list)

The brief's list stands. Additions: a test for a batched propose and ask reply (Anthropic path); the declare-or-supersede refusal; a stored conversation fixture with a question lacking the new fields, with an open question, loaded and answered; the revision inheriting `sourceMessageIds`; and `cardOf` ordering for old and new questions. One live eval per provider (not run; costs money) is the only proof that models follow the prompt: ask for BK's go-ahead before I run any.

## Questions for BK (the orchestrator asks one at a time)

1. **A new request while a proposal is still open.** After "Command–Shift on the F12 key" is waiting, he asks for something unrelated. Options: (a) the new proposal sits beside it and both can be applied, the model declaring that; (b) the new proposal replaces the old one. Recommendation: (a). Replacing silently throws away a proposal he may still want, and (a) keeps today's behaviour for unrelated requests.
2. **Applying while a question is open.** He applies the proposal on screen without answering. Options: (a) the open question closes as "Skipped, you applied the proposal" and the agent stops asking; (b) the question stays open and answerable. Recommendation: (a). Applying says the proposal is good enough, and a question about a proposal that is already applied has nothing left to refine.
3. **How many questions at most.** Options: (a) the prompt says at most three and the schema caps `of` at five; (b) a hard cap of three in the schema; (c) no cap beyond the prompt. Recommendation: (a). The prompt does the work and the schema is only a backstop against a runaway loop.
4. **The count on a single question.** Options: (a) show "Question n of m" only when m is at least 2; (b) always show it. Recommendation: (a), because "Question 1 of 1" reads as noise.
5. **Paid proof.** Options: (a) one live run per provider (about $0.30 each at the cost model's figures) before release, to see whether the models follow the prompt; (b) ship on the scripted tests alone. Recommendation: (a). The scripted tests prove the plumbing, not the model's behaviour.

## What I'd change in the brief

- Say "propose, then ask in a reply of its own", not "the question may follow `propose_changes` in the same turn": the second already holds, the first is how it can fail (correction 1).
- Require `considerations` and `step` on the model-facing schema only; the read schema must stay optional (correction 2). The brief's "old conversations must still load" is satisfied only that way.
- Drop `refines` from round 2 unless A4 names a consumer (correction 3).
- Add the declare-or-supersede rule and the inherited `sourceMessageIds` to the supersede rules (corrections 5 and 6). Reject the `proposalGroup` shortcut (correction 4).
- Look for a place for the link before adding a column (round 2 found one: `tradeoffs`, so there is no migration and no D-455 refusal).
- The "propose then ask" survey line (`system.md:12`) says "call no other tool in that reply". That stays, and the new text goes beside it in `:12`, `:14`, `:17` and `:82` as the brief lists. `system.md:110` (the tool line) and the `ask_user` and `propose_changes` descriptions also need the new wording; the brief's list omits the tool descriptions.
- The survey is accurate for the files it names; I checked `ask-user.ts`, `propose-changes.ts`, `Turns.tsx`, `ProposalCard.tsx`, `OpenProposals.tsx`, and the stored question path.

## Other things noticed, not changed

- `listConversationSummaries` labels a conversation with `proposed` sets as `{ kind: "options", count }`; with one proposal at a time the label reads "1 option". Worth a wording pass in round 2.
- A priority recorded in an answer turn gets the answer's message id as its source, and that message is not displayed (correction 5), so its chip may have no reply to sit under.
- The `OpenProposals` heading says "Two ways to put it on" for two proposals, which will be wrong for a copy with two revisions; copies do not use the loop (A3).
