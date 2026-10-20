# Blueprint audit closeout

Baseline: `020ee3054a55d5aa574ccc50f1f9b9b603bef8fe` (v0.43.1). Scope is the agreed 16 audit findings, not the deferred roadmap rungs.

| Finding | Result and evidence |
|---|---|
| Combo conflicts | `combo_conflict` refuses identical position sets on intersecting layer scopes; [tests](../../test/validation/combo-conflict.test.ts) |
| Firmware identifier clashes | ZMK warning shares naming rules with generation; [tests](../../test/validation/identifier-clash.test.ts) |
| Layout export | Versioned local JSON export and config/import round trip, historical revision selection, atomic replacement and malformed/wrong-board refusals; [CLI tests](../../test/cli/layout-export.test.ts) |
| CLI history/delete names | Documented actual `version list` / `config delete` rather than nonexistent aliases ([10](../blueprint/10-cli.md)) |
| CLI skill | [skills/keyloom/SKILL.md](../../skills/keyloom/SKILL.md) includes scratch-data and hardware safety rules |
| Doctor credentials | Bounded, read-only model lookup; rejected credentials fail, absent/inconclusive credentials warn; [tests](../../test/app/doctor-credential.test.ts) |
| Apply logging | Committed IDs and validation codes, no user reason/ops; rollback produces no success record; [tests](../../test/app/apply-logging.test.ts) |
| Two missing evals | Number-layer and F/J home-row-mod scenarios plus adversarial offline oracle tests. Correction to the earlier audit: the original table had six scenarios, not eight. There are now eight scenario files, including cross-board and hostile-prompt additions |
| Eval command | `bun run evals` safely skips unless the explicit live gate and selected credential are present |
| CLI writes in an open editor | SQLite head watcher, same-connection writes, reconnect snapshots and stale-request guards; [tests](../../test/cli/data-version-watcher.test.ts) and [browser evidence](../screenshots/blueprint-audit/README.md) |
| Per-turn usage/cost | Reported, known-model estimated and unavailable states survive saved-history reads; partial provider prices are not reported as whole-turn charges; [tests](../../test/web/chat-usage.test.ts) |
| Board guidance | Moonlander and Glove80 board skills use the existing loader/prompt path |
| Validator table | Reconciled implemented errors/warnings, including dangling combo tap-dance references ([07](../blueprint/07-change-validation.md)) |
| QMK emulation wording | Corrected the stale “not available yet” text; the QMK emulator was already built |
| Logger wording | Custom synchronous writer, 10 MiB rotation/five files; pino claim superseded by D-417 |
| History recovery wording | Document restore/sync differs from exact old-artifact reflash; D-416 records the actual workflow and the retained CLI recovery path |

The inherited candidates also contained persistence, config/provider/review commands, board derivation and typing-lab fixes. Review corrected fabricated version-restore sync status, invalid macro-tap devicetree, partial tap-dance imports, malformed placement arguments, accidental config-setting loss, guessed credential-cache probing and incomplete cost totals before inclusion.

## Verification

- Combined `bun test`: **2,687 passed, 207 skipped, 0 failed**, 304 files, 153 seconds.
- Main and eval TypeScript checks passed. Dependency checks found no violations; dependency-cruiser warns that its transpiler API does not yet support TypeScript 7.
- `bun run evals`: **10 skipped, 0 failed**, eight files. Paid generations were not authorized or run; scenario definitions and offline predicates are not evidence of live-model quality.
- Compiled darwin-arm64 CLI round-trip, combo refusal, Apply log and open-editor refresh smoke passed against scratch data. [Desktop/phone screenshots](../screenshots/blueprint-audit/README.md) cover both themes.
- Gemini Argon through `agy` could not run because its quota was exhausted. The user explicitly waived that unavailable review on 2026-10-20 and authorized finishing merge/release. It is not recorded as a passing review.

No keyboard was flashed or remapped, and no real data directory was served. Hardware spikes, notarisation credentials, deferred live writes and the unbuilt app-wide agent rungs remain outside this closeout.
