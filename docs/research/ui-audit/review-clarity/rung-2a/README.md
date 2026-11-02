# Rung 2a review-repair evidence

Captured against the local synthetic server on `127.0.0.1:4531` using an imported public test fixture, a scratch data directory assigned for this work, and a deterministic fake Anthropic client. No real account, keyboard, firmware, or paid model was used.

The browser journey was: open the config and its current one-finding review; open the prefilled, editable repair request; explicitly send it; receive a validated F17 proposal; preview the proposal on the keyboard without changing the head; explicitly apply it; and request a fresh review. The persisted SQLite evidence is in the assigned evidence directory, not this repository. It records one completed agent run, one applied change set, and a new review on the applied revision. The source finding changes from “2 keys do nothing” to “1 key does nothing”; the remaining key is not claimed as fixed.

Screenshots are synthetic and use no personal layout data:

- `1440-light-selected-finding.png`, `1440-light-request-final.png`: finding and final editable request before sending.
- `1440-light-proposal.png`: proposal shown in the chat.
- `1440-light-preview.png`: proposal card's read-only key preview; the SQLite head remained unchanged at this point.
- `1440-light-applied.png`: applied F17 binding and fresh-review-needed state.
- `1440-dark-request.png`, `390-light-request.png`, `390-dark-request.png`: request presentation across themes and a narrow viewport.
- `390-light-occupied-composer.png`: send disabled while the ordinary composer is occupied.

The app displayed a transient “Looking over your Moonlander” state while the second manual review completed; the persisted record confirms that the review was stored for the applied head and found one remaining unused key. No claim is made that the browser's transient panel had finished rendering that result in the captured post-apply screenshot.
