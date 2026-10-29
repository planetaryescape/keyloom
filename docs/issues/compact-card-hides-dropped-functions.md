# The compact proposal card doesn't say which functions a proposal drops

Status: fixed in `e4ca3f5` (PR 199), released in v0.59.0 (D-452). The compact card and the folded bar line now name each dropped function and its reason at rest (`src/web/chat/ProposalCard.tsx`), and `test/web/refine-cards.test.ts` renders a proposal that drops two functions and expects both. Raised by CodeRabbit on PR 193, 2026-10-28, and checked against origin/main `94f9f61`. It predates PR 193.

A `dropFunction` op lets a proposal give up a function on purpose ("you said you never use it"). The validator accepts it and records the function and the reason in `validation.diff.dropped` (`src/validation/result.ts`), with no error or warning. So `ProposalNotes` has nothing to show.

`ProposalMoves` (`src/web/chat/ProposalMoves.tsx`) is the only place that lists `diff.dropped`, and only the full card renders it. In `src/web/chat/ProposalCard.tsx` on main the `if (compact)` branch returns its own card before the full card's `<ProposalMoves>`. The compact card is the one the chat bar and the keyboards panel show. A person can therefore apply a proposal there without being told which function it removes, unless the agent happened to put it in the trade-offs (the Command–Shift demo's "F16 is gone" is the agent's words, not the validator's).

Fix: the compact card shows each dropped function and its reason, at rest or in a visible line, not only behind Details. A test should render a proposal whose diff drops a function and expect its name in the compact card.
