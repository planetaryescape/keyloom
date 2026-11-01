# Grounded board review

Status: source, real-core and scratch compiled-CLI/UI verification recorded, 2026-11-01. Release and installed-desktop verification remain separate gates.

## Failure and reproduction

A saved automatic suggestion replaced a custom hold-tap with a plain momentary layer key. Its tap called an RGB-status macro, but the explanation described a sticky-layer action. The model-facing layout omitted the custom definitions. Ordinary validation accepted the removal because the proposal declared its own `dropFunction` reason. A source-preserving layer retarget also passed, so discarding the tap was unnecessary.

The public regression fixture is synthetic: `&mode 2 0` holds Factory and taps `indicator`, whose source calls `RGB_STATUS`. Its deliberately misleading label says `Sticky Magic`. Tests follow source rather than the label; no private config or typing recording is checked in.

## Source and offline gates

- `test/agent/behavior-facts.test.ts` checks custom dependency source, modeled macro/tap-dance actions, layer identities and the runtime limitation.
- `test/agent/retarget-layer-hold.test.ts` checks the narrow source edit and refusal to authorize unrelated function loss.
- `test/app/review-policy.test.ts` covers self-authorized function loss, per-key compound actions, pins, combo preservation, saved explanations and the publication boundary.
- `test/app/review-freshness.test.ts` covers constraint changes without a revision change, stale Apply and a superseded writer attempting to publish over its replacement.
- `test/app/review-engine.test.ts` covers reconnects, changed firmware identity, immediate withdrawal on disconnect and stable polling.
- `test/persistence/review-freshness-migration.test.ts` upgrades a synthetic version-15 database, withdraws legacy recommendations and preserves configs and unrelated editor proposals.

An intermediate full suite passed: 3,595 tests, 239 skipped, zero failures. TypeScript and dependency checks passed. Final candidate checks are still required after closeout edits.

## Real firmware checks

Run without hardware access:

```sh
agent-work run -- env KEYLOOM_DOCKER_TESTS=1 bun test \
  test/app/review-behavior.docker.test.ts \
  test/app/review-workload.docker.test.ts
```

Observed: four tests passed, zero failures, 18 assertions. Each production QMK/ZMK core passed the new tap, sustained hold/chord, rolling tap and release cases, and the existing baseline/candidate workload comparison. These are synthetic timings and configs, not observations of a person's typing. Native RGB effects, physical switches, wireless and USB behavior were not verified.

Review-fix verification reran those four tests successfully, then expanded affected-behavior acceptance to both tap-preferred and hold-on-interrupt settings: four real-core tests passed, zero failures, 12 assertions. This covers ZMK `hold-preferred` and QMK's global `HOLD_ON_OTHER_KEY_PRESS`. Unknown interrupt settings, changed actions without an oracle, and custom hold terms outside the bounded suite are recorded as unsupported rather than marked verified or incorrectly failed.

## Live recommendation quality

BK authorized at most eight Codex-subscription evaluations, synthetic layouts only. Eight runs were used, with no paid API key or device access. The scenarios are in `evals/scenarios/grounded-review.test.ts`:

| Case | Expected behavior | Observed |
|---|---|---|
| Misleading native legend | Preserve the custom action; do not infer a repair from its name | Passed, including final rerun |
| Unknown custom effect | Abstain rather than invent semantics | Passed |
| Pinned base keys | Leave the user's pinned keys unchanged | Passed |
| Unreachable layer with explicit saved intent | Add the requested route without changing the custom key | Passed, including final rerun |

The first positive fixture omitted user intent but expected a route anyway. Two runs abstained; the captured public transcript said there was no justified change beyond the source checks. The fixture was corrected to state the desired route as a saved priority. This was an oracle/fixture correction, not a prompt change to make the model guess intent. All eight original per-run JSON reports, including the two failed expectations, are committed under [`evals/reports/`](../../evals/reports/) with the prefix `2026-11-01` and `codex-grounded` in their filenames. Reports captured after the first batch also include public messages; the first four contain the checks, resulting review and proposals only. These are synthetic inputs and no additional live runs were made for review fixes.

These runs exercised Codex `gpt-6.1-sol`. They do not establish recommendation quality for every provider or config. The preservation and publication gates apply independently of the model.

## UI and remaining gates

Synthetic scratch UI captures at [1440×900](../screenshots/grounded-review/review-desktop.png) and [390×844](../screenshots/grounded-review/review-phone.png) show source-derived changes, visible unverified coverage, activity tests below findings and counts that include nested suggestions. The [stale phone state](../screenshots/grounded-review/stale-phone.png) hides old suggestions and offers one fresh-review action. That action was driven through to current source checks. No sync engine or real provider was started for these captures.

The scratch compiled CLI exposed the same effects and `not-tested` coverage, withheld stale recommendations, refused a withdrawn proposal's Apply and refreshed source checks with an explicitly unavailable provider. Config heads and revision documents stayed byte-identical. The normal data directory and installed standalone CLI were not used.

Pending closeout: final candidate checks, release-channel verification and installed desktop refresh. No real config was applied and no keyboard was flashed.
