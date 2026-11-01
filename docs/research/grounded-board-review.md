# Grounded board review

Status: released and desktop-installed in [v0.68.1](https://github.com/planetaryescape/keyloom/releases/tag/v0.68.1), 2026-11-01. Published CLI, desktop sidecar and installed-bundle journeys passed using synthetic scratch data. No keyboard was accessed or flashed; hardware acceptance is not claimed.

## Failure and reproduction

A saved automatic suggestion replaced a custom hold-tap with a plain momentary layer key. Its tap called an RGB-status macro, but the explanation described a sticky-layer action. The model-facing layout omitted the custom definitions. Ordinary validation accepted the removal because the proposal declared its own `dropFunction` reason. A source-preserving layer retarget also passed, so discarding the tap was unnecessary.

The public regression fixture is synthetic: `&mode 2 0` holds Factory and taps `indicator`, whose source calls `RGB_STATUS`. Its deliberately misleading label says `Sticky Magic`. Tests follow source rather than the label; no private config or typing recording is checked in.

## Source and offline gates

- `test/agent/behavior-facts.test.ts` checks custom dependency source, modeled macro/tap-dance actions, layer identities and the runtime limitation.
- `test/agent/retarget-layer-hold.test.ts` checks the narrow source edit and refusal to authorize unrelated function loss.
- `test/app/review-policy.test.ts` and `test/validation/review-policy.test.ts` cover self-authorized function loss, per-key compound actions, pins, combo dependencies, generated explanations and complete versus partial fixes.
- `test/app/review-freshness.test.ts` covers constraints without a revision change, stale Apply, stale-writer publication/events, outcome-question bookkeeping, external SQLite writes and normal config deletion.
- `test/app/review-engine.test.ts` covers reconnects, persisted firmware identity across restarts, active-config switches, immediate withdrawal on disconnect, duplicate-call cancellation and stable polling.
- `test/persistence/review-freshness-migration.test.ts` upgrades a synthetic version-15 database, withdraws published and unpublished legacy recommendations, and preserves configs and unrelated chat/editor proposals.

The final implementation head, [`08c6afab`](https://github.com/planetaryescape/keyloom/commit/08c6afab53f17847a612ae30ca07e6040c8d01a6), passed 3,626 local tests with 243 skipped and zero failures. Root and eval TypeScript checks passed. Both [push CI](https://github.com/planetaryescape/keyloom/actions/runs/41358153296) and [PR CI](https://github.com/planetaryescape/keyloom/actions/runs/41358157256) passed every job, including all four native-helper platforms, boards and desktop. Dependency rules passed, with dependency-cruiser's existing warning that its TypeScript 7 transpiler support is incomplete.

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

Read the [report interpretation and corrections](../../evals/reports/grounded-review-2026-11-01-notes.md) alongside the original artifacts. Abstention does not exercise proposal-preservation or narrative-publication paths. An offline republication of captured operations records corrected aggregate-finding links and explicit `not tested` wording without making new model calls or rewriting the historical reports.

## UI and published-release verification

Synthetic scratch UI captures at [1440×900](../screenshots/grounded-review/review-desktop.png) and [390×844](../screenshots/grounded-review/review-phone.png) show source-derived changes, visible unverified coverage, activity tests below findings and counts that include nested suggestions. The [stale phone state](../screenshots/grounded-review/stale-phone.png) hides old suggestions and offers one fresh-review action. That action was driven through to current source checks. No sync engine or real provider was started for these captures.

The scratch compiled CLI exposed the same effects and `not-tested` coverage, withheld stale recommendations, refused a withdrawn proposal's Apply and refreshed source checks with an explicitly unavailable provider. Config heads and revision documents stayed byte-identical. The normal data directory and installed standalone CLI were not used.

Release PR [#228](https://github.com/planetaryescape/keyloom/pull/228) passed dispatched CI on its exact final head, `61f40ccb`. [Release run 41360226065](https://github.com/planetaryescape/keyloom/actions/runs/41360226065) built all four CLI/native-helper targets and the signed desktop bundle successfully. The release commit is `8b802d4aa1bee9068512c66fcc8c63f211b56e28` and contains the verified implementation head.

The tagged installer installed the published Apple Silicon CLI into a scratch prefix and verified `SHA256SUMS`. The desktop ZIP checksum, bundle identifier/version, Developer ID team and Gatekeeper notarization assessment also passed. A local scripted Codex executable drove the actual MCP tool transport through each of the published CLI, downloaded desktop sidecar and final installed desktop sidecar:

- custom tap/hold definitions and the RGB-status dependency were exposed;
- the destructive patch was rejected, while the complete source-preserving retarget was saved;
- the app replaced unsupported model claims with source-derived effects and explicit `not tested` coverage;
- a changed constraint made the suggestion stale and direct Apply was refused;
- an explicitly unavailable-provider refresh restored current source checks;
- scratch config heads and documents stayed unchanged.

These were offline scripted journeys, not additional live-model evaluations. The [portable verification receipt](grounded-review-release-v0.68.1.json) records the release, checksums and outcomes. Recheck the published CLI version without touching normal data:

```sh
scratch="$(mktemp -d)"
KEYLOOM_INSTALL_DIR="$scratch/bin" sh install.sh --version v0.68.1
"$scratch/bin/keyloom" --version
# 0.68.1
```

After the user quit normally, the installed desktop bundle was replaced with the verified v0.68.1 bundle. The previous v0.68.0 bundle was preserved as a backup, the installed file manifest matched the downloaded source, and signature/notarization/version checks passed again. The GUI was left closed: no real-data server, automatic sync, provider call or keyboard interaction was started for installation. The normal standalone CLI and real configs were not changed.

Remaining limits are deliberate: observed device markers are not a full firmware readback, finite core checks are not all possible timing sequences, and no result measures human typing speed or comfort. No real config was applied and no keyboard was flashed.
