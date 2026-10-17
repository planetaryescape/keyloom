# Moonlander default keymap (QMK)

`keymap.c` is copied unchanged from
https://github.com/zsa/qmk_firmware/blob/93b2b9ec3368f86c5eb5a2e3f934049f8daef885/keyboards/zsa/moonlander/keymaps/default/keymap.c
(the commit `zsa/moonlander` pins). It names its layers with `enum layers { BASE, SYMB, MDIA }` and uses them as `[BASE] = LAYOUT(...)`, `TG(SYMB)` and `LT(MDIA, KC_SCLN)`, as QMK's own default keymaps do.
QMK is GPL-2.0-or-later, which keyloom's AGPL-3.0-or-later can include; its licence is `LICENSE` here.
