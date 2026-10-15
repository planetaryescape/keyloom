# ZMK and Glove80 facts for keyloom

All facts checked 2026-10-15. Repo facts come from shallow clones at the SHAs named below.

| Repo | Default branch | HEAD SHA | Last commit |
| --- | --- | --- | --- |
| `zmkfirmware/zmk` | `main` | `4dd95d7840eb3d5a3f59bb29fbf1ab054715ef85` | 2026-10-09 |
| `moergo-sc/zmk` | `main` | `ce69e85f585c724142aae37ddf8a7e019ff19e93` (also tag `v26.09`) | 2026-10-01 |
| `moergo-sc/glove80-zmk-config` | `main` | `34888be8c9d9a3d5b168a502b8b191ba43b4a1f3` | 2025-05-27 |
| `zmkfirmware/zmk-studio-messages` | `main` | `6cb4c283e76209d59c45fbcb218800cd19e9339d` | not checked |
| `zmkfirmware/zmk-studio-ts-client` | `main` | `87ccd3a36280e245f7d6e2116d404ae2ff952ee0` | not checked |
| `zmkfirmware/zmk-studio` | `main` | `1bb6bb84a370c8917d8e4db15207087b26b3a844` | not checked |

SHAs from `git ls-remote --symref https://github.com/<owner>/<repo> HEAD`, checked 2026-10-15.

## Glove80 is in both upstream ZMK and MoErgo's fork, and MoErgo's builds use the fork via Nix

Upstream ZMK has the board at `app/boards/moergo/glove80/`. Board names are `glove80_lh` and `glove80_rh` (`board.yml`). The left half is the split central (`Kconfig.defconfig`, `ZMK_SPLIT_ROLE_CENTRAL default y` under `BOARD_GLOVE80_LH`). Source: https://github.com/zmkfirmware/zmk/tree/4dd95d7840eb3d5a3f59bb29fbf1ab054715ef85/app/boards/moergo/glove80, checked 2026-10-15.

MoErgo's fork has the board at `app/boards/arm/glove80/`, same board names. Its tags track monthly-style releases: `v25.05`, `v25.08`, `v25.11`, `v26.09`. Source: https://github.com/moergo-sc/zmk/tree/ce69e85f585c724142aae37ddf8a7e019ff19e93/app/boards/arm/glove80, checked 2026-10-15.

The upstream board readme says MoErgo's fork adds features such as RGB status indicators. It says MoErgo only supports its fork, and the ZMK community does not support the fork. Source: `app/boards/moergo/glove80/readme.md` at upstream `4dd95d78`, checked 2026-10-15.

There are four ways to build:

1. MoErgo Layout Editor at https://my.glove80.com. MoErgo calls it the recommended, simpler option for most users. It needs an account. It has daily and weekly build limits, with no published numbers. It uses "the latest production firmware" by default, and other versions can be picked in Settings. Output is `<layout_id>_<firmware_version>_<layout_name>.uf2`. Sources: https://github.com/moergo-sc/glove80-zmk-config/blob/34888be8c9d9a3d5b168a502b8b191ba43b4a1f3/README.md and https://docs.moergo.com/layout-editor-guide/building-firmware/, checked 2026-10-15.
2. GitHub Actions in a repo made from the `moergo-sc/glove80-zmk-config` template. The workflow checks out `moergo-sc/zmk` at `main`, installs Nix, uses the `moergo-glove80-zmk-dev` Cachix cache, runs `nix-build config`, and uploads `glove80.uf2`. It does not use the standard ZMK `build.yaml` and west flow. Source: `.github/workflows/build.yml` at `34888be8`, checked 2026-10-15.
3. Docker, using the same template. `build.sh [branch]` builds a `nixpkgs/nix:nixos-23.11` image that mirrors `moergo-sc/zmk` and runs the same `nix-build`. The branch or tag defaults to `main`. Source: `Dockerfile` and `build.sh` at `34888be8`, checked 2026-10-15.
4. Nix directly. `config/default.nix` builds `glove80_lh` and `glove80_rh` with the user's `glove80.keymap` and `glove80.conf`, then calls `combine_uf2`. Source: `config/default.nix` at `34888be8`, checked 2026-10-15.

Upstream ZMK's standard user-config flow (west, `build.yaml`) should also work, because the board is in-tree. That path is not one MoErgo documents or supports.

The template's `config/` also holds `keymap.json` and `info.json`. These are QMK-Configurator-style files (`layers` of `{value, params}` bindings, and an `info.json` layout with `x`/`y` per key). Nothing in the build reads them. Source: `config/` at `34888be8`, checked 2026-10-15.

