# QMK, Oryx and Moonlander facts for keyloom

All facts checked 2026-10-15. Repo facts come from the GitHub API or a sparse clone at the SHAs below.

| Repo | Default branch | HEAD SHA | Last commit |
| --- | --- | --- | --- |
| `qmk/qmk_firmware` | `master` | `7a1bbf37c5c07da4ea0a162bb139083a46ef40a1` | 2026-10-02 |
| `zsa/qmk_firmware` | `firmware25` | `93b2b9ec3368f86c5eb5a2e3f934049f8daef885` | 2026-09-02 |
| `poulainpi/oryx-with-custom-qmk` | `main` | `26bfbe6fbb4059554743575e177124ad2488a311` | 2026-05-14 |
| `zsa/zapp` | `main` | `a1be75837323001ad1ae8e5787d88cd33f2ccc46` | 2026-07-09 |
| `zsa/kontroll` | `main` | `be6a3c6d887c33d6228458bee0b3ce55a8f975e6` | 2025-02-22 |
| `zsa/wally-cli` (archived) | `master` | `2d0da1ee4c4e7fa5407c5b6653b0d908cbfe9044` | 2024-08-21 |
| `vial-kb/vial-qmk` | `vial` | `dd43959ae5c08d8a28d38a1acf7b04e86b14a344` | 2026-07-26 |
| `the-via/keyboards` | `master` | `9e3e9f4aa9f50f9439fdebc747560f51aaf109a0` | 2026-09-22 |
| `the-via/qmk_userspace_via` | `main` | `3e440ab72335c56041689a173ea53a512660b104` | 2026-10-08 |

SHAs from `git ls-remote --symref https://github.com/<owner>/<repo> HEAD`, checked 2026-10-15. Short SHAs below refer to these.

## Moonlander is in both repos, but only ZSA's fork supports revision B

Mainline has `keyboards/zsa/moonlander/` as a single board: `keyboard.json` with `"processor": "STM32F303"`, `"bootloader": "stm32-dfu"`, USB PID `0x1969`. There is no `reva`/`revb` split on `master` (`7a1bbf3`) or `develop` (`f0da0b7398b463a280573378263e4a23623e977f`). Source: https://github.com/qmk/qmk_firmware/tree/7a1bbf37c5c07da4ea0a162bb139083a46ef40a1/keyboards/zsa/moonlander, checked 2026-10-15.

ZSA's fork splits the board into `reva` and `revb`. Rev A keeps `stm32-dfu` and PID `0x1969`. Rev B has `"bootloader": "custom"`, PID `0x1972`, `MCU_LDSCRIPT = moonlander`, and `DFU_ARGS = -d 3297:2003 -a 0 -s 0x08002000:leave`. Build targets are `zsa/moonlander/reva:<keymap>` and `zsa/moonlander/revb:<keymap>`. Source: https://github.com/zsa/qmk_firmware/tree/93b2b9ec3368f86c5eb5a2e3f934049f8daef885/keyboards/zsa/moonlander, checked 2026-10-15.

The fork's Moonlander readme says ZSA started shipping rev B in mid-December 2025. In bootloader mode, rev A shows up as `STM Device in DFU Mode` or `STM32 Bootloader`; rev B shows up as `Moonlander Bootloader`. Source: `keyboards/zsa/moonlander/readme.md` at `93b2b9e`, checked 2026-10-15.

