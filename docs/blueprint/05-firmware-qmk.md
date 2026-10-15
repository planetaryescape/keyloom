# 05: Firmware: QMK (Moonlander)

The ZSA Moonlander is BK's QMK board (D-027). This document covers importing its current layout from Oryx, generating QMK source, building it locally and flashing it. Every fact here is in [../research/qmk-and-moonlander.md](../research/qmk-and-moonlander.md), checked 2026-10-15. Pinned commits: `zsa/qmk_firmware` `93b2b9ec3368f86c5eb5a2e3f934049f8daef885` (branch `firmware25`), `zsa/zapp` `a1be75837323001ad1ae8e5787d88cd33f2ccc46` (v1.0.2), and mainline `qmk/qmk_firmware` `7a1bbf37c5c07da4ea0a162bb139083a46ef40a1` for documentation.

## There are two Moonlander revisions, and only ZSA's fork builds both

ZSA started shipping a revision B Moonlander in mid-December 2025. Rev A uses the stock STM32 DFU bootloader (`0483:DF11`, flashing at `0x08000000`, USB PID `0x1969` in normal mode). Rev B uses ZSA's own bootloader (`3297:2003`, flashing at `0x08002000`, PID `0x1972`). Mainline QMK has only rev A. A PR adding rev B was closed unmerged on 2026-06-22. ZSA's fork has `zsa/moonlander/reva` and `zsa/moonlander/revb`, and Oryx builds from it.

So keyloom builds QMK from ZSA's fork at a pinned `firmwareNN` commit (D-040). Mainline is rejected for v1 because it can't build rev B, and BK's board may be rev B (spike S1). The cost: Speculative Hold exists in mainline but not in `firmware25`, so keyloom can't offer it on the Moonlander. The validator rejects it with `firmware_unsupported` ([07](07-change-validation.md)).

The board definition has one board, `zsa/moonlander`, with two `revisions`. Each revision has its own QMK target, USB IDs and flashing notes. The revision is chosen at import. On macOS, keyloom detects it by reading the connected keyboard's USB PID from `system_profiler SPUSBDataType -json`, which gives `0x1969` for rev A or `0x1972` for rev B. If no keyboard is connected, it asks.

## Import reads the Oryx source download

BK's Moonlander layout lives in Oryx. Oryx's source download is a zip holding `config.h`, `keymap.c` and `rules.mk` in a `*_source/` folder, plus a prebuilt `.bin`. There is no `keymap.json`. keyloom imports that zip (D-041):

`keyloom import --board zsa/moonlander <oryx-source.zip | source-folder>`

BK downloads the zip from Oryx while logged in. A public layout can also be fetched from `https://oryx.zsa.io/source/<revision>`, but private layouts return 401, so the file path is the default. Oryx's GraphQL endpoint returns per-key JSON for public layouts. keyloom doesn't use it in v1: ZSA doesn't document it, introspection is off, and it doesn't serve private layouts. That's deferred, not rejected. A "pull from Oryx" convenience could use it later if spike S4 shows it's stable.

Parsing (`src/firmware/qmk/import.ts`):

1. Parse `keymap.c` with the tree-sitter C grammar through `web-tree-sitter` (WASM). It's the same parsing approach as ZMK's import ([06](06-firmware-zmk.md)), with one dependency for both. `qmk c2json` was considered and rejected. It reads only the `keymaps` array, it drops tap-dance and macro bodies (an Oryx file gave bare `TD(DANCE_0)` and `ST_MACRO_0`), and it's Python, which would add a runtime keyloom otherwise doesn't need.
2. Read each `LAYOUT…(...)` call in `keymaps[]` as a layer, in order. Map each argument:
   - `KC_*` → `key`. Modifier wrappers such as `LGUI(LSFT(KC_4))` → `key` with `mods`. `KC_LALT` and similar → `modifier`.
   - `MT(MOD_LGUI, KC_F)` and the `LGUI_T(KC_F)` aliases → `holdTap` with a `mods` hold. `LT(n, KC_X)` → `holdTap` with a layer hold.
   - `MO`, `TG`, `TO`, `OSL` → `layer` actions. `OSM(MOD_x)` → `native` for now; one-shot mods aren't modelled in v1.
   - `_______` and `KC_TRNS` → `transparent`. `XXXXXXX` and `KC_NO` → `none`.
   - `ST_MACRO_n`, with its body in `process_record_user` written as `SEND_STRING(SS_TAP(...) SS_DELAY(n) ...)`, → `Macro`, when the body matches Oryx's generated pattern. Otherwise it's `native` with the case kept as `Passthrough`.
   - `TD(DANCE_n)` → `native`, with the tap-dance code kept as `Passthrough`. Tap dance isn't in the IR in v1 (D-019 rejects the one use the session discussed).