## The Layout Editor exports a ZMK `.keymap` fragment and, behind a setting, an unstable JSON

The Export button next to Save and Build exports "ZMK DTSI format with a filename of `<layout_name>.keymap`". MoErgo frames it as advanced, for local compilation or debugging custom behaviours.

JSON export and import need Settings, then "Local Backup and Restore". MoErgo says "the JSON format may change" and "There is no guarantee that a layout exported in JSON format can be imported in the future." The JSON schema is not documented.

The page documents no import of a `.keymap` file. Only JSON import is described.

Source: https://docs.moergo.com/layout-editor-guide/advanced-usage-export-import/, checked 2026-10-15.

## Each half is flashed separately as a UF2 mass-storage drive, using one combined file

The bootloader shows up as a USB drive per half: `GLV80RHBOOT` for the right and `GLV80LHBOOT` for the left. Copy the `.uf2` to it. The drive disappears when the copy succeeds. MoErgo says to do the right half first, then the left. Both halves get the same file.

Bootloader entry, recommended method: turn the half off, connect USB, hold two keys and turn the power on. The keys are `C6R6 + C3R3` (Magic + E on the default layout) for the left half, and `I + PgDn` on the default layout for the right half. A slow-pulsing red LED by the power switch means bootloader mode.

Bootloader entry, alternative method on a running ZMK firmware with both halves connected: `Magic + Esc` for the left and `Magic + '` for the right, on the default layout.

Source: https://docs.moergo.com/glove80-user-guide/customizing-key-layout/, checked 2026-10-15.

The single file is two UF2 images concatenated: `cat ${a}/zmk.uf2 ${b}/zmk.uf2` in `combine_uf2`. Source: `default.nix` lines 20-26 at `moergo-sc/zmk` `ce69e85f`, checked 2026-10-15. How each half's bootloader skips the other half's blocks was not checked.

## ZMK Studio edits layer bindings at runtime over USB or BLE, but not behaviour settings, combos or macros

Studio changes the keymap on a running keyboard without reflashing. It works over USB, and over BLE on Linux web and in the native apps. The web app at https://zmk.studio/ runs in Chrome or Edge. There are native apps for Windows, Linux and macOS.

Supported now:

- assigning predefined and user-defined behaviours to keys
- renaming layers and enabling extra layers declared with `status = "reserved"`
- picking among the board's predefined physical layouts

Planned, not yet supported:

- basic behaviour properties
- advanced behaviour properties such as tap dance and macros
- combos
- conditional layers
- host locale
- import and export of keymaps

Not planned:

- defining new behaviours not in devicetree
- defining new physical layouts
- adding more layers than devicetree declares

Hold-tap settings such as `tapping-term-ms` and flavor are behaviour properties, so they are not editable at runtime.

Once Studio manages the keymap, later `.keymap` edits are ignored until "Restore Stock Settings" is run. The keyboard must be unlocked with a `&studio_unlock` binding.

Enabling it needs two build changes: the `studio-rpc-usb-uart` snippet and `CONFIG_ZMK_STUDIO=y`. On a split board, apply both to the central half only. Studio builds keep all behaviours by default (`ZMK_BEHAVIORS_KEEP_ALL`).

Source: https://zmk.dev/docs/features/studio, which matches `docs/docs/features/studio.md` at upstream `4dd95d78`, checked 2026-10-15.

Glove80 declares Studio support in both trees. `glove80.zmk.yml` lists `studio` under `features` in upstream (`app/boards/moergo/glove80/`, `4dd95d78`) and in the fork (`app/boards/arm/glove80/`, `ce69e85f`). It meets Studio's board requirements: a `zmk,physical-layout` with `keys` is `chosen`, with no `chosen` matrix transform (`glove80.dtsi`). The fork also carries the Studio code (`app/src/studio/`). Checked 2026-10-15.

Neither board defconfig sets `ZMK_STUDIO`. The MoErgo template's build (`config/default.nix`) does not add the snippet. So a default MoErgo build is unlikely to have Studio enabled, but this has not been tested. MoErgo's docs never mention Studio: the building-firmware page was fetched and a search of docs.moergo.com found nothing. Checked 2026-10-15.

The RPC protocol is documented and open. It is protobuf messages with simple framing: SoF `0xAB`, Esc `0xAC`, EoF `0xAD`. Transports are a custom BLE GATT service and serial, usually CDC ACM over USB. Source: https://zmk.dev/docs/development/studio-rpc-protocol, checked 2026-10-15.