A community PR to add rev B to mainline (qmk/qmk_firmware#26090) was auto-closed as stale on 2026-06-22, unmerged. Source: https://github.com/qmk/qmk_firmware/pull/26090, checked 2026-10-15.

ZSA's fork readme says the fork "is the repo that Oryx pulls from" and tells users to run `qmk setup zsa/qmk_firmware -b firmware25`. Each Oryx firmware version maps to a `firmwareNN` branch (`firmware17` to `firmware25` exist). Source: https://github.com/zsa/qmk_firmware/blob/93b2b9ec3368f86c5eb5a2e3f934049f8daef885/README.md, checked 2026-10-15.

The README inside an Oryx source download gives both options. ZSA's fork "will compile easily" but is slower to pick up mainline features. Mainline is "the bleeding edge" and may need compiler-error fixes. Source: `README.md` in the zip from `https://oryx.zsa.io/source/veo5Q`, checked 2026-10-15.

ZSA's own Oryx-specific code (raw HID for live view, per-layer key colours) moved to community modules in `zsa/qmk_modules` from firmware 25. Source: https://github.com/zsa/qmk_modules, HEAD `13890cd7856175de20798689d15ba6a46bf0c5c7`, checked 2026-10-15.

## Oryx exports C source, and an unauthenticated GraphQL endpoint returns the layout as JSON

The source download is a zip with `README.md`, `build.log`, a `.bin` and its `.md5`, and a `*_source/` folder holding `config.h`, `keymap.c` and `rules.mk`. There is no `keymap.json`. Checked by downloading `https://oryx.zsa.io/source/veo5Q` (public layout `g7jjw`) and listing the zip, 2026-10-15.

The exported `keymap.c` is ordinary QMK C. The sample has 7 `LAYOUT_voyager(...)` layers, `MT(MOD_LGUI, KC_C)`-style home row mods, `LT(1, KC_SPACE)`, `OSM`, `OSL`, `TD(DANCE_n)` tap dances, `ST_MACRO_n` macros, a `process_record_user`, and a per-key tapping term. `config.h` sets `PERMISSIVE_HOLD` and `TAPPING_TERM_PER_KEY`. Same download, checked 2026-10-15.

The archived `wally-cli` readme documents `https://oryx.zsa.io/{layout ID}/latest/binary`. Replacing `binary` with `source` gives the source. `latest` can be a revision ID. Private layouts return 401; uncompiled revisions return 404. Source: https://github.com/zsa/wally-cli/blob/2d0da1ee4c4e7fa5407c5b6653b0d908cbfe9044/README.md, checked 2026-10-15.

`https://oryx.zsa.io/graphql` answers unauthenticated queries for public layouts. ZSA does not document it as a public API; it is semi-public. Introspection is off (`Field '__schema' doesn't exist on type 'Query'`). A query for `layout(hashId, geometry, revisionId) { revision { layers { title position keys } } }` returned structured JSON per key: `tap`, `hold`, `doubleTap`, `tapHold` (each with `code`, `modifiers`, `layer`, `macro`), plus `glowColor`, `customLabel` and `tappingTerm`. Checked by `curl` against layout `g7jjw`, 2026-10-15.

`poulainpi/oryx-with-custom-qmk` exists (HEAD `26bfbe6`). Its GitHub Actions workflow posts a `getLayout` GraphQL query for `revision { hashId, qmkVersion, title }`, then downloads `https://oryx.zsa.io/source/${hash_id}` and unzips `*_source/*` onto an `oryx` branch. It merges that branch into `main`, where the user's hand edits live, with `git merge -Xignore-all-space`. It checks out `zsa/qmk_firmware` at `firmware${qmkVersion}` and builds with `make`. The layout must be public. Source: https://github.com/poulainpi/oryx-with-custom-qmk/blob/26bfbe6fbb4059554743575e177124ad2488a311/.github/workflows/fetch-and-build-layout.yml, checked 2026-10-15. ZSA links this tool from the source-zip README and from https://blog.zsa.io/oryx-custom-qmk-features/.

ZSA's own `zapp` CLI uses the same endpoints. It posts to `https://oryx.zsa.io/graphql` and downloads `https://oryx.zsa.io/firmware/{revision_id}`, with `?alt=true` for the alternate MCU build and `?collate=true` for a combined Moonlander image. Source: `zapp-oryx/src/lib.rs` at `a1be758`, checked 2026-10-15.

## Keymapp is ZSA's GUI flasher; Zapp is the official CLI; `qmk flash` uses dfu-util

Keymapp is ZSA's desktop app for Windows, macOS and Linux. It flashes firmware files, shows the live layout and heatmap, and runs Smart Layers. Source: https://www.zsa.io/keymapp, checked 2026-10-15. Keymapp exposes a gRPC API, over a Unix socket at `$CONFIG_DIR/.keymapp/keymapp.sock` on macOS and Linux, for layer switching and LEDs. `zsa/kontroll` is the reference client. Source: https://github.com/zsa/kontroll/blob/be6a3c6d887c33d6228458bee0b3ce55a8f975e6/README.md, checked 2026-10-15. That README lists no flashing call.

ZSA's flashing page lists three routes: Chrome (WebUSB from Oryx), Keymapp and Zapp. On Windows, Keymapp must be installed for its driver. Source: https://www.zsa.io/flash, checked 2026-10-15.

`wally-cli` is deprecated and archived. Its readme points to Keymapp. Source: https://github.com/zsa/wally-cli, checked 2026-10-15.

Zapp (`zsa/zapp`, Rust, v1.0.2 released 2026-07-09) supports "Moonlander MK1 (rev A and rev B)". `zapp flash firmware.bin` waits for a board in bootloader mode and then flashes it. It also takes an Oryx URL, and `zapp update` reads the layout from the board's USB serial. It handles dual-firmware files for Moonlander rev A + rev B. Install with `brew install zapp`. Source: https://github.com/zsa/zapp/blob/a1be75837323001ad1ae8e5787d88cd33f2ccc46/README.md, checked 2026-10-15.

Zapp's device table tells the bootloaders apart. The generic STM32 DFU is `0483:DF11` and flashes at `0x08000000`. ZSA's "Ignition" bootloader is `3297:2003` for the Moonlander and flashes at `0x08002000`. Normal-mode PIDs are `0x1969` (rev A) and `0x1972` (rev B). Source: `zapp-core/src/device/ids.rs` at `a1be758`, checked 2026-10-15.

QMK's `qmk flash` / `make ...:flash` on an STM32 board calls `dfu-util`. For `stm32-dfu` the documented command is `dfu-util -a 0 -d 0483:DF11 -s 0x8000000:leave -D <file>`. Source: https://docs.qmk.fm/flashing (`docs/flashing.md` at `7a1bbf3`), checked 2026-10-15. In ZSA's fork, rev B also goes through dfu-util, because `MCU_FAMILY` is STM32. It uses the `DFU_ARGS` above (`3297:2003`, offset `0x08002000`). Source: `platforms/chibios/flash.mk` and `keyboards/zsa/moonlander/revb/rules.mk` at `93b2b9e`, checked 2026-10-15.

To enter the bootloader, ZSA says to press the reset button with a paperclip, or use the Reset key in Oryx. Source: https://www.zsa.io/101, checked 2026-10-15. QMK's equivalent keycode is `QK_BOOT`. The mainline default Moonlander keymap puts it on the `MDIA` layer. Sources: https://docs.qmk.fm/keycodes and `keyboards/zsa/moonlander/keymaps/default/keymap.c` at `7a1bbf3`, checked 2026-10-15.

## keymap.json covers layers, mod-taps, layer-taps, simple macros and config; tap dance and combo definitions need C

The `keymap.json` schema has these top-level keys: `author`, `converter`, `host_language`, `keyboard`, `keymap`, `layout`, `layers`, `encoders`, `dip_switches`, `macros`, `keycodes`, `config`, `notes`, `modules`. Source: `data/schemas/keymap.jsonschema` at `7a1bbf3`, checked 2026-10-15.

Layers are arrays of keycode strings. Mod-tap and layer-tap strings such as `LALT_T(KC_S)`, `MT(MOD_LGUI, KC_C)` and `LT(1, KC_SPC)` are passed through into the generated `LAYOUT(...)` call, because `json2c` writes the strings into C. Source: `_generate_keymap_table` in `lib/python/qmk/keymap.py` at `7a1bbf3`, checked 2026-10-15.

JSON macros allow up to 32 entries. Each is a list of strings and `{action: tap|down|up|delay|beep, keycodes, duration}` objects. Sources: https://docs.qmk.fm/feature_macros and `keymap.jsonschema` at `7a1bbf3`, checked 2026-10-15.

`config` takes the keyboard.json schema, so tap-hold settings fit in JSON. `tapping.term`, `permissive_hold`, `chordal_hold`, `flow_tap_term`, `speculative_hold` and their `_per_key` variants all exist. For combos, only `combo.term` (and `count`) exist. There is no schema field for combo definitions or tap-dance actions. Sources: `data/schemas/keyboard.jsonschema` and `data/mappings/info_config.hjson` at `7a1bbf3`, checked 2026-10-15.

QMK's Configurator docs say features that need functions in `keymap.c`, "such as Tap Dance or Unicode", cannot be built from the JSON format. Source: https://docs.qmk.fm/configurator_default_keymaps, checked 2026-10-15. That covers tap dance, combo arrays, `process_record_user`, per-key callbacks like `get_tapping_term` and `get_chordal_hold`, and custom keycode logic.

A hybrid is supported. If `keymap.c` sits next to `keymap.json`, the build generates a `keymap.c` from the JSON and `#include`s the user's file through `OTHER_KEYMAP_C`. The JSON can then own the layers while C owns tap dances, combos and callbacks. Source: `builddefs/build_keyboard.mk` and the `json2c` template in `lib/python/qmk/keymap.py` at `7a1bbf3`. The same code is in ZSA's fork at `93b2b9e`. Checked 2026-10-15.

`qmk json2c` ("Creates a keymap.c from a QMK Configurator export") and `qmk c2json` ("Creates a keymap.json from a keymap.c") both exist. The c2json docs warn: "Parsing C source files is not easy, therefore this subcommand may not work with your keymap. In some cases not using the C pre-processor helps" (`--no-cpp`). Source: https://docs.qmk.fm/cli_commands, checked 2026-10-15.

c2json's parser "only cares about the keymaps array". It runs `cpp` over the file (unless `--no-cpp`), lexes it with Pygments, and collects tokens inside each `LAYOUT*` call. It maps `_______` to `KC_TRNS` and `XXXXXXX` to `KC_NO`. It drops everything else: macros, tap dances, combos, config and callbacks. Source: `parse_keymap_c` and `_get_layers` in `lib/python/qmk/keymap.py` at `7a1bbf3`, checked 2026-10-15.

Running that parser with `--no-cpp` on the Oryx Voyager `keymap.c` above returned 7 layers of 52 keys. Mod-taps and layer-taps came through as strings (`"MT(MOD_LGUI, KC_C)"`, `"LT(1, KC_SPACE)"`). `TD(DANCE_0)` and `ST_MACRO_0` came through as opaque names with no bodies. Checked by importing `qmk.keymap` from `7a1bbf3` with `uv`, 2026-10-15.

## Permissive Hold, Chordal Hold, Flow Tap and Speculative Hold all exist in mainline; ZSA's fork lacks Speculative Hold

From https://docs.qmk.fm/tap_hold (`docs/tap_hold.md` at `7a1bbf3`), checked 2026-10-15:

- Permissive Hold: `#define PERMISSIVE_HOLD`, plus `PERMISSIVE_HOLD_PER_KEY`.
- Chordal Hold: `#define CHORDAL_HOLD`. Handedness and per-chord callbacks are documented in the same section.
- Flow Tap: `#define FLOW_TAP_TERM 150`, with `is_flow_tap_key()` and `get_flow_tap_term()` callbacks.
- Speculative Hold: `#define SPECULATIVE_HOLD`, with `SPECULATIVE_HOLD_ONE_KEY`, `SPECULATIVE_HOLD_FLOW_TERM` and a `get_speculative_hold()` callback. By default it applies to Shift and Ctrl mod-taps.
- Others: `HOLD_ON_OTHER_KEY_PRESS`, `QUICK_TAP_TERM`, `RETRO_TAPPING`, `TAPPING_TERM`, `TAPPING_TERM_PER_KEY`.

Commit history dates them. Flow Tap landed 2025-04-14 (#25125) and Speculative Hold 2025-11-11 (#25572). The `ONE_KEY` and `FLOW_TERM` options landed 2026-05-22 (#26099). Chordal Hold is PR #24560. Source: `gh api repos/qmk/qmk_firmware/commits?path=docs/tap_hold.md`, checked 2026-10-15.

ZSA's `firmware25` (`93b2b9e`) has `CHORDAL_HOLD`, `FLOW_TAP_TERM` and `PERMISSIVE_HOLD` in `quantum/action_tapping.c`. It has no `SPECULATIVE_HOLD` anywhere in the tree, and no `speculative_hold` tests. Checked by grepping the file and the full tree listing, 2026-10-15. A layout that wants Speculative Hold has to build against mainline.

## keyboard.json `layouts` gives x/y/w/h per key and can drive a visual editor

Each key in `layouts.<NAME>.layout` has required `matrix`, `x` and `y`, plus optional `w`, `h`, `r`, `rx`, `ry`, `label` and `encoder`. Units are key units. QMK says the format follows KLE raw data, except that each key is stateless. Source: https://docs.qmk.fm/reference_info_json#layouts, checked 2026-10-15.

The mainline Moonlander has one layout, `LAYOUT` (alias `LAYOUT_moonlander`), with 72 keys. Examples: `{"matrix": [0, 0], "x": 0, "y": 0.375}`, a 2u key at `"w": 2`, and thumb keys at `"h": 1.5`. No key uses `r`, so the angled thumb cluster is drawn unrotated. Source: `keyboards/zsa/moonlander/keyboard.json` at `7a1bbf3`, checked 2026-10-15.

The same data is served as JSON at `https://keyboards.qmk.fm/v1/keyboards/zsa/moonlander/info.json` (72 keys, `last_updated` 2026-10-02). Checked by `curl`, 2026-10-15. ZSA's fork has its own `keyboard.json` with a layout in each of `reva/` and `revb/`.

## Vial and VIA both have community Moonlander support that ZSA does not back, and both target rev A only

Vial: yes. `vial-kb/vial-qmk` has `keyboards/zsa/moonlander/keymaps/vial/` with a `vial.json`. Its `keyboard.json` is the single-board, rev A definition (`stm32-dfu`, PID `0x1969`), and it has no `revb`. Source: https://github.com/vial-kb/vial-qmk/tree/dd43959ae5c08d8a28d38a1acf7b04e86b14a344/keyboards/zsa/moonlander, checked 2026-10-15.

VIA: yes. `the-via/keyboards` has `v3/zsa/moonlander.json`, named "Moonlander Mark I (Unsupported by ZSA)", with PID `0x1969`. Source: https://github.com/the-via/keyboards/blob/9e3e9f4aa9f50f9439fdebc747560f51aaf109a0/v3/zsa/moonlander.json, checked 2026-10-15. The firmware keymap lives in `the-via/qmk_userspace_via` at `keyboards/zsa/moonlander/keymaps/via/`. Its readme says "ZSA does not provide any support for VIA". Source: https://github.com/the-via/qmk_userspace_via/tree/3e440ab72335c56041689a173ea53a512660b104/keyboards/zsa/moonlander/keymaps/via, checked 2026-10-15.

Both need a reflash to Vial or VIA firmware first. After that, keymaps change at runtime through the dynamic keymap stored in EEPROM. Mainline Moonlander sets `"dynamic_keymap": {"layer_count": 8}` (`keyboard.json` at `7a1bbf3`). A board on Oryx firmware does not get runtime keymap edits from this.

## Unsettled; needs a spike

- Which revision BK's Moonlander is. Put it in bootloader mode and read the USB name or ID: `STM32 Bootloader`/`0483:DF11` means rev A; `Moonlander Bootloader`/`3297:2003` means rev B. Alternatively, `system_profiler SPUSBDataType` in normal mode shows PID `0x1969` or `0x1972`.
- Whether mainline QMK can build working rev B firmware. Mainline has no rev B target, and rev B's bootloader sits at `0x08002000`. Spike: build `zsa/moonlander/revb` from ZSA's fork, then port `revb/` into a mainline userspace and compare the binaries and boot behaviour.
- Whether rev B uses a different MCU. The fork's `revb/keyboard.json` still says `STM32F303`, but the closed mainline PR says "the chip ... are now different". Zapp's code also calls the rev B build the "alternate MCU" one. Reading the board or ZSA's hardware notes would settle it.
- Whether `oryx.zsa.io/graphql` covers private layouts with a session cookie, and how stable its schema is. Introspection is off. Spike: query a private layout logged in and logged out, and log the field set over a few weeks.
- Whether the GraphQL key JSON maps losslessly onto QMK keycodes for Moonlander layouts: tap dance (`doubleTap`, `tapHold`), macros, combos and per-key tapping terms. Spike: fetch BK's layout via GraphQL and via `/source`, then diff a JSON-to-C render against Oryx's `keymap.c`.
- Whether `qmk c2json` with the default `cpp` pass works on an Oryx `keymap.c`. Only `--no-cpp` was tested, and on a Voyager file. Spike: run both modes on BK's Moonlander export inside a full QMK checkout.
- Whether Keymapp has any CLI or API path for flashing. The Kontroll proto was not read in full. Read `proto/keymapp.proto` in `zsa/kontroll`.
- Whether the Vial or VIA Moonlander firmware boots on rev B. Both target PID `0x1969` and the stm32-dfu layout. Test on hardware, or read the Vial issue tracker.
