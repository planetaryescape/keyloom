# 06: Firmware: ZMK (Glove80 and the Corne)

Status update, 2026-11-01: layer-specific encoder turns and mouse presses are implemented (D-471); generation/import, the compiled scratch-CLI journey and a real firmware build for both Keebart halves are checked. After the initial Docker blocker, build `bld_01M6ACXF8GWXY7Z9DYMP59X0H8` produced verified left/right UF2 images. No new hardware flash or pointer-motion observation is claimed.

## Per-layer encoder turns

ZMK's `sensor-bindings` belongs to each layer, not the board as a whole. D-462's repeated board defaults were a keyloom limitation, not a firmware limitation. `setSensorBindings` replaces one layer's array. The Keebart module has four sensor slots for two knobs: `sensorPositions: [6, 6, 7, 7]` associates alternative footprints with the same editable press. The key card edits both footprints together. Old layouts retain their existing defaults until edited.

Key pairs emit `&inc_dec_kp`; other pairs get generated `zmk,behavior-sensor-rotate` nodes. Pointer movement and scroll use dedicated constant-speed `zmk,behavior-input-two-axis` devices and input listeners, with a 5 ms trigger and a 20 ms sensor press. ZMK's ordinary 5 ms sensor press ends before its default 16 ms mouse tick, so merely assigning `&mmv` would not suffice. The dedicated devices do not retune ordinary mouse keys. Pointing headers and `CONFIG_ZMK_POINTING=y` are generated when needed. Clicks use `&mkp LCLK` / `RCLK` at the existing press positions.

The importer preserves each layer's sensor calls and kept definitions instead of dropping them. Unsupported calls stay opaque; parameterized opaque calls conservatively block layer renumbering. Generated custom rotation definitions reimport as native sensor calls, not editable pairs; keyloom JSON exports preserve the typed pairs. The real build compiled pointer turns and mouse clicks on Base with media turns/presses on Numbers; physical movement still needs an explicitly authorized hardware test. Build receipts are in [the encoder evidence](../screenshots/encoder-layers/README.md). To try it on synthetic data, use [the encoder recipe](../encoder-layers.md).

The Glove80 and the Keebart Corne Choc Pro BT are BK's ZMK boards (D-027, D-462). This document covers importing their layouts, generating a `.keymap`, building firmware locally and flashing both halves. Most of it is the Glove80; the Keebart Corne's hardware module, per-half targets and RGB adapter are at the end. Every Glove80 fact here is in [../research/zmk-and-glove80.md](../research/zmk-and-glove80.md), checked 2026-10-15. Pinned commits: `moergo-sc/zmk` `ce69e85f585c724142aae37ddf8a7e019ff19e93` (tag `v26.09`), `moergo-sc/glove80-zmk-config` `34888be8c9d9a3d5b168a502b8b191ba43b4a1f3`, upstream `zmkfirmware/zmk` `4dd95d7840eb3d5a3f59bb29fbf1ab054715ef85`.

## The firmware tree is MoErgo's fork, pinned to a release tag

The Glove80 is in upstream ZMK and in MoErgo's fork, as boards `glove80_lh` and `glove80_rh`. The left half is the split central. MoErgo supports only its fork, and the fork adds features such as RGB status indicators. keyloom builds against `moergo-sc/zmk` at a pinned tag, `v26.09` for now (D-036). Upstream's standard `build.yaml` flow may work, but nobody supports it for this board, and the firmware BK runs today comes from the fork.

The tag is recorded in the board definition ([04](04-boards-and-contributions.md)). Moving to a newer tag is a deliberate change to the board definition, not a silent `main` pull. MoErgo's own template builds `main`, and this pinning is where keyloom departs from it.

## Import reads the Layout Editor's `.keymap` export

BK's current Glove80 layout lives in MoErgo's Layout Editor at my.glove80.com. Its Export button produces a ZMK devicetree file, `<layout_name>.keymap`. The editor also exports JSON behind a setting, but MoErgo says that format "may change" and isn't guaranteed to import later. So keyloom reads the `.keymap` (D-037).

`keyloom import --board moergo/glove80 <file.keymap>`:

