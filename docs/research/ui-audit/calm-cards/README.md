# Calmer result cards: before, inventory and comps

BK, 2026-10-28: "your cards in the agent are very wordy and overwhelming and kinda ugly". Before screenshots are the real app at 45c67e9 (scripted model, scratch data dir, Chrome 1440x900 dark and 390x844 light). The comps are `comps.html` (open it; `?theme=light|dark&w=1440|390&open=1`), shot in `comps-<theme>-<width>.png`. Nothing in `src/` changed.

## Before

- Proposal: `before-proposal-dark-1440.png`, `before-proposal-light-390.png`; activity and priorities: `before-proposal-*-activity.png`.
- Copy proposal (Moonlander onto Corne): `before-copy-dark-1440-review.png`, `-review-tall.png` (the whole panel), `before-copy-light-390-review*.png`.
- Made-config card: `before-copy-*-config.png`. Question card: `before-question-*.png`.

Scripts: `scripts/dev-command-shift.ts` (fixed), `scripts/dev-copy-layout.ts` (new; serves the config routes the card reads; `ask` as the 4th argument asks a question instead).

The Command–Shift proposals failed because `propose_changes` requires `decisionDraft` on every alternative (`src/agent/tools/propose-changes.ts#L12-L16`, added after the script was written), so zod rejected the input and nothing reached the validator. The ops were valid. The script now supplies a `decisionDraft` per alternative.

## Inventory

Source: UI = a component string; agent = text the model writes; server = text a use case builds. "Decision" is what requires it.

| Text or chrome | From | Decision | Verdict |
|---|---|---|---|
| Proposal title repeated as the first words of the explanation | ProposalCard.tsx#L153 | none | drop the repeat |
| Explanation (agent, up to a paragraph) | propose-changes.ts#L13-L14 | History reuses it | shorten to one sentence; the prompt asks for it |
| Key chips (compact) / "Changes" rows, "and N more" | ProposalCard.tsx#L155, #L215-L230 | 18 (changed keys shown) | number on the card; chips behind Details |
| "Moves" list | ProposalMoves.tsx#L22 | 07 diff.displaced, D-099 | behind Details |
| "Trade-off:" / Gains and Costs columns | ProposalCard.tsx#L165, #L236 | 03 "trade-offs explained" | costs as one line; gains behind Details |
| "keyloom will remember: ..." | ProposalCard.tsx#L166, #L247 | D-023 (08 decision memory) | behind Details |
| Option tabs, "Option N of M", "Show it on the board", "Show on keyboard" | ProposalCard.tsx#L202, OpenProposals.tsx#L43 | D-315 compare, D-336 pin | drop for a single proposal (A2); pin automatically |
| Yellow warning box per warning | Validation.tsx (shared) | 07 | one line with icon, no box; detail on tap |
| "Not this" / Apply with the return-key hint | ProposalCard.tsx#L100-L120 | D-315 | keep; Apply is the one primary |
| Panel header "Proposals, checked like any change. Pin one ... sibling is set aside." | OpenProposals.tsx#L31 | none | drop |
| Put proposal explanation, 150+ words | keyboard-put.ts#L123-L131 and put-plan.ts#L330-L331 (server) | D-404 unsupported features stay visible | numbers on the card, the list behind a disclosure |
| Put Gains (copy of the explanation) and "21 keys stay off: F1 ..., and more" | keyboard-put.ts#L138, #L154 (server) | D-404 | drop the duplicate; the list is the disclosure |
| Reply paragraphs before the config card | agent; D-384 says offer the choices in one line | D-384 | shorten to two sentences |
| Config card facts "Corne · 2 proposals waiting" and a button saying the same | config-card.ts#L33-L44 | D-450 lists name, board, source, count and actions | keep the data, drop the count (the button says it), "Back" as a text link |
| Question card accent border and wash, "Needs your answer" row | QuestionCard.tsx, AgentWorking.tsx#L14 | D-381 asked for the accent; 28 forbids coloured edges | neutral surface; add "Question 1 of 2" and a why line (A2) |
| "Remembered" label on chips | PriorityChips.tsx#L35-L37 | 08: one-click undo | icon instead of the word; chips and x stay |
| "Some working details were not retained ..." | AgentWorking.tsx#L46 | 28 (truncated runs must not look clean) | show only when something was actually dropped; it showed on a normal run here |
| "N completed steps", per-step "Completed 6 ms" | AgentWorking.tsx#L72, work-view.ts#L38-L48 | 28 says "Read 2 configs · checked 12 mappings · 8 s" | one folded line; rows and ms inside the fold |
| "Reply complete · some steps need attention" | AgentWorking.tsx#L15 | 28 (do not fold errors) | keep for real failures only |
| Footer "300 input · 150 output tokens / $0.0042 USD estimated" | TurnUsage.tsx#L24-L28 | 12-cost-model.md line 28 (a quiet footer; the reported-versus-estimated distinction) | see question 1 |
| "Earlier, about X" / "New messages are about ..." | CarriedThread.tsx#L20, #L39 | D-317 | out of scope; left alone |

## Questions for BK (decisions the comps touch)

1. Cost footer. 12-cost-model.md requires a footer with tokens and USD after every reply. The comp shows only "$0.0042", with tokens, the model and "estimated" on click. Recommendation: do it, and keep the reported-versus-estimated wording in the expanded text.
2. Question card colour. D-381 chose an accent border and wash; 28 forbids coloured edges. The comp follows 28. Recommendation: follow 28 and note it in the decision log when built.
3. Hiding the compare tabs for a single proposal (D-315) is A2's change; the comp assumes it. If A2 keeps two or three options, the tabs come back as one row above the card.
4. Warnings as one line instead of a box (07, Validation.tsx is shared with the editor): the comp assumes the chat uses the short form only. Recommendation: yes, and the full text stays one tap away.

## Observed, not changed

The activity row read "3 accepted · 2 saved proposals" for three alternatives, while the card offered three options (`before-proposal-dark-1440-activity.png`). I did not look into why.
