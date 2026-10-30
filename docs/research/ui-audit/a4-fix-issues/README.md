# The review panel offers one change that answers what it found

Checked source: `db5889b4d44ff7d77f289e10bc5f0fe31fbec4be`, tree `49cc02f9ac181835081c98e75e643cf920d0c49e`, the A4 candidate on `93c23ca` (v0.61.0), on 2026-10-30. The app ran from that source with its real routes and SQLite. The data directory was a scratch copy: the Moonlander fixture with two base keys set free, a stored review of that head whose checks found them (`check:keys_do_nothing`), and a provider configured and reported ready. No model request was made and no provider was called; the page was read, the marker was opened, and the button was focused, never pressed.

Headless Chrome was driven over its own DevTools port from `a4-shots.ts`, which is kept beside this run's ledger rather than in the repository. Chrome used its own profile and debugging port, so it could not reach another browser or a running keyloom.

## What the check showed

- The marker reads `1 hint` and the panel lists it in words: "2 keys do nothing on Layer 0. 2 on the home row. Pressing them types nothing."
- **Fix issues** sits in the panel's footer as the primary action, beside the checks summary. It is enabled: the review has a visible hint a change can fix, and the provider is ready.
- Keyboard-only navigation reached it: focus the last action in the list (`Hide`) and one Tab lands on **Fix issues**. It takes focus and carries an accessible name from its text.
- Before the provider status arrived, the same button rendered disabled with the reason "Set up a model to fix the issues" in its title. That is the state a reader sees with no model.

## Both themes fit desktop and phone viewports

| Viewport in CSS pixels | Theme | Evidence |
|---|---|---|
| 1440 × 900 | Light | [Review panel with the fix offer](review-fix-light-1440x900.png) |
| 1440 × 900 | Dark | [Review panel with the fix offer](review-fix-dark-1440x900.png) |
| 390 × 844 | Light | [Review panel sheet with the fix offer](review-fix-light-390x844.png) |
| 390 × 844 | Dark | [Review panel sheet with the fix offer](review-fix-dark-390x844.png) |

Captures are at device pixel ratio 1. On the desktop the panel keeps its existing column and the board stays visible beside it; the footer row holds the summary and the one action without crowding. On the phone the review is the existing sheet and the action stays on its footer below the finding. Legends, the finding's caps and the checks summary remain readable in both themes. This review used [the design concept](../../../blueprint/23-design-concept.md) and the UI/UX principles referenced by [the screenshot gate](../../../blueprint/18-visual-design.md#how-a-rung-proves-it-looks-good).

## What this does not prove

The browser check stops at the offer. The click that starts the run, the agent reading the review with `get_review`, the question and the Apply are proven through the CLI journey on the same source (`smoke-A4.ts`: a loopback provider, one proposal, one question, an answer that supersedes it, Apply recording the reason and the request, and a second request starting a fresh run). The composed screen path is covered by component and one-shot tests, not by a page click. Comfort, firmware and a published binary are outside this check.

To repeat it, seed a scratch data directory with a reviewed head, serve it from that source with stubs for builds and flashing, and drive headless Chrome to open the marker and capture the panel at the two widths and themes.
