# 05: Firmware: QMK (Moonlander)

The ZSA Moonlander is BK's QMK board (D-027). This document covers importing its current layout from Oryx, generating QMK source, building it locally and flashing it. Every fact here is in [../research/qmk-and-moonlander.md](../research/qmk-and-moonlander.md), checked 2026-10-15. Pinned commits: `zsa/qmk_firmware` `93b2b9ec3368f86c5eb5a2e3f934049f8daef885` (branch `firmware25`), `zsa/zapp` `a1be75837323001ad1ae8e5787d88cd33f2ccc46` (v1.0.2), and mainline `qmk/qmk_firmware` `7a1bbf37c5c07da4ea0a162bb139083a46ef40a1` for documentation.

## There are two Moonlander revisions, and only ZSA's fork builds both

ZSA started shipping a revision B Moonlander in mid-December 2025. Rev A uses the stock STM32 DFU bootloader (`0483:DF11`, flashing at `0x08000000`, USB PID `0x1969` in normal mode). Rev B uses ZSA's own bootloader (`3297:2003`, flashing at `0x08002000`, PID `0x1972`). Mainline QMK has only rev A. A PR adding rev B was closed unmerged on 2026-06-22. ZSA's fork has `zsa/moonlander/reva` and `zsa/moonlander/revb`, and Oryx builds from it.

So keyloom builds QMK from ZSA's fork at a pinned `firmwareNN` commit (D-040). Mainline is rejected for v1 because it can't build rev B, and BK's board may be rev B (spike S1). The cost: Speculative Hold exists in mainline but not in `firmware25`, so keyloom can't offer it on the Moonlander. The validator rejects it with `firmware_unsupported` ([07](07-change-validation.md)).

The board definition has one board, `zsa/moonlander`, with two `revisions`. Each revision has its own QMK target, USB IDs and flashing notes. The revision is chosen at import. On macOS, keyloom detects it by reading the connected keyboard's USB PID from `system_profiler SPUSBHostDataType -json` (its `USBDeviceKeyProductID` field), falling back to `SPUSBDataType` on older macOS. Newer macOS returns an empty `SPUSBDataType` report (seen on Darwin 27). The PID is `0x1969` for rev A or `0x1972` for rev B. If no keyboard is connected, it asks.

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
   - `TD(DANCE_n)` → a `tapDance` binding, when the file's tap dance code is exactly what keyloom writes back for the entries it read from it (D-153, S16). Anything else leaves every `TD()` key `native` and the tap dance code in `Passthrough`, as before. `DUAL_FUNC_0` stays `native`: its hold is `layer_move(5)`, which stays on the layer, and no slot action says that without a plausible but wrong momentary layer.
