# Vial: features, live-edit protocol and what keyloom should take

Reviewed on 2026-10-15 at vial-kb/vial-gui@aef8222a2d0429a183b2ed692d5f9efcfd383f08 (main, 2026-05-25), vial-kb/vial-qmk@dd43959ae5c08d8a28d38a1acf7b04e86b14a344 (branch `vial`, 2026-07-26), zmkfirmware/zmk@4dd95d7840eb3d5a3f59bb29fbf1ab054715ef85 (2026-10-09), zmkfirmware/zmk-studio-messages@6cb4c283e76209d59c45fbcb218800cd19e9339d.

Clones are in `/tmp/keyloom-refs/`. Paths below are relative to `src/main/python/` in vial-gui unless they start with `quantum/`, `keyboards/`, `builddefs/` or `util/` (vial-qmk).

Evidence labels: **observed** means I ran it or saw it in a browser. **source** means read in code at the pinned SHA. **docs** means read at get.vial.today on 2026-10-15. No Vial keyboard was connected, so nothing about the editor UI is observed. The UI steps are derived from source and the docs.

## Summary

- Vial is a QMK fork plus a Qt/Python GUI. The GUI talks to the keyboard over a 32-byte raw HID channel. Every key assignment is one `0x05` packet that the firmware writes to EEPROM at once. There is no build and no flash.
- Flashing happens once: to get Vial firmware onto the board. After that, the keymap, macros, tap dances, combos, key overrides, QMK settings and RGB are all live.
- The keyboard describes itself. The firmware stores an LZMA-compressed JSON (KLE layout plus matrix) and the GUI downloads it. No per-keyboard GUI data is needed.
- vial-qmk already contains a Moonlander Vial keymap. keyloom can build it with the same Docker flow it uses for ZSA's fork, and can speak the protocol from a browser over WebHID.
- ZMK Studio is the ZMK equivalent, but it only edits key bindings, layer names and layer order. It cannot edit combos, macros or tap-dance timing live.

## Feature table

