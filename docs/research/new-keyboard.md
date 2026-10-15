# Connect a new keyboard and put my config on it

Researched 2026-10-15 for keyloom at `origin/main` 898dec6 (worktree `keyloom-uipolish`). BK's promise: "If I get a new keyboard I just connect it and say put my config on this. Doesn't matter what keyboard it is as long as it uses ZMK or QMK."

Every claim carries a tag. "verified" means I read the file at the named SHA or ran the command and read its output. "unverified" means it comes from memory, a README, or a guess, and says what would settle it.

## Short answer

QMK is close to solvable with no input from BK. A USB VID/PID lookup in QMK's own `usb.json` names the keyboard outright for about 73% of boards. Adding the USB product string and device version raises that to about 93%. Geometry, key count, bootloader and split flag all come from the same `info.json` the API serves.

ZMK is the hard half. Most ZMK boards share one VID/PID, the USB product string is the only fingerprint, and only 29 of 63 in-tree shields carry key geometry at all. A searchable list of boards and shields, like `zmk keyboard add`, is the dependable path. USB detection narrows the list.

Hands can be derived exactly (194 of 194 keys on BK's three boards). Fingers and thumbs can be derived for two of three boards. On the Corne the heuristic and the committed `board.json` disagree by one column, and one of them is wrong (see "Heuristics against BK's three boards").

The first flash of an unknown keyboard stays manual. keyloom's hands-free mechanisms only exist after keyloom's own firmware is on the board.

## Pinned sources

| Source | Ref | SHA or date |
| --- | --- | --- |
| `qmk/qmk_firmware` | master, shallow clone | `7a1bbf37c5c07da4ea0a162bb139083a46ef40a1` (commit date 2026-10-02) |
| QMK API | `keyboards.qmk.fm/v1/usb.json`, fetched 2026-10-15 | `last_updated` 2026-10-02 17:22:27 GMT |
| `zmkfirmware/zmk` | main | `4dd95d7840eb3d5a3f59bb29fbf1ab054715ef85` (2026-10-09) |
| `moergo-sc/zmk` | v26.09 | `ce69e85f585c724142aae37ddf8a7e019ff19e93` |
| `zmkfirmware/zmk-studio-messages` | main | `6cb4c283e76209d59c45fbcb218800cd19e9339d` |
| `vial-kb/vial-qmk` | vial | `dd43959ae5c08d8a28d38a1acf7b04e86b14a344` |
| `vial-kb/vial-gui` | master | `aef8222a2d0429a183b2ed692d5f9efcfd383f08` |
| `the-via/keyboards` | master | `9e3e9f4aa9f50f9439fdebc747560f51aaf109a0` (pushed 2026-09-22) |
| `caksoylar/keymap-drawer` | main | `e855a57cf6f5851b8235b56a69d46fa0646b26e8` |
| `zmkfirmware/zmk-cli` | main | README read through the GitHub API, no SHA recorded (pushed 2026-09-20) |

Analysis scripts are in `/private/tmp/claude-501/-Users-bhekanik-code-planetaryescape/68ff4156-2830-4f78-a296-386ecd17efda/scratchpad/nk/` (`vidpid.py`, `usbjson.py`, `prod.py`, `boot.py`, `heur.py`, `heur2.py`). Nothing was written to the keyloom repo.

I could not re-observe BK's keyboards this session. `ioreg -p IOService -r -c IOUSBHostDevice` returned no devices from this shell. Claims about BK's boards reuse the 2026-10-15 `ioreg` observations in `docs/research/handsfree-flash-all-boards.md`.

## What keyloom has today

- A board is `boards/<vendor>/<board>/board.json` plus `geometry.json`, embedded at bundle time (`src/boards/registry.ts:1-2`, verified). There is no user-local board directory. `loadBoardDir` reads any folder, but nothing scans one at start-up (verified, `src/boards/load.ts`).
- `board.json` holds hands, fingers, rows, mirror, revisions, a pinned source, a build recipe and a flash recipe (`src/boards/schema.ts`, `src/boards/recipes.ts`, verified). Build recipes are `qmk-docker`, `zmk-west-docker` and `zmk-moergo-template`. Flash recipes are `zapp`, `uf2-drives` (with optional `handsFree`) and `manual` (D-049, D-050, verified in `docs/blueprint/14-decision-log.md:227-234`).
- Detection today is one field: `revisions[].detect.usbProductId`. `attachedKeyboards` skips every non-QMK board, and `isKeyboard` hard-codes the ZSA vendor ID `0x3297` (`src/app/keyboard.ts:19-33`, `src/firmware/qmk/handsfree-flash.ts:37`, verified). It cannot recognise a keyboard it has no definition for.
- `listUsbDevices` returns vendor ID, product ID, product string, manufacturer and serial from `system_profiler` on macOS or sysfs on Linux (`src/firmware/toolchain/usb.ts:7-18`, verified). It does not return `bcdDevice`. Whether the macOS JSON carries it is unverified.
- QMK hands-free flashing is ZSA-only. It relies on Oryx defining `raw_hid_receive`, which keyloom wraps with `--wrap` (D-070, verified). A board without a raw HID endpoint has nothing to wrap.
- ZMK hands-free flashing is the vendored `keyloom-zmk` module with a 1200-baud touch (D-095, `HandsFreeSchema` in `src/boards/recipes.ts`, verified). It only works once keyloom's build is on each half.
- `keyloom boards list|show|check|geometry` and `serve --board-dev` exist (`src/cli/main.ts:127-190`, verified). `boards geometry` already generates `geometry.json` from a pinned QMK `keyboard.json` or ZMK `zmk,physical-layout` file.
- Rung 19's `map_keys` does not exist at 898dec6 (`grep` finds no hit in `src` or `docs`). I take its description from the brief: it maps by function and by hand, finger and row position.

## 1. Identifying a connected QMK keyboard

### The QMK API has a ready-made VID/PID index

`https://keyboards.qmk.fm/v1/usb.json` returns `{"usb": {vid: {pid: {keyboard: {pid, vid, device_version}}}}}` (verified, fetched 2026-10-15). `https://api.qmk.fm/v1/keyboards` lists 3760 keyboard names (verified). `https://keyboards.qmk.fm/v1/keyboards/<keyboard>/info.json` returns the resolved `info.json` for one keyboard, including `usb`, `layouts`, `processor`, `bootloader`, `development_board`, `split`, `manufacturer` and `keyboard_name` (verified for `crkbd/rev1`). `api.qmk.fm/v1/usb.json` and `api.qmk.fm/v1/keyboards/<kb>/info.json` return 404 (verified), so the data host is `keyboards.qmk.fm`.

The same data is in the repo: `usb.vid`, `usb.pid` and `usb.device_version` in `info.json`/`keyboard.json`, merged from parent folders down (`docs/reference_info_json.md`, verified). The legacy `VENDOR_ID` and `PRODUCT_ID` defines map to the same keys and are marked deprecated (`data/mappings/info_config.hjson:274-278`, verified). My merge of the repo found no keyboard that gets its IDs from `config.h` alone.

### How often a VID/PID pair is ambiguous

From `usb.json` (3760 keyboards, 786 vendor IDs, 3013 pairs, verified):

| Key | Unique keyboards | Note |
| --- | --- | --- |
| VID + PID | 2754 of 3760 (73%) | 259 pairs are shared, covering 1006 keyboards |
| VID + PID + `device_version` | 3158 triples, 195 still shared | |

From my own merge of `info.json`/`keyboard.json` at 7a1bbf3 (3700 keyboards that declare both IDs, verified; the 60-keyboard gap to the API is folders my walk does not count as keyboards):

| Key | Unique keyboards of 3700 |
| --- | --- |
| VID + PID | 2696 (73%) |
| + `keyboard_name` (the USB product string) | 3298 (89%) |
| + `manufacturer` | 3304 (89%) |
| + `device_version` | 3437 (93%) |

What remains is 263 keyboards in 110 groups. The biggest are variants of one board that differ by controller (`atreus/astar`, `atreus/feather`, `atreus/promicro`; `mechwild/sugarglider` and its `f401`/`f411` folders), or keyboards that copy another's name (verified from the group list). Whether the variants in a group share a physical layout is unverified. If they do, the ambiguity is harmless for geometry and matters only for the build target.

The worst offenders are the placeholder IDs. `0xFEED:0x0000` is shared by 175 keyboards, `0xFEED:0x6060` by 114, `0xFEED:0x6465` by 33 (verified). Those boards cannot be told apart by VID/PID alone, and the product string is the only help.

Across vendor/board folders (not revisions of one board), 47 pairs in `usb.json` cross top-level folders (verified).

### What the firmware tells us beyond USB descriptors

- The USB product and manufacturer strings are `keyboard_name` and `manufacturer` from `info.json` (`data/mappings/info_config.hjson:275-276`, `tmk_core/protocol/usb_descriptor.c:1187-1198`, verified). The serial is optional (`SERIAL_NUMBER` or the hardware ID, lines 53-61, verified).
- `QMK_KEYBOARD` is not in the descriptor. It is a build-time string used only by the `QK_MAKE` keycode to type a `qmk compile` command (`quantum/process_keycode/process_quantum.c:26-28`, verified). Nothing sends it over USB or raw HID.
- VIA's raw HID protocol has no name command. It reports protocol version, uptime, layout options, matrix state, a firmware version that defaults to `0x00000000`, and the QMK keycodes version (`quantum/via.c:301-370`, `quantum/via.h:50-52`, verified). VIA identifies a board by VID/PID against its definition repo.
- Vial puts the definition in the firmware. Command `0xFE 0x00` returns the Vial protocol version and an 8-byte keyboard UID, `0x01` returns the definition size, and `0x02` returns it in 32-byte pages (`vial-qmk@dd43959 quantum/vial.c:94-130`, verified). vial-gui decompresses it with `lzma` and reads `matrix.rows`, `matrix.cols` and `layouts.keymap` (`vial-gui@aef8222 src/main/python/protocol/keyboard_comm.py:114-163`, verified). A Vial board describes itself with no lookup.
- `the-via/keyboards@9e3e9f4` holds 2029 `v3/` and 1484 `src/` definitions (verified by tree listing). A definition has `name`, `vendorId`, `productId`, `matrix {rows, cols}` and a KLE `layouts.keymap` whose labels are `"row,col"` (verified for `v3/crkbd/crkbd.json`, Corne `0x4653:0x0001`).
- A raw HID probe is only useful if the firmware has a raw HID endpoint (usage page `0xFF60`, usage `0x61`). Stock ZSA firmware has Oryx's protocol on it, not VIA's (D-070, verified). Mainline QMK's `via.c` at 7a1bbf3 declares `id_bootloader_jump = 0x0B` in `via.h:65` but has no handler for it (`grep bootloader_jump quantum/via.c` returns nothing, verified). Vial's fork does handle it (`vial-qmk@dd43959 quantum/via.c:436-445`, verified). D-070's claim that VIA firmware can jump to the bootloader is true of Vial and unverified for mainline VIA.

### Vendor forks

- ZSA's IDs are all in upstream `usb.json`: VID `0x3297` has 7 PIDs and 7 keyboards, none ambiguous (`ergodox_ez/base 0x4974`, `glow 0x4976`, `shine 0x4975`, `zsa/moonlander 0x1969`, `planck_ez` `0xC6CE`/`0xC6CF`, `zsa/voyager 0x1977`; verified). Upstream lists one Moonlander at `0x1969`. keyloom's `revb` uses `0x1972` from ZSA's fork (`boards/zsa/moonlander/board.json:54`, verified), so upstream `usb.json` misses it. A vendor fork adds IDs that the API does not index.
- Keychron's VID `0x3434` has 102 PIDs and 103 keyboards in `usb.json`, one ambiguous pair (verified). Keychron keeps wireless features on its own fork branches (`bluetooth_playground`, `hall_effect_playground`, `2025q3` exist on `Keychron/qmk_firmware`, verified by branch listing). A Keychron board with a wireless-only feature cannot be built from mainline. Whether that matters per model is unverified.
- Rule that follows: VID/PID resolves to an upstream folder first. When the vendor has a known fork and the folder is missing or builds differently, keyloom needs a vendor table (VID to fork repo, branch). That table is data, one row per vendor, and is the only per-vendor knowledge in the design.

## 2. Identifying a connected ZMK keyboard

### What is shared and what is not

- ZMK defaults to VID `0x1D50`, PID `0x615E`, manufacturer "ZMK Project" (`zmk@4dd95d7 app/Kconfig:30-39`, verified). A board or shield config can override them. In-tree, only the Glove80 does: VID `0x16C0`, left PID `0x27DB`, right PID `0x27D9` (`app/boards/moergo/glove80/glove80_*_defconfig:10-11`, verified; matches BK's observed devices).
- The USB product string defaults to `ZMK_KEYBOARD_NAME` (`app/Kconfig:24-25`, verified). So do the BLE device name (`:27-28`) and the BLE model number (`BT_DIS_MODEL_NUMBER_STR`, `:45-46`), and the Studio `get_device_info` name (`app/src/studio/core_subsystem.c:25`, verified).
- `ZMK_KEYBOARD_NAME` has no default of its own. 76 files under `app/boards` set it (verified). The names are nearly unique in-tree: "ZMK Tester" appears three times and is the only repeat in the first 12 of the sorted list (partial check). A user can override it in `.conf`, and ZMK's own docs list it as a config option (`docs/docs/config/system.md`).
- On a split shield the name is set on the central half only. `corne/Kconfig.defconfig` sets `ZMK_KEYBOARD_NAME "Corne"` under `SHIELD_CORNE_LEFT` and nothing for the right half (verified). The right half's product string is therefore whatever an unset Kconfig string gives, which I have not observed. The Glove80 sets a name per half ("Glove80 Left", "Glove80 Right", verified).
- A keyloom build marker in the serial number identifies keyloom's own build and half, not the board (`src/firmware/zmk/handsfree.ts:28-34`, verified). It is useful only for boards keyloom already flashed.

So the product string is the fingerprint, and the VID/PID narrows nothing on a default build. A match is a candidate, not a certainty, because a custom config can rename the board.

### ZMK Studio can give geometry and the keymap, when it is on

The protocol (`zmk-studio-messages@6cb4c28`, verified):

- `core.get_device_info` returns `name` and `serial_number` (`proto/zmk/core.proto:23-26`).
- `keymap.get_physical_layouts` returns the active layout index and each layout's `name` and `keys`, where each key has `width, height, x, y, r, rx, ry` (`proto/zmk/keymap.proto:194-212`). These are the same hundredths-of-a-unit numbers as the devicetree.
- `keymap.get_keymap` returns layers with `name` and bindings as `behavior_id, param1, param2` (`:176-192`).
- It does not return hand, finger, matrix position, shield name or controller board.

Studio needs `CONFIG_ZMK_STUDIO=y` and the `studio-rpc-usb-uart` snippet, and it locks by default (`docs/research/handsfree-flash-all-boards.md`, verified there against `zmk-main@4dd95d7`). Of 63 in-tree shields with metadata files, 22 list `studio` as a feature (my count, verified for the checkout; some shields without metadata files are excluded). A stock community firmware often has Studio off. So Studio is a bonus when present and cannot be the plan.

### Split boards, shields and controllers

- ZMK hardware is described by metadata files, `{id}.zmk.yml`, with `id`, `name`, `type` (`board` or `shield`), `requires` (an interconnect such as `pro_micro`), `exposes`, `features` and `siblings` (`docs/docs/hardware-integration/hardware-metadata-files.md`, `schema/hardware-metadata.schema.json`, verified). `corne.zmk.yml` lists `siblings: [corne_left, corne_right]` and `requires: [pro_micro]`. A split shield and its two build targets come straight from `siblings`.
- At main there are 111 metadata files under `app/boards`: 68 shields and 38 boards, the rest other types (my count, verified).
- A "keyboard" is a shield plus a controller board that provides the `requires` interconnect, or a single board (Glove80). The controller is not visible over USB in normal operation. It is visible in bootloader mode: the nice!nano's bootloader drive is `NICENANO` with Board-ID `nRF52840-nicenano` (`docs/research/handsfree-flash-all-boards.md`, verified there at `bl-ada@c67f0bc`). Reading `INFO_UF2.TXT` from the drive is the cheap controller check. I did not read the file here.
- ZMK's own CLI, `zmk keyboard add`, already solves "choose a keyboard and, if needed, its controller" from a local copy of ZMK's metadata and adds the result to `build.yaml` (`zmk-cli` README, read through the API; the code is unread, so how it filters controllers is unverified). It is the model for the fallback.

### The realistic ZMK path

1. USB gives a product string and VID/PID. Match the string against a keyloom-built index of `ZMK_KEYBOARD_NAME` values from shields' and boards' `Kconfig.defconfig`, and against the metadata `name`.
2. If one candidate matches, propose it. If several or none match, show the searchable list of shields and boards.
3. BK picks the controller if the shield `requires` an interconnect. The bootloader drive's Board-ID (when BK has already double-tapped reset) selects it with no input.
4. Community shields and modules outside the ZMK tree are not in any central index. Handle them by letting BK paste a git URL and SHA for a module. That is the same field `board.json` already has (`source.repo`, `source.sha`) and is unverified as to how `zmk-west-docker` would pull an extra module.

BLE scanning could read the advertised name without a cable. On macOS that needs CoreBluetooth access from a CLI. I have not tested it and do not recommend it for the first version, because the USB product string carries the same value.

## 3. Physical layout, matrix and the rest of `board.json`

### Geometry is a data lookup

QMK: `layouts.<LAYOUT>.layout[]` has `matrix`, `x`, `y`, `w`, `h`, `r`, `rx`, `ry` for every key, in the order of the layout macro (`data/schemas/keyboard.jsonschema:455-466`, verified). That is what `keyloom boards geometry` already reads. `build.layoutMacro` has to name one of the layouts. The `info.json` can carry several (`community_layouts`, `layout_aliases`), with different key counts, so picking the one that matches the user's board is one decision (see "What BK confirms").

ZMK: the `zmk,physical-layout` node's `keys` are `<&key_physical_attrs w h x y r rx ry>`, in hundredths, listed in the same order as keymap bindings and matrix transforms (`docs/docs/hardware-integration/physical-layouts.md`, verified). The `keys` property is optional. It is required only for Studio. My count over the 63 in-tree shields with metadata: 29 contain `key_physical_attrs` or include a `layouts/` file (verified for this checkout, the pattern is a rough proxy). The other shields have a physical layout without key positions, or none. `app/dts/layouts` holds 49 shared layout files.

For a shield without in-tree geometry, keymap-drawer already solved the mapping: a lookup table from ZMK keyboard names to QMK keyboards or shared layouts (183 top-level entries in `resources/zmk_keyboard_layouts.yaml`, verified) and an `extra_layouts` folder of 49 files. It fetches QMK layouts from `keyboards.qmk.fm/v1/keyboards/{keyboard}/info.json` and ZMK shared layouts from raw GitHub (`keymap_drawer/physical_layout.py:30-33`, verified). Its licence has not been checked, so reuse the idea, not the file, until it is.

Matrix to position: a QMK key's position is its index in the layout macro, and `layout[i].matrix` gives `[row, col]` (verified in the API sample). That mapping is what lets keyloom read a VIA keymap (below). For ZMK the position is the index in the transform and in `keys`.

### Which `board.json` fields can be derived

| Field | Source | Confidence |
| --- | --- | --- |
| `firmware`, `name`, `vendor` | QMK `keyboard_name`, `manufacturer`; ZMK metadata `name` | exact |
| `keyCount`, `geometry.json` | layout macro or physical layout | exact, once the layout is chosen |
| `revisions[].source` | QMK mainline master SHA at fetch time, or the vendor fork; ZMK main SHA | exact, but a policy choice |
| `qmkTarget`, one revision per folder | `usb.json` and the API's keyboard list | exact when one folder matches |
| `build.kind: qmk-docker` fields | `layoutMacro`, `layoutFile` from the info files; `image` from keyloom's current pin | exact |
| `build.artifact` | from the bootloader: `rp2040`, `uf2boot`, `tinyuf2` give `uf2`; AVR gives `hex`; STM32 gives `bin` | derived, rule unverified against `qmk` |
| `build.submodules` | by platform (ChibiOS for ARM, LUFA for AVR; the Moonlander lists five) | unverified, needs a spike |
| `build.kind: zmk-west-docker` | `board` from the controller, `targets` from `siblings`, `keymapName` from the shield | exact once shield and controller are chosen |
| `flash` | from the bootloader (table below) | exact for UF2, `manual` for the rest |
| `detect.usbProductId` | the connected device | exact |
| `hands` | geometry | exact on BK's boards (below) |
| `fingers`, thumbs | geometry | heuristic (below) |
| `rows` (names) | geometry plus one question | the home row needs BK |
| `mirror` | pair each left key with the right key at the same height (D-060) | derivable by the same rule `test/boards/mirror.test.ts` uses; not tried |
| `importers` | `qmk-keymap` for QMK, `zmk-keymap` for ZMK | exact |
| `lighting`, `settingDefaults`, `display.rotate`, `SKILL.md` | not derivable | left out of generated boards |

Bootloader to flash method, by count of keyboards in the API's resolved data (`boot.py` over `keyboard.json` folders, 3760, verified; 726 leave `bootloader` unset because `development_board` supplies it, `docs/reference_info_json.md:34`):

| `bootloader` | Keyboards | keyloom flash today |
| --- | --- | --- |
| `atmel-dfu` | 1421 | `manual` |
| (unset, via `development_board`) | 726 | the board's resolved value, then as below |
| `stm32-dfu` | 604 | `manual` (Zapp is ZSA only) |
| `rp2040` | 319 | `uf2-drives` (D-050) |
| `caterina` | 197 | `manual` |
| `halfkay` | 99 | `manual` |
| `stm32duino` | 86 | `manual` |
| `qmk-dfu` | 73 | `manual` |
| `usbasploader` | 70 | `manual` |
| `bootloadhid` | 52 | `manual` |
| `wb32-dfu` | 38 | `manual` |
| `tinyuf2`, `uf2boot` | 15, 13 | `uf2-drives` |
| `lufa-ms`, `custom`, `lufa-dfu`, `kiibohd`, `gd32v-dfu`, `at32-dfu` | 13, 17, 10, 5, 1, 1 | `manual` |

The API's resolved `info.json` fills in the 726 (verified for `crkbd/rev1`: `development_board` plus `bootloader: caterina`, `processor: atmega32u4`). `qmk info -kb <name> -f json` does the same locally (`docs/cli_commands.md:308-337`, verified that the command exists; it was not run).

Only RP2040, tinyuf2 and uf2boot (347 of 3760, 9%) flash without a new recipe. The largest gaps are `atmel-dfu` (38%) and `stm32-dfu` (16%), then `caterina` (5%). Those need `dfu-util`, `dfu-programmer` or `avrdude` recipes. D-049 rejected a recipe that runs a command named in `board.json`, so the tools must be a fixed allowlist in code, with per-tool port discovery. Docker Desktop on macOS cannot pass USB through, so the flash tool runs on the host (unverified for these tools; it is why keyloom already flashes on the host with Zapp).

The QMK `Pro Micro` family (`development_board: promicro`, 485 keyboards, verified) is the biggest single controller group and uses Caterina, so `avrdude` support is worth more than its 5% bootloader share suggests.

### Heuristics against BK's three boards

QMK's own generator guesses hands from geometry for chordal hold: a symmetric layout splits at the layout midpoint, a layout with a spacebar uses a slanted line through it, and the fallback splits at the widest horizontal gap (`lib/python/qmk/cli/generate/keyboard_c.py:256-285`, verified). A key can carry `hand: L|R|*`, but no keyboard in the tree sets it (`grep '"hand"' keyboards` returns 0, verified). So QMK has no per-board hand data to read, and its own default is a heuristic.

I ran a prototype of the same ideas against the committed `board.json` and `geometry.json` of BK's three boards (`heur.py`, `heur2.py`; verified outputs):

- Hands, split at the widest gap between rotated key centres: Moonlander 72 of 72, Glove80 80 of 80, Corne 42 of 42. All 194 keys agree.
- Thumbs, found as keys in a column with fewer than three keys, or more than 1.2 units below the previous key in a column: 8 of 8, 12 of 12 and 6 of 6, with no false thumbs. The Moonlander's position 59 is labelled `left-thumb` in a `lower` row in the committed file, and the rule finds it.
- Fingers for non-thumb keys, with the middle finger on the column whose top key is highest (the stagger apex), ring one column outward, pinky for everything further out, index for everything inward, and ties resolved to the middle of the tied columns: Moonlander 64 of 64, Glove80 68 of 68, Corne 18 of 36.

The Corne disagreement is a systematic one-column shift. The geometry has the highest key at column 3 (`y` 0), with columns 0 and 1 at the same height (0.37). The committed file calls columns 0, 1, 2, 3 pinky, ring, middle, index. The apex rule calls them pinky, pinky, ring, middle. QMK's 5-column Corne has the apex at the third column (`y` 0.3, 0.1, 0, 0.1, 0.2 from `keyboards.qmk.fm/v1/keyboards/crkbd/rev1/info.json`, verified), and the 6-column layout adds an outer column, which moves the apex to column 3. On that evidence the committed Corne fingers are one column too far inward. This is not settled until BK looks at the Corne; the rule has also never been run on a board it was not tuned on. If the Corne file is wrong, it affects the agent's finger advice and not the build.

Rows: the heuristic cannot say which row is the home row. The Moonlander has `number, top, home, bottom, lower`; the Glove80 has `function, number, top, home, bottom, lower`; the Corne has `top, home, bottom` (verified in the committed files). One tap on the position overlay settles it.

### What BK confirms

- Which keyboard, when more than one candidate remains (the 7% that VID/PID, product string and device version leave ambiguous; most ZMK boards).
- The controller board for a ZMK shield, unless the bootloader drive already told us.
- Which layout, when `info.json` has several with different key counts.
- The home row.
- Thumbs and fingers: show the guess on the overlay, with ties and columns that disagree with the rule marked, and let BK correct them. The guess needs a visual check, not typing.
- That the board is his own and keyloom may flash it (the first-flash step below).

## 4. Reading the keyboard's current keymap

- Vial: the keymap and the layout travel together. `dynamic_keymap` reads give keycodes per layer, row and column, and the definition gives the matrix to position map (`vial-gui` `reload_keymap`, `keyboard_comm.py:196`, verified to exist; I did not read the body). Complete, but only on Vial firmware.
- VIA: `id_dynamic_keymap_get_buffer` (`quantum/via.c:455`, verified) returns `[layer][row][col]` as 16-bit keycodes, and `id_dynamic_keymap_get_layer_count` (`:451`) returns the layer count. Keycode numbering depends on the QMK keycodes version, reported by `id_keycodes_version` (`:360`, verified), and QMK ships versioned keycode tables (`data/constants/keycodes/keycodes_0.0.1_*.hjson`, `0.0.2`, verified). keyloom would map the numbers back to names with the table for the reported version. The matrix to position map comes from the info file's `layouts[].layout[].matrix`. Whether stock keyboards expose VIA is unverified per model. ZSA boards do not (Oryx protocol, D-070).
- ZMK Studio: `get_keymap` plus `get_physical_layouts` (above), when Studio is on. Behaviour IDs resolve through the behaviors subsystem (`behaviors_subsystem` in `app/src/studio/`, verified to exist; protocol details unread).
- Nothing otherwise. QMK without VIA, Vial or a keymap in the source offers no read path. The board's `default` keymap from the pinned tree is the stand-in, and keyloom's `qmk-keymap` and `zmk-keymap` importers can already read those source files (importer list in `src/boards/schema.ts`, verified).

The answer to "should keyloom start from BK's config mapped over, or from the board's current map?" is BK's config. The promise says "put my config on this". The current map is useful only as a reference to show what the keyboard did before, and as a rollback file, saved only when it can be read at no cost. Starting from the current map would mean building a way to read it on every board, and most boards cannot be read.

Since a QMK `default` keymap is one clone away, keyloom should build it first as a smoke test: it proves the pinned tree compiles for this board before BK's keymap is blamed for a failure.

## 5. Building and flashing an unknown board

### QMK build

The `qmk-docker` recipe already takes a repo, SHA, image, submodules, keymaps folder, layout macro, layout file and artifact (`QmkDockerBuildSchema`, verified). A mainline board needs no new build kind (D-049, verified). What changes is that these fields are generated, not written. The risk is the long tail. Keyboards that need vendor forks, extra submodules or community modules will fail to build from a generated recipe. The smoke build catches that.

### ZMK build

`zmk-west-docker` takes the controller (`board`), a `keymapName`, a physical layout path and one target per shield (`ZmkWestDockerBuildSchema`, verified). It builds against upstream ZMK at the pinned SHA, so a shield outside the tree needs a module. Modules are not supported by the recipe as written. The ZMK workspace is generated with a `west.yml` pinned to the board's ZMK SHA (D-049). Adding a `modules:` list is a recipe change, unverified as to size.

### First flash

An unknown keyboard runs someone else's firmware, so there is no keyloom marker, no wrapped `raw_hid_receive`, no `keyloom-zmk` module. Every route into the bootloader is the keyboard's own:

- QMK: a reset key, a bootmagic key, or a hole in the PCB. A Vial board in its unlocked state accepts `id_bootloader_jump` (`vial-qmk@dd43959 quantum/via.c:436-445`, verified). Mainline VIA does not handle it (above). So the first flash is manual for almost all QMK boards. keyloom shows the bootloader's own instructions, which `docs/flashing.md` gives per bootloader (verified).
- ZMK on nRF52: double-tap reset on a nice!nano, a key combo on the Glove80, or `&bootloader` on a layer. `&bootloader` is `zmk,behavior-reset` with `RST_UF2` in both of keyloom's pins (hands-free research, verified). Whether a given board's stock keymap includes it is unverified.
- Dual-half boards: each half needs its own cable and its own first flash. The relay (D-095) only helps once the left half runs the module.

The same instruction text feeds the existing `manual` flow, which already tells the person what to do and waits (`flash.kind: "manual"`, D-050).

### Extending hands-free to a new board

- ZMK nRF52 with an Adafruit-style UF2 bootloader: `keyloom-zmk` is already generic. A new board needs one `handsFree` block (`trigger`, `halves`, `serialMarker`, `serialTail`). The generator can write that block, because `serialMarker` is `usb-sn-override` for any board that does not provide its own serial function, and `halves` follows from `siblings`. The cost is one first flash per half by hand. Other bootloaders (tinyuf2, RP2040, STM32) need other magic values, and ZMK main's retention boot-mode path covers them (hands-free research, verified there).
- QMK: generic hands-free needs a raw HID endpoint to wrap. Boards with `RAW_ENABLE`, VIA or Vial have one. Boards without would need keyloom to add `RAW_ENABLE = yes` and its own `raw_hid_receive`, and that collides with VIA or Vial if either is on. This is unverified and is the largest unknown in this design. The marker also needs a serial number, and Oryx's 32-byte reply limit that bounded D-070's marker length is Oryx-specific. A fixed-width marker for other boards is untested.
- Without hands-free, the second and later flashes use the same manual step as the first. That still beats today, because the build, the config and the flash recipe come from the generated board.

## 6. Prior art

- QMK Configurator and the QMK API: pick a keyboard by name from the API's 3760, choose a layout, drop in keycodes, compile on QMK's server (`api.qmk.fm/v1` lists `compile`, `converters`, `keyboards`, `skeletons`, verified). It never talks to the keyboard. keyloom builds locally in Docker, so it needs the data (layouts, bootloader) and not the compile service.
- VIA and its definition repo: runtime keymap edits over raw HID, with definitions per VID/PID. 2029 `v3` definitions. It answers "what is this board" by lookup, and has no build step.
- Vial: the definition lives in the firmware, so no lookup is needed. It needs Vial firmware and gives live edits, tap dance, combos and key overrides (hands-free research, verified there). The cost is leaving ZSA's fork for the Moonlander.
- keymap-drawer: parses QMK JSON and ZMK keymaps and takes layouts from `info.json` or devicetree, with the ZMK name-to-layout table (above). It proves the QMK API plus devicetree route covers most ZMK keyboards, and its table is the fallback for shields with no geometry.
- ZMK Studio: runtime keymap edits and physical layouts over a CDC ACM or BLE link, only on firmware built for it (22 of 63 in-tree shields list the feature).
- `zmk keyboard add`: picks keyboard and controller from ZMK's metadata, and writes the build list. The model for the ZMK fallback.
- keymap-editor and `keymap-layout-tools`: geometry from a separate `info.json`. `docs/blueprint/04-boards-and-contributions.md` already rejects that for drift (D-045).

## Proposed rung: connect a new keyboard and put my config on it

This follows rung 19 (`map_keys`) and builds on rung 8's board format. It is a new rung; the roadmap numbers rungs through 18 and the brief says 19 is under way, so I leave the number to BK. It goes before any contributor-facing work, since BK's promise is about his own new keyboard, not about contributors.

Completion check before building: with a real unfamiliar keyboard plugged in and nothing else changed, run `keyloom connect`. Answer at most the questions listed under "What BK confirms". End with BK's layout on the keyboard and typing. State the keyboard and keyloom commit used.

### Detection flow

1. `keyloom connect` lists USB devices (existing `listUsbDevices`, extended with `bcdDevice` and the bootloader's volume name), serial ports (ZMK) and, when the device allows it, raw HID.
2. Each device is classified. A device that matches a shipped or user board by `detect`, marker or product string is known; keyloom reports it and stops here. A device in a known bootloader mode (STM32 `0483:df11`, a `RPI-RP2` or `NICENANO` volume, Caterina, HalfKay) gives the controller but not the keyboard; keyloom asks BK to unplug and replug normally. Anything else is a candidate.
3. QMK candidates: look up VID/PID in `usb.json`, then filter by product string against `keyboard_name`, manufacturer, and device version. Zero hits goes to the vendor-fork table and then to the searchable list of 3760 names. One hit goes to generation. Several hits go to the list, narrowed.
4. If raw HID answers `0xFE 0x00` (Vial), read the definition from the device and skip the lookup. If it answers the VIA protocol version, use the VIA definition's `name` to rank candidates.
5. ZMK candidates: match the product string against the index of keyboard names; if the device is `0x1D50:0x615E` with a string that matches nothing, go straight to the list. If Studio answers, use its name and its physical layouts as extra evidence.
6. BK confirms the keyboard in one prompt that shows the name, the vendor and the drawn layout.

### Board definition

7. A generator, say `keyloom boards add <qmk-name | zmk-shield+controller>`, writes a draft `board.json`, runs the existing geometry generation, and applies the heuristics for hands, thumbs, fingers and the mirror table. Its output goes into a user board directory that keyloom reads at start-up (the one structural change; today boards are embedded at bundle time). `boards check` runs on it before anything else.
8. The editor's position overlay (`serve --board-dev`) shows the drawn guesses. Ties, columns the rule marks as unsure, and the home row are marked. BK taps corrections.
9. A draft that BK confirmed and that passed a smoke build can be contributed as a pull request with the existing guide. That is optional.

### Mapping BK's config

10. Rung 19's `map_keys` maps BK's current layout onto the new board by function, then by hand, finger and row. It reports what it could not place (an 80-key layout onto 42 keys) and what it dropped. BK approves the report before a build. The mapped layout is a new layout file on the new board, so BK's source layout is untouched.
11. The mapping is only as good as `hands`, `fingers` and `rows`, which is why the heuristics' accuracy matters more than their cost.

### Build and first flash

12. Build the board's `default` keymap from the pinned tree as a smoke test, then BK's mapped layout.
13. The first flash uses the board's own bootloader entry, shown by the existing `manual` or `uf2-drives` flow with a wait for the drive or DFU device.
14. For ZMK nRF52 boards the build carries `keyloom-zmk` from the first build and the generated `handsFree` block, so this first flash is the last manual one. For QMK, hands-free is limited to boards with a raw HID endpoint and is a later step.
15. After flashing, keyloom checks for its marker and records the board as known.

### Hands-free afterwards

16. Known boards go through today's flow: restart into the bootloader, flash, verify the marker.

## Spikes on BK's three boards

Each spike has a pass condition. Run them with the keyboard plugged in and nothing flashed.

1. VID/PID lookup on the Moonlander. Read `vendorId`, `productId`, product string and serial through `listUsbDevices`. Expected: `0x3297:0x1969`, which `usb.json` maps to exactly one keyboard, `zsa/moonlander`. Pass if keyloom's lookup returns that name without using the shipped board definition.
2. Detection of a board that is not marked as keyloom's. The Moonlander currently runs a keyloom build with serial `keyloom/YRHRBG0T2H8R` (observed 2026-10-15, per the hands-free research). Run the lookup while ignoring the serial and the shipped `detect` field. Pass if VID/PID plus product string still name the board.
3. Glove80 product strings. Read both halves' VID/PID, product and manufacturer. Expected: `0x16C0:0x27DB` "Glove80 Left" and `0x16C0:0x27D9` "Glove80 Right" (matching the defconfigs). Then check what the product string matches in the ZMK name index. The pass condition is a unique candidate with no input, which would show product-string matching works for a board with its own VID/PID.
4. Corne product string, both halves. Read VID/PID, product, manufacturer for each half. Expected from source: left "Corne", right unknown. The pass condition is a unique candidate for the left half and a deliberate result for the right (unnamed or the same). Whether the right half's string is empty is the open question.
5. Corne controller. Double-tap reset, read `INFO_UF2.TXT` from the drive, and check the Board-ID against `nRF52840-nicenano`. This also settles the research's standing assumption that the controller is a nice!nano v2.
6. Raw HID probes on the Moonlander. Send the VIA protocol-version command and the Vial id command, and record whether the stock firmware answers either. The expectation is that neither does (Oryx firmware). The pass condition is a clean no-answer in under a second, with no side effects, so keyloom can probe unknown boards safely.
7. Studio on the Glove80 and Corne. Open the CDC port of a Studio-enabled build and call `get_device_info`, `get_physical_layouts` and `get_keymap`. Pass if the physical layouts match `geometry.json` for both boards. This also tests a bun serial transport, which is unverified.
8. Heuristics against ground truth. The prototype in `heur2.py` agrees with the committed fingers on Moonlander and Glove80. Look at the Corne, and decide whether its committed fingers or the heuristic is right. Run the heuristics on one board BK does not own (QMK `crkbd`, `ferris`, `planck/rev6`, a ZMK Kyria) and have BK judge the drawn guess. Pass if BK corrects fewer than five keys per board.
9. Generation round trip. Delete the Corne's `board.json` from a scratch copy and regenerate it from `foostan/corne` or `corne_left` plus nice!nano. Pass if `boards check` passes and the diff against the committed file is limited to the fields in "What BK confirms".
10. Build smoke on an unfamiliar QMK board. Generate a board for one RP2040 board and one Pro Micro board (flash `manual` and `uf2-drives`) and run the default keymap build. This measures how often a generated recipe builds with no submodule list written by a person.
11. Raw HID on a non-ZSA QMK board. If BK or the test bench has a board with VIA, verify that keyloom's `--wrap` approach (or another hook) can add a bootloader command without a VIA conflict. This decides whether QMK hands-free generalises.

## What stays manual

- Choosing among several candidate keyboards, when VID/PID and strings do not settle it.
- Choosing the controller for a ZMK shield, unless the bootloader drive was already seen.
- Confirming the drawn hand, finger, thumb and home-row guess.
- The first flash of every keyboard, including entering the bootloader, and for a split board each half.
- Any QMK or ZMK board that needs a vendor fork, a ZMK module outside the tree, or a bootloader keyloom cannot flash. For those, keyloom builds the file and hands over with the existing `manual` instructions.
- Flash tools for DFU, AVR, HalfKay and the rest of the long tail. Each is code with its own port discovery, and none is queued.
- Anything physical that firmware cannot report: where the reset button is, which half is plugged in, wireless pairing.

## Product check

The brief is a promise from BK, not a feature wished on him, so the problem is real. Two points need a decision before a build starts.

Fixing before adding: the Corne's committed fingers may be wrong now (one-column shift), and `isKeyboard` treats ZSA's vendor ID as the only one. Both are existing defects. The first needs a look at the board. The second blocks any non-ZSA detection.

The first version can be small. QMK RP2040 and UF2 boards and ZMK on nice!nano need no new flash recipe, and ZMK keeps hands-free flashing after the first flash. Which boards BK buys next is his call and I have no evidence either way. A DFU recipe for the 54% of QMK keyboards on `atmel-dfu` and `stm32-dfu` is a separate decision, since it is new code with port discovery per tool.

## Corrections to existing docs

- D-070 says VIA firmware can jump to the bootloader with `id_bootloader_jump` (0x0B). At qmk_firmware 7a1bbf3 `quantum/via.c` has no handler for it (the enum is in `via.h:65` only), and Vial's fork has one gated by unlock (`vial-qmk@dd43959 quantum/via.c:436-445`). The decision's reasoning holds either way, and its security note should say "Vial".
- The committed Corne `fingers` may be one column too far inward (above).

## Unresolved questions

- Is a user board directory acceptable, given that boards are a folder in this repo added by pull request (`docs/blueprint/04-boards-and-contributions.md`)? A generated board for BK's own use does not need a PR, but it changes where the format lives.
- Should keyloom pin new boards to mainline QMK master at connect time, or to the newest tag? Mainline moves daily and the Docker image digest must match.
- Does the Corne's right half expose a product string, and does it still carry `ZMK Project` as the manufacturer (spike 4)?
- Can `--wrap` be generalised to boards with VIA or Vial raw HID, or does QMK hands-free stay ZSA-only?
- Which fingers are right on the Corne?
- Does keymap-drawer's licence allow reusing its name-to-layout table? It sits in a repository with a `LICENSE` file that I did not read.