3. Read `config.h` into `FirmwareSetting`s (`TAPPING_TERM`, `PERMISSIVE_HOLD`, `CHORDAL_HOLD`, `FLOW_TAP_TERM`, `QUICK_TAP_TERM` and the rest) and into a `home-row-mods` `HoldTapProfile`. Per-key tapping terms from `get_tapping_term` become further profiles.
4. Keep anything else (`rgb_matrix` code, `keyboard_post_init_user`, Oryx's `qmk_modules` hooks) as `Passthrough`.
5. Print the import report, as for ZMK.

What an Oryx export of BK's actual layout contains was spike S3 ([../research/spikes/S3.md](../research/spikes/S3.md)). The parser is written against that file, committed as `test/fixtures/oryx/synchronized/`. S3 added these rules:

- **Combos are keycode-based in QMK.** The importer resolves each combo key to the base-layer position whose binding produces that keycode, and imports the combo with `layerIds: "all"`. The generator writes the base-layer bindings at those positions back as keycodes.
- **`keymap.json` is kept as a passthrough file.** It carries `{"modules": ["zsa/oryx", "zsa/defaults"]}`, so the build needs ZSA's `qmk_modules` beside the fork.
- **`LAYER_STATE_8BIT` in `config.h` caps the layout at 8 layers.** It's imported as a setting and enforced by the validator.
- **Some of Oryx's generated code uses layer indices:** the `ledmap`, `rgb_matrix_indicators_user`'s `case n:`, and `layer_move(n)` and `LT(n, …)` inside `process_record_user`. That code is passthrough, and the importer records which of those numbers are layer numbers so the generator can renumber them when layers move (D-360, [07](07-change-validation.md#layer-numbers-in-kept-code)).

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

The header comment says `Generated by keyloom from rev_… — edit in keyloom, not here`. It is in `keymap.c` and `config.h`; `rules.mk` and `keymap.json` are the layout's passthrough text as imported, because a header would change what the importer reads back. Output is deterministic, so a regenerate with no changes produces a byte-identical file.

Generation rules that decide how the firmware behaves:

- **Round trip.** Importing BK's Oryx export, generating, and importing the result gives an identical layout, and building that source for revb gives the same bytes as building the Oryx source itself (spike S5's binary, sha256 `fcceb9fb…37e4d`). `test/firmware/qmk/generate.test.ts` and the gated `docker.test.ts` hold both.
- **What QMK can't express is an error, not a guess.** Mixed left and right modifiers on one key, a modifier on a hold-tap's tap side, `LT()` past layer 15, more layers than `LAYER_STATE_8BIT` allows, a combo on a transparent key, a hold-tap profile option QMK can't set per key. Each names the layer and position.
- **Hold-tap profiles** equal to the layout-wide settings add nothing to the firmware. A profile that differs becomes `get_tapping_term`, `get_quick_tap_term`, `get_permissive_hold` or `get_hold_on_other_key_press`, matched by keycode, with the layout-wide value as the default.
- **Combos** put the base layer's keycodes at the combo's positions. A layer-scoped combo gets `combo_should_trigger`; a combo with its own timeout gets `get_combo_term`. `COMBO_ENABLE` in `rules.mk` is corrected (by appending, since `make` takes the last assignment) when it disagrees with whether combos exist.
- **Macros** keep their `ST_MACRO_n` names; a macro made in keyloom takes the lowest free number.
- **Settings.** A flag is `#define KEY`; a flag that is off is left undefined. Strings keep their quotes in the IR, so they are written back as they were read.

## Build runs QMK's Docker script from the pinned fork

The build checkout lives at `$XDG_CACHE_HOME/keyloom/build/zsa-moonlander/`. It's `zsa/qmk_firmware` at the pinned SHA, with submodules. keyloom writes the generated keymap and runs QMK's documented Docker build from the checkout root:

```
docker run --rm --user "$(id -u):$(id -g)" -w /qmk_firmware -v <checkout>:/qmk_firmware \
  -e SKIP_GIT=1 -e MAKEFLAGS=-j4 ghcr.io/qmk/qmk_cli@sha256:<pinned digest> \
  make zsa/moonlander/<reva|revb>:keyloom
```

This is the `docker run` behind QMK's `util/docker_build.sh`, called directly. That script's helper passes `-it`, which needs a terminal. Spike S5 ([../research/spikes/S5.md](../research/spikes/S5.md)) built BK's unchanged Oryx source for both revisions this way, in 101 s and 110 s. The checkout needs five submodules: `lib/chibios`, `lib/chibios-contrib`, `lib/printf`, `lib/lufa` and `modules/zsa`. ZSA's Oryx module fails to compile without LUFA. The image digest, layout macro, keymaps folder and submodule list are in the board definition (`revisions[].build`), as is each revision's bootloader (`revisions[].flash.bootloader`). Before `make`, keyloom runs `test -f Makefile` in the container, because Docker Desktop mounts an empty folder for a path it may not share and `make` then only says "No rule to make target". The output `.bin` is checked for a DFU suffix naming the revision's bootloader and a valid CRC, then copied to `$XDG_DATA_HOME/keyloom/artifacts/<build id>.bin`; the log is kept. Builds in one checkout are serialised with a lock directory beside it.

Failure handling matches [06](06-firmware-zmk.md#build-runs-the-moergo-template-in-docker): Docker checked first, the log tail shown, compiler errors mapped back to a layer and position where the line is in a `LAYOUT(...)` call.

## Emulate runs the generated keymap on QMK's own core

`keyloom emulate` answers "what would my Moonlander type for these key presses?" without the keyboard. The generated `keymap.c` is compiled into QMK's host test harness (`platforms/test`, `tests/test_common`, gtest), which builds the real action, tap-hold, layer, one-shot, combo, tap-dance and macro code for this machine and captures the HID reports. Nothing is reimplemented, so chordal hold, permissive hold and `TAPPING_TERM` behave as they do on the board (D-080).

The code is `src/firmware/qmk/emulate.ts` (orchestration), `emulate-harness.ts` (the C, C++ and make files it adds) and `emulate-reports.ts` (output to the contract in `src/firmware/emulate/types.ts`). It runs in the same pinned image and checkout as the build, under the same lock:

1. keyloom writes a folder `tests/keyloom_emu_<target>_<run>/` in the checkout: the generated `keymap.c` and `config.h` unchanged, a `test.mk` with the features that change what keys send (D-082), and a harness test (`emu.cpp`) that plays the events and prints every report.
2. In the container, `qmk generate-keyboard-h` and `qmk generate-config-h` produce the board's layout macros and `info_config.h`, the same inputs a real build uses. `make -j4 test:keyloom_emu_...` builds and runs the harness. A cold run takes about 12 s once the checkout and image exist.
3. A position becomes a matrix cell through the board's own `LAYOUT` macro, called with the arguments `1..N`, so no table of wiring is kept in keyloom (D-080).
4. Events play on a 1 ms scan, each event seen by the scan at its own time; after the last one QMK runs a further second, so a pending tap-hold or one-shot resolves (D-083).

What is replaced, and said in the result's `warnings`:

- **Oryx's output-only code.** The Oryx keymap calls RGB, layer-LED, raw HID and keyboard-config code that only exists on the keyboard. A stand-in header and `stubs.c` give those no-ops, and the keymap itself is not edited. A symbol with no stand-in fails at link time with a message naming it.
- **Hardware features in `rules.mk`.** Only the feature flags in `CARRIED_FEATURES` reach the harness. `ORYX_ENABLE`, RGB and the rest are listed in the warnings.
- **Scanning, debounce, USB and the host.** QMK sees each event on a 1 ms tick. Key repeat, mouse movement and Caps Lock state belong to the host, so they are not shown.

The pinned fork's report header uses `_Static_assert`, which the C++ tests can't compile, so the harness defines it as `static_assert` for C++ only. googletest is a submodule the firmware build never fetches; the emulator adds `lib/googletest` to the checkout's submodules.

## Flash uses ZSA's Zapp CLI

ZSA's flashing routes are Chrome (WebUSB from Oryx), Keymapp (a desktop app) and Zapp (an open-source CLI). Zapp v1.0.2 supports "Moonlander MK1 (rev A and rev B)". `zapp flash firmware.bin` waits for a board in bootloader mode and flashes it. It installs with `brew install zapp`. keyloom shells out to it (D-043):

`keyloom flash` → check `zapp` is on `PATH` (`keyloom doctor` does too) → run `zapp flash <artifact>.bin` and stream its output → get the board into its bootloader → record the outcome.

Getting into the bootloader needs no keypress once the keyboard runs a keyloom build (D-070 to D-072). Every ZSA build keyloom makes carries `keyloom/<build id tail>` as its USB serial number and a raw-HID command that reboots into the bootloader. When the running firmware has such a serial, keyloom sends that command after Zapp starts waiting, then checks the keyboard comes back with the new build's serial. On any other firmware (Oryx's, the first time) it tells BK to press the reset button with a paperclip or use the reset key (`QK_BOOT`, or Oryx's Reset key), as before. `keyloom flash --reboot-only` and `keyloom doctor` let the restart be tried on its own.

Rejected alternatives:

- **Keymapp:** a GUI, so keyloom can't drive it. Whether its API can flash is unknown.
- **`wally-cli`:** archived.
- **`qmk flash` or `dfu-util` directly:** they would work on rev A, but rev B's bootloader needs ZSA's IDs and offset. Zapp already knows both, and it's maintained by ZSA.

## Physical layout

The fork's `keyboards/zsa/moonlander/<rev>/keyboard.json` gives 72 keys with `x`, `y`, `w` and `h`, in the order `LAYOUT(...)` takes them. No key is rotated, so the angled thumb cluster draws straight. The board definition copies this geometry. It adds display-only overrides so the editor looks like the real board: the thumb cluster and the two red keys turn 30 degrees about a point under the cluster, the right half slides 2 units away from the left so the tilted clusters don't meet, and the red keys carry a physical keycap colour (D-250 to D-252). Rotation never affects positions or generation ([04](04-boards-and-contributions.md)).

## Capabilities the agent is told about

- Mod-tap: the tap side must be a basic keycode with no modifiers, and the mods must be all left-hand or all right-hand (`docs/mod_tap.md:65` at `7a1bbf3`).
- Tap-hold options on `firmware25`: `TAPPING_TERM`, per-key terms, `PERMISSIVE_HOLD`, `CHORDAL_HOLD` (opposite-hand holds for home row mods), `FLOW_TAP_TERM`, `QUICK_TAP_TERM`, `HOLD_ON_OTHER_KEY_PRESS`, `RETRO_TAPPING`. No Speculative Hold.
- Combos (`COMBO_ENABLE`), macros, layer actions (momentary, toggle, to, one-shot layer).
- Up to 32 layers, matching Oryx's documented limit (zsa.io/oryx, checked 2026-09-28). keyloom enforces that limit, not QMK's own.