| Area | Feature | How it works (UI steps) | Source |
|---|---|---|---|
| Connection | Device discovery (desktop) | Vial lists raw-HID devices whose USB serial contains `vial:f64c2b3c` (set by `-DSERIAL_NUMBER` in the build). Bootloader devices carry `vibl:d4f8159c`. The raw HID interface is usage page `0xFF60`, usage `0x61`. | source: `util.py:20-23`, `util.py:70-120`; `builddefs/build_vial.mk:15` |
| Connection | Web version | vial.rocks is the same Python GUI compiled to WebAssembly, with a JS bridge for WebHID. WebHID hides the serial number, so the GUI sends a Vial "get keyboard id" packet and treats a non-zero UID as a Vial board. | source: `hidproxy.py:6-45`, `webmain.py:1-75`. observed: page asks `requestDevice({filters:[{usagePage:0xFF60,usage:0x61}]})` (page source, 2026-10-15) |
| Connection | Landing page | A grey page with one "Start Vial" button. After the click it shows "Requesting device list..." and waits for the browser's WebHID chooser. Headless Chrome cannot show the chooser, so the editor never loaded. | observed: `vial/01-landing.png`, `vial/02-after-start.png` |
| Connection | VIA keyboards | "File > Download VIA definitions" fetches a JSON stack of VIA keyboards. "Sideload VIA JSON..." loads one file. "Load dummy JSON..." opens a fake keyboard with no device. All three are hidden in the web build. | source: `main_window.py:162-185, 353-381` |
| Keymap | Select key, pick keycode | Click a key in the top keyboard drawing. Click a keycode in the lower tabbed palette. The GUI sends the keycode at once and moves the selection to the next key. | source: `editor/keymap_editor.py:191-202, 220-234`; `widgets/keyboard_widget.py:489-512` |
| Keymap | Palette tabs | Basic, ISO/JIS, Layers, Quantum, Backlight, App/Media/Mouse, MIDI, Tap Dance, User, Macro. Tabs with no usable keycodes for this firmware are hidden. | source: `tabbed_keycodes.py:162-186, 200-210` |
| Keymap | Basic tab shapes | The Basic tab draws a mini ANSI 100%, 80% or 70% keyboard, whichever fits the window width. Other tabs are flat button grids. | source: `tabbed_keycodes.py:81-135, 163-168` |
| Keymap | Any keycode | Click "Any" in the Basic tab, or double-click a key. A dialog takes a QMK expression such as `LCTL_T(KC_A)`, `MT(MOD_LCTL\|MOD_LSFT, KC_A)`, `TD(3)` or `0x56F2`, and shows the computed hex value. Evaluated with `simpleeval`. | source: `any_keycode_dialog.py:8-55`; `any_keycode.py:12-118`; `widgets/keyboard_widget.py:533`. docs: manual/any-key |
| Keymap | Masked keycodes (mod-tap, layer-tap, mod+key) | Pick the outer keycode, for example `LCtl_T(kc)`. The key now shows two zones. Click the inner zone and the palette switches to basic keycodes only. Click the key to put inside. | source: `keycodes/keycodes.py:377-414`; `widgets/keyboard_widget.py:479-495`; `editor/keymap_editor.py:236-242`; `tabbed_keycodes.py:228-284` |
| Keymap | Layers | A row of numbered buttons above the keyboard switches the layer being edited. Layer keycodes (`MO`, `DF`, `PDF`, `TG`, `TT`, `OSL`, `TO`, `LT0..15(kc)`, Layer Lock) are generated per layer count. The count is fixed in firmware. There is no add, remove or rename. | source: `editor/keymap_editor.py:81-103`; `keycodes/keycodes.py:856-915` |
| Keymap | Zoom | "+" and "-" buttons scale the keyboard drawing. | source: `editor/keymap_editor.py:97-110` |
| Keymap | Layout options | Keyboards with option groups (for example ISO or ANSI Enter) get a Layout tab with checkboxes and dropdowns. A change is written as a VIA "layout options" value and redraws the keyboard. | source: `editor/layout_editor.py`; `protocol/keyboard_comm.py:333-337`; `quantum/via.c:282-292` |
| Keymap | Host layout override | Menu "Keyboard layout" relabels keys for QWERTZ, AZERTY, Dvorak and many more, only in the GUI. | source: `main_window.py:199-213`; `keymap/*.py` |
| Keymap | Encoders | Encoders appear as two extra keys (CW, CCW) per encoder on each layer. Written with `vial_set_encoder`. Needs `ENCODER_MAP_ENABLE` in firmware. | source: `protocol/keyboard_comm.py:218-223, 323-331`; `quantum/vial.c:129-145` |
| Macros | Macro tabs | "Macros" tab shows M0..M15. Each has rows of actions: Text, Down, Up, Tap, Delay (ms, up to 64000). Rows can be reordered with arrows and removed with "x". | source: `editor/macro_recorder.py:69-102`; `macro/macro_line.py:14-25, 41-44`; `macro/macro_action_ui.py:152-183` |
| Macros | Add, Tap Enter, JSON editor | "Add action" adds a Text row. "Tap Enter" adds a Tap Enter row. "Open Text Editor..." edits the macro as JSON like `["text","hello"]`. | source: `macro/macro_tab.py:48-61, 89-90, 122-157` |
| Macros | Recorder | "Record macro" offers "Append to current" and "Replace everything", then "Stop recording". Merges key down/up pairs into taps. Only on Linux and Windows. The class is not loaded on macOS or web. | source: `editor/macro_recorder.py:32-42`; `macro/macro_tab.py:33-46`; `macro/macro_optimizer.py:5-30` |
| Macros | Save model | Edits are local until "Save" (enabled only if changed and it fits). "Revert" reloads from the keyboard. A tab title gets `*` when unsaved. Memory used is shown as `n/total`. Save triggers the unlock dialog. | source: `editor/macro_recorder.py:147-181` |
| Macros | Storage | One NUL-separated byte buffer. Text is raw UTF-8. Keys use prefix `0x01` plus action, `0x05..0x07` for 2-byte keycodes, and delay as `0x01 0x04 lo+1 hi+1`. Written in 28-byte chunks. | source: `macro/macro_action.py:7-15, 73-87, 145-149`; `protocol/macro.py:168-176`; `protocol/constants.py:55` |
| Tap dance | Entries | "Tap Dance" tab shows numbered entries (`TD(n)`). Each has On tap, On hold, On double tap, On tap+hold keycode pickers and a Tapping term (ms, 0 to 10000). | source: `editor/tap_dance.py:44-66` |
| Tap dance | Write model | Changing a key writes all entries at once. Changing the tapping term only marks the tab `*` and enables "Save". "Revert" reloads. | source: `editor/tap_dance.py:140-175` |
| Tap dance | Using it | A note on the tab says "Use TD(n) to set up this action in the keymap". Go to Keymap, select a key, open the "Tap Dance" palette tab, click `TD(n)`. | source: `editor/tap_dance.py:37`; `keycodes/keycodes.py:900-903` |
| Combos | Entries | "Combos" tab: up to 4 input keycodes plus one output keycode per entry. Each key picker opens the palette tray. No save button, every change writes. Triggers on keycodes, not matrix positions. | source: `editor/combos.py:34-69, 111-113`; `protocol/combo.py:24-35`; `quantum/vial.c:268-285, 466-484` |
| Key overrides | Entries | "Key Overrides" tab: enable, 16 layer checkboxes, trigger key, trigger/negative/suppressed modifiers (8 checkboxes each), replacement key, six option checkboxes. Writes on every change. | source: `editor/key_override.py:166-259, 297-299`; `quantum/vial.h:159-180` |
| Alt Repeat Key | Entries | "Alt Repeat Key" tab: keycode, alt keycode, allowed mods, options (default to this alt key, bidirectional, ignore mod handedness). | source: `editor/alt_repeat_key.py`; `quantum/vial.h:203-217` |
| QMK settings | Tabs | Magic, Grave Escape, Tap-Hold, Auto Shift, Combo, One Shot Keys, Mouse keys. Tap-Hold has Tapping Term, Permissive Hold, Hold On Other Key Press, Retro Tapping, Quick Tap Term, Chordal Hold, Flow Tap, tap-code delay. All global, not per key. | source: `src/main/resources/base/qmk_settings.json`; `editor/qmk_settings.py:97-119, 138-173` |
| QMK settings | Write model | Edits are local. Changed tabs get `*`. "Save" writes every changed setting. "Undo" reverts unsaved edits. "Reset" asks, then restores firmware defaults. | source: `editor/qmk_settings.py:185-228` |
| Lighting | Three drivers | The keyboard's JSON `lighting` field picks the panel: `qmk_backlight`, `qmk_rgblight`, `qmk_backlight_rgblight` or `vialrgb`. VialRGB has brightness, speed, effect list and a colour picker, from `get_supported`. | source: `protocol/keyboard_comm.py:230-285, 339-364, 523-542`; `editor/rgb_configurator.py:161-447` |
| Lighting | Live, then save | Changes use the `*_noeeprom` firmware calls, so they apply but do not persist. A "Save" button sends `id_lighting_save`. | source: `quantum/via.c:326-374, 499-651`; `editor/rgb_configurator.py:384-413` |
| Matrix tester | Live key state | "Matrix tester" tab draws pressed keys in real time by polling the matrix every few ms. Needs unlock because it is a keylogger risk. Hidden when `(cols/8+1)*rows > 28`. | source: `editor/matrix_test.py:62-66, 78-140`; `quantum/via.c:250-256` |
| Files | Save and load layout | File menu "Save current layout..." (Ctrl+S) writes a `.vil` JSON: layout, encoders, layout options, macros, tap dance, combos, key overrides, alt repeat, QMK settings, protocol versions and the keyboard UID. "Load saved layout..." (Ctrl+O) replays it, warning if the UID differs. | source: `main_window.py:154-160, 244-283`; `protocol/keyboard_comm.py:369-440`; `editor/keymap_editor.py:133-145` |
| Security | Unlock | "Security > Unlock" (Ctrl+U) shows a dialog with the keyboard drawing and the keys to hold. The keyboard counts 50 polls of 100 ms (5 s) while all keys are held. Needed for macros, bootloader jump, matrix tester and `QK_BOOT`. | source: `unlocker.py:13-125`; `quantum/vial.c:27, 162-193` |
| Security | Lock, reboot | "Lock" (Ctrl+L) relocks. "Reboot to bootloader" (Ctrl+B) unlocks then sends the VIA bootloader-jump command. Hidden for devices already in a bootloader. | source: `main_window.py:187-197, 399-410`; `quantum/via.c:434-448` |
| Firmware | Firmware updater | "Firmware updater" tab flashes a `.vfw` to boards that run Vial's own bootloader (VIBL, STM32 only). Not used on boards with ST's DFU bootloader such as the Moonlander. | source: `editor/firmware_flasher.py:41-98, 167-170`; `util/vial_generate_vfw.py`. The Moonlander bootloader is `stm32-dfu`: `keyboards/zsa/moonlander/keyboard.json:176` |
| Misc | Themes, about | Theme menu (restart needed), "About keyboard" shows the definition. | source: `main_window.py:221-243, 416-424` |
| Misc | Undo | There is no global undo. The only undo is the QMK settings tab. Recovery is the `.vil` file. | source: grep for "undo" finds only `editor/qmk_settings.py:110` |

