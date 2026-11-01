# Interpret the grounded-review reports

The eight timestamped `2026-11-01*-codex-grounded-*.json` files are original captured outputs, not final-release guarantees. They remain unchanged so the failures and earlier publication bugs can be inspected.

- In an abstention run, `preservesCustomMeaning: true` was the result of checking an empty proposal list. No candidate-preservation path was exercised. The meaningful observed outcome is that the model abstained and the saved head stayed unchanged. Likewise, an empty agent-item list does not exercise narrative publication. Future reports explicitly record these checks as `not-exercised`.
- The two successful missing-layer-route runs incorrectly listed the entire aggregate empty-keys finding in `fixes` after filling only one empty key. The final publication code distinguishes an associated finding from a fully resolved one. Partial repairs no longer claim to fix the whole aggregate; complete repairs still do.
- The original `0 firmware checks passed` sentence meant no activity tests had been selected. It did not mean that firmware checks ran and failed. Current publication says `not tested; no firmware checks were run`.

[`grounded-review-offline-republication.json`](grounded-review-offline-republication.json) republishes the captured operations through the current application gates and explanatory-text generator. Each entry names and hashes its original report. Abstention entries explicitly say the preservation path was not exercised; positive entries show corrected `fixes` and test-coverage wording.

Reproduce that source-only check with:

```sh
bun evals/replay-grounded-reports.ts
```

This uses a local scripted model, not Codex or a paid API. It does not select activities, replay firmware, read a device, apply a config, or spend another live evaluation. The eight-run authorization is exhausted. Original model behavior cannot be rerun without further approval.