1. Expand the file's own `#define`s. Object-like ones such as `#define HYPER LC(LS(LG(LALT)))` and `#define LOWER 1` are expanded where a binding uses them; function-like ones are not, so a binding that uses one stays native. `#include`s are not followed: key names come from the keycode table, which is generated from the same `keys.h` (D-048). Every `#define` is also kept verbatim so native bindings that use it still compile.
2. Parse with the tree-sitter devicetree grammar through `web-tree-sitter` (WASM, so it runs in bun without native modules). keymap-drawer uses the same grammar for the same job ([../research/prior-art.md](../research/prior-art.md)). Only the approach is borrowed, not keymap-drawer's code: it's Python, and it reduces bindings to display labels, dropping the parameters keyloom needs.
3. Map nodes to the IR ([02](02-layout-model.md)):
   - `keymap` → `layers`, one per child node. `bindings` become positions in order. `display-name` or the node name becomes the layer name.
   - `&kp X` → `key`. Modifier functions such as `LG(LS(A))` → `key` with `mods`. `&kp LALT` → `modifier`.
   - `zmk,behavior-hold-tap` nodes → `HoldTapProfile` (flavor, `tapping-term-ms`, `quick-tap-ms`, `require-prior-idle-ms`, `hold-trigger-key-positions`, `hold-trigger-on-release` and the rest, kept under their ZMK names). Each use, like `&hrm LGUI F`, becomes a `holdTap` binding referencing that profile. The built-ins `&mt` and `&lt` map to built-in profiles.
   - `&mo`, `&tog`, `&to`, `&sl` → `layer` with `momentary`, `toggle`, `to` and `oneShot`. `&trans` → `transparent`. `&none` → `none`.
   - `zmk,behavior-macro` → `Macro`. `zmk,combos` children → `Combo`, with `key-positions`, `bindings`, `timeout-ms` and `layers`. A combo with no `layers` is on every layer (D-048). A hold-tap, macro or combo with a property keyloom has no field for (`wait-ms`, `slow-release`, a non-`&kp` hold) is kept verbatim as a `Passthrough` block, and its uses are `native`.
    - Simple `zmk,behavior-tap-dance` nodes with one or two `&kp` actions become editable tap dances. Unsupported properties, child nodes, non-key actions or malformed cells keep the whole definition verbatim and its bindings native; the importer never drops the unsupported part.
    - Anything else, such as mod-morphs, sticky keys with options, RGB, Bluetooth and MoErgo's magic-layer behaviours, becomes a `native` binding with the source text as written. Behaviour definitions keyloom doesn't model become `Passthrough` blocks (D-024).
4. Report what was imported: layer count, binding counts by kind, and every `native` and `Passthrough` item, so BK can see what keyloom treats as opaque.

For the modelled rung-5 fixtures, import, generate and reimport gives identical IR ([13](13-roadmap.md)). That is not a universal editable-round-trip guarantee: generated helper behaviours, including custom encoder rotations, can reimport as opaque calls with preserved definitions. Use keyloom JSON exports when you need to retain their typed editing model. Whether the Layout Editor's export compiles unmodified against the pinned fork is spike S6.

## Generation writes `glove80.keymap` and `glove80.conf`

`src/firmware/zmk/generate.ts` renders the IR into the two files the MoErgo template's `config/default.nix` builds from:

- `glove80.keymap`: `#include`s, `behaviors` (one `zmk,behavior-hold-tap` node per `HoldTapProfile`, plus each macro), `macros`, `combos`, then `keymap` with one node per layer in order. Passthrough blocks go back at their anchors. Output is deterministic: stable ordering, fixed formatting and a header comment `Generated by keyloom from rev_… — edit in keyloom, not here`.
- `glove80.conf`: Kconfig settings from `FirmwareSetting`s where `firmware = 'zmk'`.

A hold-tap whose tap runs a macro gets a specialized behavior for its timing profile, macro and hold kind. Its `bindings` point to the hold behavior and the zero-parameter macro; the key invokes it with the hold value and a numeric zero, not a macro phandle in a parameter cell. Normal key taps keep their original profile. Generated labels avoid modeled and preserved labels. These helper definitions reimport conservatively as native behavior; they are not promised to become editable macro hold-taps on firmware-source reimport. Portable keyloom exports retain the modeled macro tap unchanged. The audit checked generation and import contracts, not a new hardware flash.

## Build runs the MoErgo template in Docker

keyloom keeps a build workspace per board at `$XDG_CACHE_HOME/keyloom/build/moergo-glove80/`. It's a checkout of `moergo-sc/glove80-zmk-config` at the pinned SHA. `keyloom build` writes the generated `config/glove80.keymap` and `config/glove80.conf` into it and runs the template's Docker route (D-036):

