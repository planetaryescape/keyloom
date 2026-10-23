# Settings shows Caps Word off while the firmware turns it on

Status: open. Found in stage T (D-451), 2026-10-23, at `02e8c4f`.

A Caps Word key does nothing in QMK unless `CAPS_WORD_ENABLE` is compiled in, so the QMK generator turns it on when the layout holds a Caps Word key (`usesCapsWord` in `src/firmware/qmk/generate.ts`). The settings page reads the stored value, so with `CAPS_WORD_ENABLE: false` stored and a `CW_TOGG` key present, `currentValue()` returns false and the page shows it off, while the generated `rules.mk` ends with `CAPS_WORD_ENABLE = yes`.

The page should show the value the firmware gets, with a line saying a Caps Word key turned it on.
