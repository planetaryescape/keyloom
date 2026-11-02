# Correct the three accepted recovery blockers

Correction source: `d0269994e2f812d9481282ed00b803ccff90432b`, tree `c7a7bee57c841e2a8fc48ab699d46569c8fc4959`, on reviewed candidate `b82dec6a57140b83af15606fda8b45665c2fe6fa` and main base `14312ecda7d960546474514121336a716e80e67d`. The following evidence-only commit changes no implementation. This is a corrected source candidate, not a shipped release or a new full-suite pass.

## What changed

- Answer-owned refusal recovery follows the actual question/request chain back to the original goal in both web and CLI. It keeps labelled refining answers, deduplicates saved revised-proposal lineage, and excludes later unrelated messages. App resolution remains read-only; web resolution remains transcript-owned. No wire or storage fields were added.
- Applied and superseded cards use saved validation. Their non-idempotent operations are not revalidated as a new attempt against the current head.
- Current proposed-card validation gates compact, folded-line and full Apply buttons, already-open native replacement confirmations, and their handlers. A known-invalid card still offers contextual recovery, but cannot request Apply. The server validator remains authoritative.

## Regression tests and checks

Four actual-domain regressions were first run against b82 and failed: answer-owned refusal, saved revised-proposal lineage, applied `addLayer` replay errors, and enabled Apply after real target-layer removal. After correction, the targeted run passed **108 tests / 421 assertions across 13 files**, including an additional two-answer chain, actual superseded history, valid common-path Apply, source-finding CLI, validator and no-replay tests. See [targeted output](targeted.log) and [check summary](checks.json).

Typecheck, dependency-cruiser and whitespace checks passed. The correction diff has zero anti-slop findings. React Doctor reports only the previously accepted empty-default-array warning at the unchanged ChatPanel signature (66/100, one warning); no new correction finding was reported. No default full-suite rerun was made in this round. The earlier local full-suite UF2 observer failure and its separate bounded diagnosis remain preserved. Fresh exact-final-head CI must supply the next full-suite gate.

## Actual question → answer → refusal → reload → recovery

```sh
bun test/web/proposal-recovery-corrections-server.ts <evidence-directory> app
bun test/web/proposal-recovery-corrections.browser.ts <evidence-directory> app
```

The real App and SQLite routes use a deterministic fake provider. The source request asks for F17 on an index finger. A real `ask_user` asks which hand; keyboard Enter chooses Left. The provider then attempts a missing-target `propose_changes`, which the real validator refuses without saving a proposal. An unrelated later request about colors is sent before reload.

After browser reload, Plan reconstructs the answer-owned refusal. The recovery request includes the original F17 goal and `Answer to “Which hand do you prefer?”: Left`, but not the later color request. Keyboard activation of Plan makes no POST; keyboard Send makes exactly one deliberate request. The replacement is validated, its preview leaves the persisted head unchanged, and explicit Apply changes the selected key to F17 while preserving its neighbor. The historical code-only target limitation remains visible and unchanged. See [journey receipt](correction-question-journey.json) and [the visible goal/answer](correction-request-with-lineage.png).

Separate source CLI human and JSON draft invocations retain that same root goal and answer. The serialized database SHA-256 is unchanged before/after both commands: [read-only receipt](correction-cli-read-only.json), [human draft](correction-cli-draft-table.txt), [JSON draft](correction-cli-draft-json.txt).

## Applied history and current-invalid confirmation

Stop the App fixture before starting the card fixture on the same assigned port:

```sh
bun test/web/proposal-recovery-corrections-server.ts <evidence-directory> cards
bun test/web/proposal-recovery-corrections.browser.ts <evidence-directory> cards
```

The card fixture uses actual persisted proposals, validated edits and saved revisions, not invented invalid cards. It renders the production ProposalCard in a minimal mounted React harness:

- A successful non-idempotent `addLayer` has no false replay error in compact/full history.
- A saved-valid proposal's target layer is actually removed through validated `applyOps`; compact/full Apply is disabled while recovery remains visible. The folded-line case is covered by SSR over the same domain condition.
- A valid imported-native replacement opens confirmation normally. A real conflicting edit advances its head to F20 while that same card remains mounted. Compact/full confirmation becomes disabled and cannot call the Apply handler. See [mounted receipt](correction-mounted-cards.json) and the two `confirmation-disabled` captures.

The isolated card captures demonstrate state and controls, not the full App's styling. Two rejected fixture setups were corrected before this pass: replacing the unique layer-entry native removed reachability; replacing only one copy of a native correctly counted it as preserved elsewhere. Neither setup failure was counted as a product defect or a passed proof.

## Preserved behavior and review

The original committed two-journey and mounted lifecycle runner was also rerun against the corrected source. It passed no-POST planning, both real refusal/stale replacement journeys, preview/Apply, Home/config retention, occupancy, definite refusal, double activation, ambiguous acceptance without replay, old-completion ownership, active-work preservation, Stop and changed-head blocking. See [runner result](baseline-mounted.log), [persisted revisions](baseline-persisted-journeys.json) and [lifecycle receipt](baseline-lifecycle.json). No `useChat`, App draft seam, source-finding gate, transport, validator or flashing implementation changed in this round.

Inline TypeScript review checked narrowing at canonical question/result ownership, backward-only traversal, duplicate source IDs and handler gates. Simplification uses one `canApply` predicate and one `requestApply` handler rather than separate inconsistent checks. Test-quality review confirmed real domain transitions and explicit visible outcomes: removing lineage resolution or the current-validation gate reproduces the red failures; deleting the card renderer fails the history assertions too. The real two-answer and unrelated-message tests guard against resolving the newest global request.

Limits: browser proof is not native, installed-release or hardware proof. Keyboard activation was exercised for answer, Plan and Send, not the entire journey. No dedicated in-flight source-deletion check or new full-suite result is claimed. All fixtures/browser sessions were run-owned and stopped; warm source and dependencies are retained for coordinator review.