- The template's `Dockerfile` builds a `nixpkgs/nix` image that mirrors `moergo-sc/zmk`, and `build.sh <tag>` runs `nix-build config`. keyloom passes the pinned tag, never `main`.
- The output is one `glove80.uf2`: two images joined end to end (`combine_uf2`, `cat` of the left and right `zmk.uf2`).
- keyloom copies it to `$XDG_DATA_HOME/keyloom/artifacts/<build id>.uf2`, stores the full log at `logs/<build id>.log`, and records the build in `builds` ([02](02-layout-model.md#database)).
- **Failure handling.** If Docker isn't running, keyloom fails before starting with "Docker isn't running. Start Docker Desktop and run `keyloom build` again." A failed compile shows the last 40 lines of the log and the log path. If the error names a line in `glove80.keymap`, keyloom maps it back to the layer and position.

keyloom builds with its own lean image, `infra/glove80/Dockerfile`, not the template's. The Dockerfile is embedded in the binary and its base image is pinned by digest; the image tag names the firmware ref and a hash of the Dockerfile, so changing either builds a new image. The template's Dockerfile pre-builds four refs and ran out of space on BK's Docker disk. keyloom's image pre-builds only the pinned ref: the first image build takes 163 s at 5.22 GB, and each firmware build then takes 16–20 s (S7, [../research/spikes/S7.md](../research/spikes/S7.md)). `keyloom doctor` warns when Docker's VM has less than 15G free.

Rejected: building in MoErgo's cloud Layout Editor, because it needs an account, has unpublished build limits, and takes the build off BK's machine (D-028). Rejected: GitHub Actions in a user config repo, because it needs a repo and a push for every change and takes minutes per round trip.

## Emulate runs ZMK itself on the host, with a mock keyboard

`keyloom emulate <layout> --keys "<script>"` says what the keyboard would send for a sequence of key presses, without the keyboard ([10](10-cli.md#emulate-prints-what-a-layout-types-for-a-sequence-of-key-presses)). It runs ZMK itself (D-075): the layout's generated keymap is built for Zephyr's `native_posix_64` board, with a mock kscan that replays the key events, which is how ZMK's own test suite (`app/tests`) works. `src/firmware/zmk/emulate.ts` does it in the images the real builds use:

- **Corne and other upstream boards** build in ZMK's `zmk-build-arm` image, against the west workspace the real build keeps in `$XDG_CACHE_HOME/keyloom/build/<board>/`. Only a workspace that is missing or not at the pinned SHA runs `west update`.
- **Glove80** builds in the MoErgo image (`infra/glove80/Dockerfile`), inside the `nix-shell -A zmk` that image already has. Zephyr and the modules are in its Nix store, and so is the gcc that Nix's stdenv was bootstrapped with, which `native_posix_64` needs as a host compiler. The image needs no change.

What the generated source becomes (`src/firmware/zmk/emulate-keymap.ts`, D-076):

1. The keyboard is one row of N keys, so a keyloom position is a column and the board's wiring is out of the picture. A `zmk,matrix-transform` chosen in an appended overlay maps `RC(0,p)` to position p, so combos' `key-positions` and layer bindings mean what they do on the keyboard.
2. Bindings that need hardware the host lacks (`&bt`, `&out`, `&rgb_ug`, `&bl`, `&ext_power`, `&bootloader`, `&sys_reset`, `&soft_off`, `&studio_unlock`) or send mouse reports (`&mkp`, `&mmv`, `&msc`) are replaced with `&none`, wherever they appear: layers, macros, hold-tap bindings. Each replaced behaviour is a line in the result's `warnings`. Line breaks are kept.
3. Of the conf, only the settings that change what keys do (combo, macro, report-type and behaviour settings) are applied; the rest (sleep, Bluetooth power, the keyboard's name) are listed in `warnings`.

The firmware's debug log is the output (`src/firmware/zmk/emulate-log.ts`, D-077). ZMK logs each keycode it presses or releases, each change of the modifier byte (`Modifiers set to 0x02`, after implicit, explicit and masked modifiers are applied) and each report it sends (`zmk_endpoints_send_report: usage page 0x07`). The parser replays them with hid.c's own rules: six key slots filled first-free (or NKRO's usage-ordered bitmap when the conf selects it), a key pressed while already down released first, and a report recorded at each send. Each report differs from the last of its kind. A log with dropped lines or with fewer key events than were sent is refused rather than shown.

The mock's clock needs handling (D-078). Its delay for event k is the wait before event k+1, and the first event's delay is also used before the first event, so an unmapped event goes first and each event carries the gap to the next, less one tick because Zephyr adds one to a relative timeout. The binary runs with `-no-rt`, so the simulated clock runs as fast as the host can and times in the log are deterministic: a report's `at` is its log time minus the first key event's, so a hold-tap that decides on its 280 ms term reports at 281.

The container gets the native keymap and conf on standard input, builds in its own `/tmp`, and prints a marker line before running the binary; the output after it is the log (D-079). The saved log of a finished run is kept in `$XDG_CACHE_HOME/keyloom/emulate/<board>/runs/`, keyed by a hash of the firmware pin, image, scripts, native keymap and conf, so asking the same question twice answers in a fraction of a second. Measured on 2026-10-15 on an M-series Mac under Colima: about 7 s per Glove80 run and 25 s per Corne run once the image and workspace exist.

Not modelled: anything that needs a radio, LEDs or sleep, and mouse reports (the report contract has keyboard and consumer reports only). Key repeat is the host's and isn't simulated. QMK has its own emulator behind the same command ([05](05-firmware-qmk.md)).

## Flash copies the UF2 to each half's boot drive

Each half has a UF2 bootloader that appears as a USB drive: `GLV80RHBOOT` for the right and `GLV80LHBOOT` for the left. Both halves take the same combined file. MoErgo says to flash the right half first (D-038).

`keyloom flash [--build <id>]`:

1. Tell BK how to enter the bootloader on the right half. With the half off and USB connected, hold `I + PgDn` (default layout) and switch it on; a slowly pulsing red LED confirms it. On a running layout, `Magic + '` does the same. Instructions come from the board definition, so other boards can supply their own.
2. Wait for `/Volumes/GLV80RHBOOT` (macOS) or a mounted volume with that label (Linux, via `lsblk -o LABEL,MOUNTPOINT`). Poll every 500 ms for up to 120 s, and show progress in the web app and CLI.
3. Copy the UF2 to the volume, then `fsync`. Success is the volume disappearing within 30 s, because the bootloader unmounts itself after a good write. A volume that stays mounted fails the flash with the log, and so does a copy error while the volume is still there. A copy error after the volume has gone is taken as written, since a bootloader that reboots on the last block can take the drive away mid-close.

The mount root is a parameter (`--volumes-root`, default `/Volumes` on macOS), and every test passes a temporary directory: the test preload refuses to resolve the real root.
4. Repeat for the left half with `GLV80LHBOOT` (`Magic + E`, or `Magic + Esc` on running firmware).
5. Record the flash in `flashes`.

Whether both halves boot correctly from the combined file is spike S8. It's how MoErgo's own build works, but nobody has checked here how each bootloader skips the other half's blocks.

## Runtime updates through ZMK Studio are deferred

Status update, 2026-10-15: hands-free flashing for ZMK and the conditions for Studio live writes are in [17](17-keyboard-sync.md) (D-095, D-096).

ZMK Studio can change layer bindings on a running keyboard over USB or BLE. Its protocol is open protobuf, with an official MIT TypeScript client (`@zmkfirmware/zmk-studio-ts-client` 0.0.18). keyloom v1 doesn't use it (D-039):

- Studio can't change behaviour properties (so no hold-tap timing), macros or combos. Those are most of what BK's two problems touch (D-025).
- Once Studio manages a keymap, later `.keymap` changes are ignored until "Restore Stock Settings". Two sources of truth would fight.
- A stock MoErgo build most likely doesn't have Studio enabled, though that's untested.

It's deferred, not rejected. Instant binding swaps without a reflash would make trying a change much cheaper. It's listed after the car in [13](13-roadmap.md).

## Capabilities the agent is told about

Generated from this document into the agent's firmware context ([03](03-agent.md#what-the-agent-sees)):

- Hold-tap: four flavors (`hold-preferred` default, `balanced`, `tap-preferred`, `tap-unless-interrupted`), `tapping-term-ms` (200 by default), `quick-tap-ms`, `require-prior-idle-ms`, `hold-trigger-key-positions`, `hold-trigger-on-release`. A hold-tap's tap side may be any keycode, including one with modifiers.
- Opposite-hand-only holds for home row mods use `hold-trigger-key-positions` with the other hand's positions. The board definition says which positions belong to which hand.
- Macros (`zmk,behavior-macro`) with waits. Combos with `timeout-ms` and per-layer scope.
- Layer actions: momentary, toggle, to, one-shot (sticky layer).

## Conditional layers

A `zmk,conditional-layers` container is read into `Layout.conditionalLayers` and written back after the combos, children named from the condition ids and layers by current index. A child keyloom can't model (three or more `if-layers`, another property) is kept as written inside the generated container. See D-387.

## Keebart per-key lighting uses an external RGB matrix module

Status: implemented in the adapter, including effect preview on the half opposite lighting controls (D-463, D-464); hardware colour placement is pending.

`zmk-west-docker.rgbMatrix` pins the RGB engine and names its LED strip, physical layout, left-half LED count and brightness cap. `lighting.ledPositions` maps chain order to key positions. Generation writes one static overlay for each coloured layer, with a highest-active-layer condition and identical overlay order on both halves. Uncoloured layers show the fallback effect. Existing `&rgb_ug` controls target the new engine’s matrix or effect controller.

On a coloured layer whose recognised hue, saturation, speed or effect controls are all on one half, only that half receives the static colours. The other half previews the selected effect. Master power and brightness affect both halves. A layer with controls on both halves, or no recognised effect controls, keeps its full-layer colours. Import verifies this mask against the imported controls and also accepts earlier full-layer exports.

The Corne keeps ZMK v0.3.0; a compatibility header supplies the enabled-child count helper its Zephyr lacks. The keyloom module handles its switched LED supply. The original Glove80 recipe remains unchanged. [Usage, source provenance and verification](../issues/corne-per-key-rgb.md).
