# Rung 2a review-repair evidence

Captured against the mounted App and real local routes using the public synthetic Moonlander fixture, a scratch SQLite data directory, and a deterministic fake Anthropic client. No personal layout, account, hardware, firmware build, or paid model was used.

The source fixture has one actionable blank key at Layer 0 position 33 and an intentional F18 neighbor at position 36. The scoped request names the selected blank key. The fake agent reads the current review, proposes F17 at position 33, and the user explicitly applies it. The preview leaves Undo disabled and preserves F18. Apply changes only the selected key. The subsequent current review records the selected check finding as fixed and contains no current findings; the remaining blank key is not claimed fixed. `selected-finding-resolution.json` is the machine-readable API receipt. `lifecycle-proof.json` records the separate mounted lifecycle pass: no-POST planning, phone/long-request Send reachability, Home retention, composer refusal, explicit refusal recovery, double activation, uncertain accepted POST without replay, truthful dismissal, and the delayed-hide freshness gate.

Screenshots are synthetic:

- `1440-dark-selected-finding.png`, `1440-dark-request-final.png`: selected finding and editable request.
- `1440-dark-proposal.png`, `1440-dark-preview.png`, `1440-dark-applied.png`: validated proposal, proposed key on the board before Apply, and the applied F17 binding with F18 unchanged.
- `390-dark-request-final.png`, `390-dark-sent-no-replay.png`, `390-dark-hidden-finding-disabled.png`: narrow request scroll, sent request after remount, and Send disabled after dismissal.

Reproduce locally with `bun test/web/review-repair-server.ts <evidence-dir>` in one terminal, then `bun test/web/review-repair.browser.ts <evidence-dir>` and `bun test/web/review-repair-apply.browser.ts <evidence-dir>` in another. The runners use port 4531 and close their browser sessions in `finally`; stop the fixture server normally when finished.
