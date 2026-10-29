# The CLI has no view of the firmware settings

Status: fixed in `e894e6d` (PR 201) by `keyloom layout settings <layout>` (D-459; `src/app/firmware-settings.ts`, `test/cli/layout-settings.test.ts`). Found in fix/five-kanata, 2026-10-28, while checking the Caps Word settings fix against D-030 (every feature is in the CLI). Base origin/main `45c67e9`.

The Settings page (`src/web/settings/SettingsPane.tsx`) shows each firmware option with its value, default and forced state. No CLI command shows that page's view.

Evidence, from a scratch Moonlander layout with a `CW_TOGG` key and no stored settings:

- `keyloom --format table layout show <layout>` prints the grid only (25 lines). Nothing about settings, Caps Word or combos.
- `keyloom --format json layout show <layout>` prints `layout.settings`, which holds only what the layout stores. With a Caps Word key and nothing stored it is `[]`, so the forced "on" isn't visible there.
- `keyloom change check <layout> --ops` accepts a `setFirmwareSetting` op, so a value can be written from the CLI, but nothing lists the current values.
- `keyloom version list` and `change show` describe changes to settings, not the values in force.

Gap: a person can change every option from the CLI only by writing JSON ops, and can't read what the firmware will get without the web page. D-030 says every feature is in the CLI.

Out of scope for fix/five-kanata. The fix needs a decision on the command shape (for example a `layout settings` command that prints `currentValue` and `forcedOn` for each option), which is a new CLI feature.

## Evidence the fix works

On a scratch Moonlander import (`--data-dir` under the scratchpad), after `change apply` of a `CW_TOGG` native on position 45 with nothing stored for Caps Word, `keyloom --format table layout settings scratch` printed:

```text
CAPS_WORD_ENABLE         Caps Word                on       off      -       forced: A Caps Word key on this layout turns it on, so it stays on while that key is there.
```

and `--format json` printed `"value": true, "default": false, "stored": false, "forced_by": "A Caps Word key on this layout turns it on, …"`, the view `layout show --format json` could not give. A stored `TAPPING_TERM` of 170 printed as `170 ms  200 ms  stored`.