## Live-edit protocol

The mechanism is simple enough to reimplement in an afternoon.

### Transport

- Raw HID, 32-byte packets, usage page `0xFF60`, usage `0x61`. Every request is answered with a 32-byte reply in the same buffer. (source: `util.py:25, 40-67`; `quantum/vial.h:26`)
- The GUI retries up to 20 times with a 0.5 s pause and a 500 ms read timeout. (source: `util.py:40-67`)
- Byte 0 is the command. `0xFE` is the Vial prefix and byte 1 is then a Vial command. All other commands are VIA's. (source: `quantum/via.c:449-452`)
- VIA protocol version is `0x0009`. Vial protocol version is `6`. The GUI accepts Vial 0 to 6. (source: `quantum/via.h:42`; `quantum/vial.h:25`; `protocol/keyboard_comm.py:27-28`)

### Connect sequence

1. `0x01` get VIA protocol version.
2. `0xFE 0x00` get keyboard id: 4 bytes Vial protocol, 8 bytes UID, byte 12 set if VialRGB.
3. `0xFE 0x01` get definition size, then `0xFE 0x02 <page u16>` pages of 32 bytes. LZMA-decompress, parse JSON. (source: `protocol/keyboard_comm.py:114-146`; `quantum/vial.c:94-128`)
4. `0x11` get layer count. `0x12` read the keymap buffer in 28-byte chunks (`layers * rows * cols * 2` bytes, big endian). (source: `protocol/keyboard_comm.py:101-104, 196-216`)
5. Macros: `0x0C` count, `0x0D` buffer size, `0x0E` read chunks.
6. `0xFE 0x09` QMK settings query, then `0x0A` get per id.
7. `0xFE 0x0D 0x00` returns the number of tap dances, combos, key overrides and alt repeat entries, plus feature bits (Caps Word, Layer Lock). Then get each entry. (source: `quantum/vial.c:229-245`; `protocol/dynamic.py:11-46`)

