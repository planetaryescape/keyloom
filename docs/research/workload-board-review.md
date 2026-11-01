# Workload-backed board review

## Scope

[D-473](../blueprint/14-decision-log.md#d-473-let-people-choose-activity-tests-during-setup-and-independently-measure-automatic-review-suggestions-extends-d-340-and-d-470-replaces-d-470s-board-review-integration-deferral-2026-11-01-bk-do-it) connects the existing workload evaluator to automatic review. This is source-candidate evidence against `a8b9fe998427fd54faf9782256dfc94fcc39ae00` (v0.67.0), not a claim that the integration is in that release.

Select activities during import, during a new-board copy, or in the review panel. The same choice is available through:

```sh
keyloom import --board zsa/moonlander --activities prose,shortcuts layout.zip
keyloom keyboard put my-layout --on moergo/glove80 --activities prose
keyloom review my-layout --run --activities prose,shortcuts
keyloom review my-layout --json
keyloom review my-layout --run --activities none
```

The first two commands remember the profile; they do not run a model or firmware test. The review command can do both. Workload tests do not apply a change or access a device. Suggestions still require the user's model provider; baseline measurement does not.

## Behavioral checks

Tests in `test/app/review-workloads.test.ts`, `test/app/workload.test.ts`, `test/cli/review-workloads.test.ts`, `test/persistence/review-workloads.test.ts`, `test/server/review-routes.test.ts`, `test/server/editor-routes.test.ts`, `test/app/keyboard-put-atomic.test.ts` and `test/web/review-workloads.test.tsx` cover:

- No selected profile means no replay and no assumed activity. Profile IDs reject unknowns, duplicates and explicit null at the HTTP boundary.
- Baseline counts reach the model before it proposes. Sample text, event sequences and HID reports do not enter the request. Counts include layer/modifier entries and at most six busy physical positions.
- The candidate is the saved proposal's actual patch. Baseline reuse refuses changed snapshot, board, suite or evaluator identities. Every selected task remains protected.
- A fake model's fabricated performance claim cannot override incomplete, warning-tainted or regressing evidence. The app generates the measured claim.
- Pin-breaking proposals are withdrawn before candidate replay. At most two visible suggestions are tested; surplus proposals are withdrawn rather than shown without tests.
- Head changes and cancellation prevent old suggestions from being published. A fresh look withdraws old suggestions before measuring a different profile. Ctrl-C returns exit 7 and removes its signal listeners.
- Profiles persist across a config's revisions, while each revision gets its own measurement. A new-board copy waits for its pending mapping to be applied rather than automatically reviewing the temporary blank.
- Migration 15 preserves schema-14 layouts and starts with no assumed profiles. Profile/evidence rows stay scoped and cascade with their owner. Import plus profile creation is atomic.

The tests use independently specified HID reports where firmware is injected. They do not establish actual firmware behavior on their own.

## Real firmware-core checks

Run the gated integration regressions from the checkout:

```sh
agent-work run -- env KEYLOOM_DOCKER_TESTS=qmk bun test test/app/review-workload.docker.test.ts
agent-work run -- env KEYLOOM_DOCKER_TESTS=zmk bun test test/app/review-workload.docker.test.ts
```

Each command passed its real-core case with six assertions; the other firmware's case was skipped. QMK took 23.43 seconds and ZMK 13.41 seconds in this run. These are build/replay wall times, not predicted typing times.

A run-owned scratch harness exercised `createReview` → baseline → scripted provider proposal → independent comparison → stored review, without injecting replay results. The same original synthetic layout was padded for the Moonlander and Glove80. Its prose letters were direct except E, which needed a momentary layer. The candidate duplicated E onto an empty key without displacing another function.

| Check | Observed result |
|---|---|
| Moonlander / real QMK core | Writing sample verified; 22 → 21 keydowns, peak 2 → 1 keys; `verified-improvement` |
| Glove80 / real ZMK core | Same result through ZMK, independently verified |
| Persistence | The stored layout document and head stayed identical in both runs; the candidate remained proposed |
| Provider | Three scripted SDK requests per run; no paid model calls |

Both commands ran through `agent-work run --`. Receipts are retained under the run-owned `.orchestrate/keyloom-workload-review/` directory (`qmk-final/real-core-review.json`, `zmk-final/real-core-review.json` and their logs). These are firmware-core simulations, not physical keyboard, scan/debounce, USB or human-performance observations.

## Compiled CLI check

A source-compiled CLI was installed into the run-owned directory, not over the normal installation. In a fresh scratch database it:

1. imported the synthetic portable layout with `--activities prose`;
2. ran `review --run --provider anthropic` with the Anthropic credential removed, preventing paid calls;
3. retained a verified 22-keydown QMK baseline while reporting the model unavailable;
4. returned byte-identical JSON when the saved review was read again;
5. disabled the tests with `--activities none`, removing old evidence without changing the layout document or head.

The receipt is `compiled-final/receipt.json` in the run-owned directory. This checks the compiled candidate, not a published binary containing D-473. The package version remains release-please's v0.67.0 until release preparation.

## UI checks and limits

The [UI evidence](ui-audit/workload-review/README.md) covers import, new-board copying and review results in both themes at desktop and phone sizes. Browser checks used scratch configs and synthetic device frames. Build/flash/use routes were disabled; no sync engine was started. The new-board choice survived **Make**, and selecting Writing before a real fixture upload opened the imported config's review with that profile selected.

## Local validation closeout

| Check | Result |
|---|---|
| `bun test` on the frozen production candidate | 3,573 passed, 233 skipped, zero failures; 3,806 tests across 386 files, 250.68 seconds |
| Added gated review regressions | QMK and ZMK passed separately as recorded above; these two gated cases were added after the full suite enumerated its files |
| `bun run typecheck` | Passed, including the gated regression file |
| `bun run depcruise` | Passed; the repository's existing TypeScript-7 parser warning remains |
| Compiled scratch CLI | Passed; profile retained at import, real baseline without a provider, byte-identical saved reads, disable and unchanged head |
| UI | Import/copy/review exercised; both themes at 1440×900 and 390×844; no horizontal page overflow |
| Scoped axe accessibility check | Zero violations and zero incomplete checks on Activity tests; native labels, keyboard Space and disclosure Enter also exercised |
| React Doctor | No UI findings after simplifying the result component; one deliberately sequential candidate-replay loop warning remains |
| `git diff --check` and staged equivalent | Passed |

The changed source/test content manifest is retained as `source-manifest.json` in the run-owned directory, SHA-256 `1da0b0abbffc0f74ef3db908c2f499c70a6247668389bd7c92250ce6403f7331`. It names the checked base and hashes each changed file, including the two gated cases. It is not a release checksum.

Running Docker candidates in parallel would defeat the review's resource bound, so the remaining React Doctor warning is not a requested change. The mechanical anti-slop scan also flags existing repository conventions: conditional omission for exact optional types, SQLite row assertions, closed enum dictionaries, an immediately parsed `unknown` boundary and Zod's `.shape` property. No compiler or lint configuration was relaxed to hide these.

Live-provider recommendation quality, representative activity frequencies, unsupported mechanisms/locales, Kanata replay and hardware acceptance remain unverified. The integration measures proposals; it does not make the model an optimizer or establish human speed or comfort.
