# The CLI has no view of the firmware settings

Status: open. Found in fix/five-kanata, 2026-10-28, while checking the Caps Word settings fix against D-030 (every feature is in the CLI). Base origin/main `45c67e9`.

The Settings page (`src/web/settings/SettingsPane.tsx`) shows each firmware option with its value, default and forced state. No CLI command shows that page's view.

Evidence, from a scratch Moonlander layout with a `CW_TOGG` key and no stored settings:

- `keyloom --format table layout show <layout>` prints the grid only (25 lines). Nothing about settings, Caps Word or combos.
- `keyloom --format json layout show <layout>` prints `layout.settings`, which holds only what the layout stores. With a Caps Word key and nothing stored it is `[]`, so the forced "on" isn't visible there.
- `keyloom change check <layout> --ops` accepts a `setFirmwareSetting` op, so a value can be written from the CLI, but nothing lists the current values.
- `keyloom version list` and `change show` describe changes to settings, not the values in force.

Gap: a person can change every option from the CLI only by writing JSON ops, and can't read what the firmware will get without the web page. D-030 says every feature is in the CLI.

Out of scope for fix/five-kanata. The fix needs a decision on the command shape (for example a `layout settings` command that prints `currentValue` and `forcedOn` for each option), which is a new CLI feature.