### The write that makes it live

`0x05 <layer> <row> <col> <keycode u16 big endian>`. The firmware calls `dynamic_keymap_set_keycode`, which updates EEPROM at `base + layer*rows*cols*2 + row*cols*2 + col*2`. The matrix scan reads the keymap from EEPROM-backed storage, so the next keypress uses the new value. No reboot. (source: `quantum/via.c:296-305`; `quantum/nvm/eeprom/nvm_dynamic_keymap.c:77-100`; GUI side `protocol/keyboard_comm.py:313-321`)

The GUI skips the write if the keycode did not change (`keyboard_comm.py:315`). It also keeps a local copy of the whole keymap, so the display never reads back from the keyboard after connect.

Other writes follow the same pattern:

| Command | Packet | Gate |
|---|---|---|
| Encoder | `0xFE 0x04 layer idx dir keycode` | `QK_BOOT` blocked while locked |
| Tap dance | `0xFE 0x0D 0x02 idx <5 x u16 LE>` | `QK_BOOT` blocked while locked |
| Combo | `0xFE 0x0D 0x04 idx <5 x u16 LE>` | same |
| Key override | `0xFE 0x0D 0x06 idx <10 bytes>` | same |
| Alt repeat | `0xFE 0x0D 0x08 idx <6 bytes>` | same |
| QMK setting | `0xFE 0x0B <qsid u16> <value>` | none |
| Macro buffer | `0x0F offset size data` | needs unlock (`quantum/via.c:400-411`) |
| Layout option | `0x03 0x02 <u32>` | none |
| RGB | `0x07 ...` then `0x09` save | none |

After each tap dance, combo or key override write the firmware calls a `reload_*` function, so the change takes effect without a reboot. (source: `quantum/vial.c:255-326`)

### What the firmware refuses

- `QK_BOOT` cannot be assigned to a tap dance, combo, key override or alt repeat while locked (`vial_keycode_firewall`, `quantum/vial.c:80-84`). The GUI unlocks first if you assign it (`keyboard_comm.py:316-317`).
- While an unlock is in progress, all commands except id, size, definition and the unlock calls are dropped. (`quantum/via.c:215-224`)
- Matrix state is never served while locked, even if `VIAL_INSECURE` is set. (`quantum/via.c:250-256`; docs: security)
- Macro writes and the bootloader jump need unlock. (`quantum/via.c:400-411, 434-448`)
- Changing the keymap, combos and so on does not need unlock. A malicious host can therefore rewrite the keymap. Vial accepts that risk and protects only the firmware and macros. (source: absence of a gate in `quantum/via.c:302-304`)

### Keyboard definition

- Authors write `vial.json`: matrix size, a KLE-style `layouts.keymap` where each key's label is `"row,col"`, optional `layouts.labels` for options, `lighting`, `customKeycodes`, and a `vial` block for `vibl` and `midi`. (source: `protocol/keyboard_comm.py:150-187`; `keyboards/zsa/moonlander/keymaps/vial/vial.json`)
- At build time `util/vial_generate_definition.py` minifies the JSON, compresses it with LZMA and emits a C array in flash. (source: `util/vial_generate_definition.py:11-25`; `builddefs/build_vial.mk:35-39`)
- The GUI sends no JSON to the keyboard. It reads it. That is why one GUI works for every board.