The messages live in https://github.com/zmkfirmware/zmk-studio-messages, which is MIT-licensed. `proto/zmk/keymap.proto` defines `get_keymap`, `set_layer_binding`, `check_unsaved_changes`, `save_changes`, `discard_changes`, `get_physical_layouts`, `set_active_physical_layout`, and `move_layer`, `add_layer`, `remove_layer`, `restore_layer` and `set_layer_props`. Upstream `app/west.yml` pins this repo at `6cb4c283`. Checked 2026-10-15.

There is an official TypeScript client on npm, `@zmkfirmware/zmk-studio-ts-client`. Its latest version is `0.0.18`, it is MIT-licensed and ESM. Source: https://www.npmjs.com/package/@zmkfirmware/zmk-studio-ts-client, checked 2026-10-15. A third-party app could speak the protocol through it.

## Hold-tap, macro and combo names are as expected

`compatible = "zmk,behavior-hold-tap"`. Source: https://zmk.dev/docs/keymaps/behaviors/hold-tap, checked 2026-10-15.

The four flavors are `hold-preferred`, `balanced`, `tap-preferred` and `tap-unless-interrupted`. `hold-preferred` is the default. `&mt` uses `hold-preferred` and `&lt` uses `tap-preferred`.

The four properties asked about all exist under these exact names:

- `require-prior-idle-ms`
- `hold-trigger-key-positions`
- `quick-tap-ms`
- `tapping-term-ms`, which defaults to 200 ms

There are also `hold-trigger-on-release`, `hold-while-undecided`, `hold-while-undecided-linger` and `retro-tap`.

Macros use `compatible = "zmk,behavior-macro"`. Source: https://zmk.dev/docs/keymaps/behaviors/macros, checked 2026-10-15.

Combos sit under a node with `compatible = "zmk,combos"`. Each child has `key-positions`, `bindings` and an optional `timeout-ms`, and can have `slow-release`. Source: https://zmk.dev/docs/keymaps/combos, checked 2026-10-15.

All names were also confirmed in `docs/docs/` at upstream `4dd95d78`.

## ZMK physical layouts give x, y, w, h and rotation per key, which a visual editor can render directly

A layout is a node with `compatible = "zmk,physical-layout"` and a `keys` array. Each entry is `<&key_physical_attrs w h x y r rx ry>`. Units are centi-keyunits, so `100` is one key, and rotation is in centi-degrees. Negative values go in parentheses, as in `(-3000)`. Keys are listed in the same order as keymap bindings. Optional `position-map` nodes map positions across alternative layouts. Source: https://zmk.dev/docs/hardware-integration/physical-layouts, checked 2026-10-15.

Glove80's file is `glove80-layouts.dtsi`. It has one layout, `physical_layout0` ("Default"), with 80 keys. Twelve of them have a non-zero rotation, which looks like the thumb clusters. Source: upstream `app/boards/moergo/glove80/glove80-layouts.dtsi` at `4dd95d78`, checked 2026-10-15.

A renderer can use this geometry in three ways:

- Parse the `.dtsi` from the firmware tree. This needs a devicetree parser and the C preprocessor for the `#include`.
- Read it from a Studio-enabled keyboard with `get_physical_layouts` over RPC.
- Use `keymap-drawer`'s bundled Glove80 layout. See prior-art.md.

## Unsettled; needs a spike

- Does a stock MoErgo Layout Editor build have Studio enabled? Flash the factory-default `.uf2` from my.glove80.com, connect over USB, and open https://zmk.studio/. If it doesn't connect, build from the template with `-S studio-rpc-usb-uart` and `CONFIG_ZMK_STUDIO=y` on `glove80_lh`. That needs a change to `default.nix` or the fork's `zmk.nix` to pass the snippet, which was not checked.
- Does the upstream standard `build.yaml` flow build a working Glove80 image? Board target `glove80_lh` versus a `//zmk` qualifier was not checked. Run a GitHub Actions build of upstream `main` for both halves, flash it, and test it.
- Does the Layout Editor's `.keymap` export compile unmodified against `moergo-sc/zmk` at the matching tag? Export a layout with hold-taps, macros and combos, then run `nix-build config` with it.
- What is the Layout Editor JSON schema? Export one layout and inspect it. Treat it as unstable either way.
- How does the combined UF2 work? Read the UF2 family IDs or target addresses in the two concatenated images, or flash the combined file to each half and confirm both boot.
- Can Studio's `set_layer_binding` over `@zmkfirmware/zmk-studio-ts-client` run from a bun process? The web client uses Web Serial, so a Node or bun serial transport may need writing.
