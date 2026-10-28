# Settings shows Caps Word off while the firmware turns it on

Status: fixed in ae08799 (PR 194), released in v0.56.1 (Settings shows Caps Word on, with the line, and a staged off is no edit; the CLI has no settings view, tracked in `docs/issues/cli-has-no-settings-view.md`). Found in stage T (D-451), 2026-10-23, at `02e8c4f`.

A Caps Word key does nothing in QMK unless `CAPS_WORD_ENABLE` is compiled in, so the QMK generator turns it on when the layout holds a Caps Word key (`usesCapsWord` in `src/firmware/qmk/generate.ts`). The settings page reads the stored value, so with `CAPS_WORD_ENABLE: false` stored and a `CW_TOGG` key present, `currentValue()` returns false and the page shows it off, while the generated `rules.mk` ends with `CAPS_WORD_ENABLE = yes`.

The page should show the value the firmware gets, with a line saying a Caps Word key turned it on.

## Evidence (fix/five-kanata, base origin/main `45c67e9`)

`hasCapsWordKey` and `forcedOn` in `src/layout/firmware-options.ts` are the one source of the fact. The QMK generator (`src/firmware/qmk/generate.ts`) calls `hasCapsWordKey` instead of its own copy, so the rules.mk line and the page cannot drift. `currentValue` returns the forced value; `settingsChange` (`src/layout/settings-ops.ts`) drops an edit to a forced setting, so no off op is staged and the change summary cannot say "off". The row (`src/web/settings/SettingRow.tsx`) shows the value on, disables the switch, hides the reset link, and says "A Caps Word key on this layout turns it on, so it stays on while that key is there."

The UI was checked on a scratch dev editor (a Moonlander sample with a `CW_TOGG` key on the base layer and `CAPS_WORD_ENABLE` stored off). Chrome was driven over CDP, and the Caps Word row read `checked: true, disabled: true`, with the note and no reset link, in all four runs. Screenshots are in `docs/research/ui-audit/fix-five-kanata/`: `settings-caps-word-1440-dark.png`, `settings-caps-word-1440-light.png`, `settings-caps-word-390-light.png`, `settings-caps-word-390-dark.png`.

The CLI has no settings view. `keyloom layout show` as a table prints no settings, and `--format json` prints the stored `layout.settings` (empty for this layout, so it doesn't show the forced on). `keyloom change check` accepts `setFirmwareSetting CAPS_WORD_ENABLE false` on a layout with a Caps Word key, with no warning (`ok: true`, no errors, no warnings), so a lying off op can still be proposed through the CLI. Decided (orchestrator): leave it. The firmware gets Caps Word on and Settings says why, so nothing lies to BK, and no validator change. The missing CLI settings view is tracked in `docs/issues/cli-has-no-settings-view.md`.