### What is stored in EEPROM

In order, from `quantum/nvm/eeprom/nvm_dynamic_keymap.c:42-103`:

1. QMK `eeconfig`, then VIA/Vial magic and layout options.
2. The keymap: `layers * rows * cols * 2` bytes.
3. Encoder map: `encoders * layers * 4` bytes.
4. QMK settings struct.
5. Tap dance entries (10 bytes each), combos (10), key overrides (10), alt repeat (6).
6. The macro buffer, which takes all remaining bytes up to `TOTAL_EEPROM_BYTE_COUNT - 1`.

### Limits

- Layers: `DYNAMIC_KEYMAP_LAYER_COUNT`, default 4, max 32. The Moonlander sets 8 in `keyboard.json:34-36`. (`quantum/dynamic_keymap.h:25`; docs: firmware-size)
- Macros: `DYNAMIC_KEYMAP_MACRO_COUNT`, default 16. Text length is bounded only by the leftover EEPROM. (`quantum/dynamic_keymap.h:29`)
- Tap dance, combo, key override, alt repeat entries: 4, 8, 16 or 32 depending on EEPROM size. Over 4000 bytes gives 32. (`quantum/vial.h:81-91, 111-121, 147-157, 191-201`)
- A combo has at most 4 input keys. A tap dance has 4 actions and one timing. (`quantum/vial.h:93-99, 123-126`)
- The Moonlander uses a 24LC128 I2C EEPROM, 16384 bytes. That gives 32 of each dynamic entry. (`keyboards/zsa/moonlander/config.h:25`; `platforms/eeprom.h:38-50`; `drivers/eeprom/eeprom_i2c.h:47-51`) I did not compute the exact macro bytes left.

## Click counts

Counts are mouse clicks from a connected, unlocked Vial editor on the Keymap tab. Typing is not counted. They come from reading the code, not from using the app. Physical key presses for unlock are listed separately.

| Task | Steps | Clicks |
|---|---|---|
| (a) Mod-tap: hold Ctrl, tap A | 1. Click the key. 2. Click the "Quantum" tab. 3. Click `LCtl_T(kc)`. The selection jumps to the next key, so: 4. click the inner zone of the original key. 5. Click `A` in the basic palette (Basic tab is the default there). | 5 |
| (a) Mod-tap via Any | Click the key, click "Any", type `LCTL_T(KC_A)`, click OK. | 3 |
| (b) Three-key macro, typed text `abc` | 1. Macros tab. 2. Add action. 3. Click the text field and type. 4. Save. Hold the unlock keys for 5 s. 5. Keymap tab. 6. Click the key. 7. "Macro" palette tab. 8. Click `M0`. | 8 plus a 5 s hold |
| (b) Same with Tap actions | Add action, change the row type to Tap (2 clicks), then for each of 3 keys: click "+", click the new slot, pick the key. Then Save and assign as above. | about 18 plus the hold |
| (b) Same with the recorder (Linux, Windows only) | Macros tab, Record macro, Replace everything, press keys, Stop recording, Save, then assign as above. | 9 plus the hold |
| (c) Tap dance: tap Esc, double tap Caps Lock | 1. Tap Dance tab. 2. Click "On tap" picker, 3. pick Escape. 4. Click "On double tap" picker, 5. pick Caps Lock. Each pick writes at once. 6. Keymap tab. 7. Click the key. 8. "Tap Dance" palette tab. 9. Click `TD(0)`. No unlock. | 9 |
| (d) Combo of two keys | 1. Combos tab. 2. Click Key 1, 3. pick. 4. Click Key 2, 5. pick. 6. Click Output, 7. pick. Each pick writes at once. Nothing to assign on the keymap. No unlock. | 7 |

Observations on these numbers:

- Straight remaps are the strength. Two clicks, live, with auto-advance to the next key.
- Mod-tap is awkward because the selection leaves the key after the outer pick (`editor/keymap_editor.py:202`). Users must click the inner zone.
- Macros are the slowest path because of Save plus the physical unlock.
- Tap dance costs the most clicks of the four because it is created in one tab and assigned in another.

## ZMK Studio

Status and facts below are from ZMK docs and source at the pinned SHAs. The existing note `docs/research/zmk-and-glove80.md` covers the same ground with more detail on Glove80.

### What it is