3. Read `config.h` into `FirmwareSetting`s (`TAPPING_TERM`, `PERMISSIVE_HOLD`, `CHORDAL_HOLD`, `FLOW_TAP_TERM`, `QUICK_TAP_TERM` and the rest) and into a `home-row-mods` `HoldTapProfile`. Per-key tapping terms from `get_tapping_term` become further profiles.
4. Keep anything else (`rgb_matrix` code, `keyboard_post_init_user`, Oryx's `qmk_modules` hooks) as `Passthrough`.
5. Print the import report, as for ZMK.

What an Oryx export of BK's actual layout contains is spike S3. The parser is written against that file. A synthetic one isn't enough.

## Generation writes `keymap.c`, `config.h` and `rules.mk`

keyloom generates C, not `keymap.json` (D-042). QMK's JSON format can't express combo definitions or tap dance, and Oryx's export is already C. A JSON-plus-C hybrid (QMK supports one through `OTHER_KEYMAP_C`) would split one layout across two generated files for no gain.

`src/firmware/qmk/generate.ts` writes to `keyboards/zsa/moonlander/keymaps/keyloom/` in the build checkout:

- **`keymap.c`:**
  - `enum custom_keycodes` for macros
  - `keymaps[]` with one `LAYOUT(...)` per layer, layers numbered by IR order
  - `combo_t key_combos[]` when there are combos
  - `process_record_user` cases for macros, using `tap_code16` and `wait_ms`
  - `get_tapping_term` and the other `_PER_KEY` callbacks, when keys use more than one `HoldTapProfile`
  - passthrough blocks at their anchors
- **`config.h`:** `#define`s from settings and the default profile.
- **`rules.mk`:** `COMBO_ENABLE = yes` when there are combos, plus anything passthrough needs. Oryx's `rules.mk` lines are kept as passthrough.

The header comment says `Generated by keyloom from rev_… — edit in keyloom, not here`. Output is deterministic, so a regenerate with no changes produces a byte-identical file.

## Build runs QMK's Docker script from the pinned fork

The build checkout lives at `$XDG_CACHE_HOME/keyloom/build/zsa-moonlander/`. It's `zsa/qmk_firmware` at the pinned SHA, with submodules. keyloom writes the generated keymap and runs QMK's documented Docker build from the checkout root:

```
util/docker_build.sh zsa/moonlander/<reva|revb>:keyloom
```

QMK documents `util/docker_build.sh <keyboard>:<keymap>` for building without a local toolchain (qmk/qmk_firmware `7a1bbf3` `docs/getting_started_docker.md:24`). The fork derives from QMK, so the script should be there too. Spike S5 confirms it builds both revisions from the fork. The output `.bin` is copied to `$XDG_DATA_HOME/keyloom/artifacts/<build id>.bin`, and the log is kept.

Failure handling matches [06](06-firmware-zmk.md#build-runs-the-moergo-template-in-docker): Docker checked first, the log tail shown, compiler errors mapped back to a layer and position where the line is in a `LAYOUT(...)` call.

## Flash uses ZSA's Zapp CLI

ZSA's flashing routes are Chrome (WebUSB from Oryx), Keymapp (a desktop app) and Zapp (an open-source CLI). Zapp v1.0.2 supports "Moonlander MK1 (rev A and rev B)". `zapp flash firmware.bin` waits for a board in bootloader mode and flashes it. It installs with `brew install zapp`. keyloom shells out to it (D-043):

`keyloom flash` → check `zapp` is on `PATH` (`keyloom doctor` does too) → tell BK to press the reset button with a paperclip or use the reset key (`QK_BOOT`, or Oryx's Reset key) → run `zapp flash <artifact>.bin` and stream its output → record the outcome.

Rejected alternatives:

- **Keymapp:** a GUI, so keyloom can't drive it. Whether its API can flash is unknown.
- **`wally-cli`:** archived.
- **`qmk flash` or `dfu-util` directly:** they would work on rev A, but rev B's bootloader needs ZSA's IDs and offset. Zapp already knows both, and it's maintained by ZSA.

## Physical layout

The fork's `keyboards/zsa/moonlander/<rev>/keyboard.json` gives 72 keys with `x`, `y`, `w` and `h`, in the order `LAYOUT(...)` takes them. No key is rotated, so the angled thumb cluster draws straight. The board definition copies this geometry. It adds an optional display-only rotation for the thumb keys, so the editor looks like the real board. Rotation never affects positions or generation ([04](04-boards-and-contributions.md)).

## Capabilities the agent is told about

- Mod-tap: the tap side must be a basic keycode with no modifiers, and the mods must be all left-hand or all right-hand (`docs/mod_tap.md:65` at `7a1bbf3`).
- Tap-hold options on `firmware25`: `TAPPING_TERM`, per-key terms, `PERMISSIVE_HOLD`, `CHORDAL_HOLD` (opposite-hand holds for home row mods), `FLOW_TAP_TERM`, `QUICK_TAP_TERM`, `HOLD_ON_OTHER_KEY_PRESS`, `RETRO_TAPPING`. No Speculative Hold.
- Combos (`COMBO_ENABLE`), macros, layer actions (momentary, toggle, to, one-shot layer).
- Up to 32 layers, matching Oryx's documented limit (zsa.io/oryx, checked 2026-09-28). keyloom enforces that limit, not QMK's own.