- ZMK's runtime keymap editor. Web app at https://zmk.studio (Chrome/Edge) and native apps for Linux, macOS and Windows. (docs: `docs/docs/features/studio.md:9-60`)
- The protocol is protobuf over a framed byte stream. Framing bytes: SOF `0xAB`, ESC `0xAC`, EOF `0xAD`. (source: `zmk/app/src/studio/msg_framing.h:19-21`)
- Transports are a serial port (CDC-ACM over USB, selected by the `zmk,studio-rpc-uart` chosen node) and a custom BLE GATT service. (source: `app/src/studio/Kconfig`, `gatt_rpc_transport.c`, `uart_rpc_transport.c`)
- Messages live in `zmkfirmware/zmk-studio-messages` (`proto/zmk/*.proto`). The README says the transport is not yet documented there. A TypeScript client exists: `@zmkfirmware/zmk-studio-ts-client`.

### What it can change live

From `proto/zmk/keymap.proto` at `6cb4c283`:

- `get_keymap`, `set_layer_binding` (layer id, key position, behavior id and two params).
- `save_changes`, `discard_changes`, `check_unsaved_changes`. Edits are staged, then saved to flash settings. This differs from Vial, where each write is already persisted.
- `get_physical_layouts` and `set_active_physical_layout`.
- `move_layer`, `add_layer`, `remove_layer`, `restore_layer`, `set_layer_props` (rename).
- `core`: device info, lock state, lock, reset settings. `behaviors`: list behaviours and their metadata.

Docs capability table (`studio.md:17-40`): supported are keymap edits while in use, USB and BLE (BLE only on Linux web and native apps), predefined and user-defined behaviours on keys, alternative physical layouts, layer rename and enabling extra layers. Planned: behaviour properties, tap-dance and macro configuration, combos, conditional layers, import and export, locale. Low priority: encoders. Not planned: new behaviours, new physical layouts, more layers than devicetree declares.

### Constraints

- The keyboard must have a `&studio_unlock` binding. Studio can only write while unlocked. Unlock times out after 600 s idle by default, and locks on disconnect. (docs: `studio.md:45`; source: `app/src/studio/Kconfig` `ZMK_STUDIO_LOCK_IDLE_TIMEOUT_SEC default 600`, `ZMK_STUDIO_LOCK_ON_DISCONNECT default y`; `rpc.c:47` returns UNLOCK_REQUIRED)
- Firmware must be built with snippet `studio-rpc-usb-uart` and `CONFIG_ZMK_STUDIO=y`. On split boards, only on the central half. (docs: `studio.md:78-100`)
- Extra layers must be pre-declared in devicetree with `status = "reserved"`. (docs)
- Once Studio edits the keymap, `.keymap` changes are ignored until "Restore Stock Settings". (docs: `studio.md:45-55`)
- Needs much more RAM. Some MCUs, such as the STM32F072, need tuning. (docs: `studio.md:181`)

### Boards

- In-tree boards declaring `studio` in `*.zmk.yml` include Glove80, Kinesis Adv360 Pro, Nice60, Corne, Lily58, Sofle, Kyria, Cradio, Jorne and others (source: `grep studio app/boards/**/*.zmk.yml` at `4dd95d78`, about 35 files).
- **Glove80:** `app/boards/moergo/glove80/glove80.zmk.yml` lists `studio` under `features`. MoErgo's own template build does not enable it by default, and MoErgo's docs do not mention Studio (see `docs/research/zmk-and-glove80.md` lines 90-92). Whether a stock MoErgo build connects to Studio is untested.

## Feasibility for keyloom

### (a) Can keyloom speak Vial's protocol to a Vial keyboard?

Yes. Evidence:

- The whole protocol is 32-byte packets with fixed offsets, visible in about 700 lines of GUI code (`protocol/*.py`). It has been stable: Vial protocol 6, VIA 9.
- The browser can do it. vial.rocks itself uses WebHID with the filter `{usagePage: 0xFF60, usage: 0x61}` (observed in the page source). keyloom's React editor can use `navigator.hid` the same way. It needs Chrome or Edge and a secure context, and `localhost` counts.
- A bun CLI can use `node-hid` or similar for the same device. Keep the codec pure and the transport swappable, so both the web page and the CLI share it. (This matches keyloom's "every feature is in the CLI" rule.)
- LZMA is needed to read the definition. Use a JS LZMA decoder (an `xz`/LZMA-alone decoder from npm, or `lzma-js`). I did not test one against a real definition.
- Keycodes: Vial's tables are `keycodes/keycodes_v5.py` and `keycodes_v6.py` (about 600 lines each). The firmware picks v5 or v6 by Vial protocol. keyloom needs the same lookup, keyed to protocol version. Licence is GPL-2.0-or-later, so copying them needs a licence decision. Generating the table from QMK's own `keycodes_*.hjson` is the cleaner route (not checked).
- Risks: Windows and macOS permissions for raw HID, a 500 ms timeout with retries, and QMK API drift between the vial-qmk and ZSA forks.
- No Vial keyboard was available, so none of this has been run. A spike that reads the definition and keymap from a real board is the first step.

### (b) Can keyloom build Vial firmware for the Moonlander?

Probably yes. Evidence and gaps:

- vial-qmk already ships `keyboards/zsa/moonlander/keymaps/vial/` with `rules.mk` (`VIA_ENABLE`, `VIAL_ENABLE`, `VIALRGB_ENABLE`), `config.h` (UID and unlock keys at row 0, columns 2 and 4), `keymap.c` and `vial.json` (12x7 matrix). (source: `keyboards/zsa/moonlander/keymaps/vial/*` at `dd43959a`)
- The build is `make zsa/moonlander:vial` from the vial-qmk root. (docs: porting-to-vial step 7)
- The board has 8 layers and a 16 KB I2C EEPROM, so 32 slots of each dynamic feature. (source above)
- The bootloader is `stm32-dfu`, the same as ZSA's. keyloom's Zapp flasher flow should still work. The VIBL updater is not relevant. (source: `keyboard.json:176`)
- Gaps I have not checked:
  - Whether this port matches the ZSA fork's hardware support (audio, RGB, the Oryx and Keymapp hooks). Vial firmware replaces ZSA's, so Oryx and Keymapp live features may stop working.
  - Whether the build passes in Docker today. No build was run.
  - Whether keyloom's Docker image can use vial-qmk (it tracks ZSA's fork today), and the effort to keep both.
  - The macro space left after Vial's EEPROM tables.
- A Moonlander running Vial gives live edits and no more flashing for the keymap, but keyloom's current model, where an agent edits `keymap.c`, then builds, then flashes, stays necessary for anything that needs compile-time code (custom keycodes, `process_record_user`, RGB code).

### (c) What a combined flow could look like

1. One flash: keyloom builds the Vial keymap for the board and flashes it. This is today's flow.
2. After that, keyloom talks to the keyboard over HID. Each accepted change is sent as a packet and takes effect at once. The agent still proposes, the validator still decides (D-014), but the apply step is a protocol write, not a build.
3. Compile-time changes still build and flash. keyloom decides per change which path applies.
4. The same keymap model can export `.vil` for Vial users. Keep `.vil` import as a way to start from an existing Vial layout.

### ZMK and Glove80

- The Studio protocol is open, small and has a TypeScript client. A browser can talk to it over Web Serial, which Chrome supports. A bun CLI would need its own serial transport. (docs: `zmk-and-glove80.md` lines 94-98, 140)
- Studio covers key bindings, layer names and order, and physical layouts. It does not cover combos, macros or behaviour timing. keyloom's ZMK path stays build-and-flash for those (CI build, UF2 copy).
- Glove80 needs a Studio-enabled firmware first. Whether MoErgo's fork keeps the Studio code is noted in `zmk-and-glove80.md` line 90. Flash that firmware once, then live-edit bindings.
- The save model differs. ZMK Studio stages and saves. Vial writes through. A common keyloom model needs a "staged" state anyway for the agent's change sets, so Studio fits it more naturally than Vial does.

## Limitations and pain points

- Firmware is a prerequisite. A keyboard without Vial firmware shows nothing. The docs say so: "your keyboard needs to use a dedicated firmware for Vial". (docs: manual/first-use)
- Porting is manual. Authors write `vial.json` (KLE with `"row,col"` labels), generate a UID, choose unlock keys and keep the build size inside flash and EEPROM. Large boards run out of space on AVR. (docs: porting-to-vial, firmware-size)
- Tap dance and macros are two-step: build the thing in its own tab, then assign `TD(n)` or `Mn` to a key. Combos and key overrides need no assignment but live in their own tabs.
- Macros need unlock, and unlock needs 5 s of holding physical keys. Fine on a keyboard, awkward in automation.
- Save semantics are inconsistent. Keymap, combos and key overrides write on every change. Macros, tap-dance timing and QMK settings need Save. Lighting applies at once but needs Save to persist.
- No undo and no change history. A mis-click on a key overwrites it. The only recovery is a `.vil` backup. (source: grep)
- The macro recorder is missing on macOS and in the web app. (source: `editor/macro_recorder.py:32-40`)
- Tapping term and the other tap-hold settings are global. Only tap dance has a per-entry term. Home-row-mod tuning per key is not possible in the GUI. (source: `qmk_settings.json`; `quantum/vial.c:364-372`)
- Combos match keycodes, not positions, and only four inputs. (source: `quantum/vial.h:123-126`)
- Layer count, macro count and entry counts are fixed at compile time. The GUI cannot add layers. (docs: firmware-size)
- The keyboard UID must be unique per board. The GUI warns if an example UID is used. (source: `main_window.py:316-320`; `util.py:29-37`)
- Web version needs Chrome or Edge, picks one device per session, and hides sideload and VIA features. (source: `main_window.py:179-185`, `hidproxy.py:6-45`)
- Security trade-off: anyone with host access can rewrite the keymap without unlock. (source: see "What the firmware refuses")
- The docs have no "dynamic features" page or "Vial vs VIA" page. The manual lists First time use, Layers, Quantum, Macros, Alt Repeat Key, Tap Dance, Combos, QMK Settings and Any key. The porting guide covers security, size, lighting, encoders, MIDI and custom keycodes. (docs: get.vial.today/docs and /manual, fetched 2026-10-15)

## What keyloom should take

One line each. Each is a suggestion for BK to accept or drop.

1. Click a key, click a keycode, done. Make a single click on a keycode write to the board when a live-capable board is connected.
2. Auto-advance the selection to the next key after each assignment, as Vial does (`keymap_editor.py:202`). Make it optional for fix-up work.
3. Keep Vial's tab split (Basic, Layers, Quantum, Media, Macro, Tap Dance) as the first picker, and add search over keycode names and aliases.
4. Add an "Any keycode" box that accepts QMK expressions such as `LCTL_T(KC_A)` and shows the computed hex. This is the escape hatch that makes everything else safe to omit.
5. Fix the mod-tap flow: after choosing a mod-tap, keep the selection on that key and open the inner picker at once. This saves two clicks over Vial.
6. Create tap dances and macros inline from a key. One action: "make this key a tap dance", assigning the `TD(n)` slot automatically. Vial's two-tab dance is its worst flow.
7. Show combos as a list on the keyboard drawing, with keys picked by clicking on the drawing, not through the palette.
8. Treat the write path as a swappable "apply" step: protocol write for live boards, build and flash for everything else.
9. Read the keyboard definition from the board (`0xFE 0x01`/`0x02`, LZMA JSON) so no per-board data is shipped for Vial boards. For other boards keep keyloom's own geometry.
10. Support WebHID in the React editor with `{usagePage: 0xFF60, usage: 0x61}`. Keep the codec pure so the CLI can reuse it with a Node HID transport.
11. Keep a local copy of the full keymap and diff against it. Vial skips writes when nothing changed (`keyboard_comm.py:315`). Do the same.
12. Build the Moonlander `vial` keymap in Docker first. Run it as the spike that decides whether live editing is worth the vial-qmk dependency.
13. Show the unlock dialog with the physical keys highlighted on the drawing, as Vial does. Put a progress bar on it.
14. Add a visible undo and a timeline of changes for live writes. Vial has neither, and agent edits make it more necessary.
15. Make the save model uniform. Write through on every accepted change, or stage and save everywhere, but not both as Vial does.
16. Import and export `.vil`. It is plain JSON with a UID check, and it gives users of Vial a way in and out. (`protocol/keyboard_comm.py:369-440`)
17. Show a matrix tester tab. It is cheap, helps diagnose hardware, and Vial already gates it behind unlock for good reason.
18. Show memory used, as Vial's macro tab does (`editor/macro_recorder.py:151-155`), for macros and any other limited slots.
19. For ZMK, add a Studio client (WebSerial plus the TS client) as the live path for bindings. Keep build and flash for combos, macros and behaviour tuning.
20. Warn, as ZMK does, that once Studio edits a board, `.keymap` edits are ignored until reset. keyloom should detect that state before applying a change set.
21. Hold the line on product discipline: do not copy Vial's alt repeat, MIDI or mouse-key panels until a real need appears.

## Open questions

- Does `make zsa/moonlander:vial` build at `dd43959a` inside keyloom's Docker image, and does the result flash and connect over raw HID?
- Does the Vial Moonlander port keep Oryx and Keymapp working? Probably not.
- Which JS LZMA decoder reads a Vial definition correctly?
- Is the GPL-2.0-or-later licence of the keycode tables acceptable, or should keyloom derive them from QMK's data files?
- Does a stock MoErgo Glove80 build connect to ZMK Studio? Already listed in `docs/research/zmk-and-glove80.md`.
- How many macro bytes are left on the Moonlander after the dynamic tables?
