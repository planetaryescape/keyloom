# 17: Keyboard sync: Apply puts the change on the keyboard

Status: proposal, 2026-10-15. Source baseline: origin/main at `65cc12a` (v0.10.1).

BK on Vial: "vial is really really user friendly in terms of not needing to manually flash, you click a key, click what you want it to be and done." Then: "so is there no way for me to flash without needing to physically interact with the boards, similar to what vial does? Would be great if we could figure this out and build it into keyloom". And: "Not just for glove 80 but for all my boards".

This chapter makes Apply the last step on every board BK owns. keyloom gets the change onto the keyboard itself: no keypress, no cable swap, and no separate Build and flash step. There are two ways to do that, and keyloom uses both behind one Apply (D-094):

1. **Hands-free flash.** keyloom builds the firmware and restarts the keyboard into its bootloader itself. This works for every change. It already ships for the Moonlander (D-070 to D-074), and this chapter adds it for ZMK (D-095).
2. **Live write.** A change that only swaps what keys send is written to the running keyboard in under a second, as Vial does. This works for some changes on some boards. It's an optimisation on top of the first way, not a separate mode (D-096).

The research is [../research/handsfree-flash-all-boards.md](../research/handsfree-flash-all-boards.md), with source citations at pinned SHAs. Vial's protocol is in [../research/configurators/vial-features.md](../research/configurators/vial-features.md#live-edit-protocol).

## Where each board stands

| Board | Firmware | Hands-free flash today | After this chapter | Live write |
|---|---|---|---|---|
| Moonlander rev A | QMK (ZSA fork) | Yes, once a keyloom build is on it (D-070 to D-074). The board runs one now, serial `keyloom/YRHRBG0T2H8R` | Unchanged | keyloom's own set-keycode command in its raw HID wrapper (S15) |
| Glove80 | ZMK (MoErgo fork `ce69e85`) | No. Each half needs a key combo while it's switched on | The `keyloom-zmk` module: a 1200-baud touch on a USB serial port (S12) | ZMK Studio on the left half, bindings and layers only (S14) |
| Corne | ZMK v0.3.0, nice!nano v2 assumed (S13) | No. Double-tap reset on each half | The same module, with the halves flashed one at a time (S13) | ZMK Studio, the same as the Glove80 |

The first keyloom flash of each ZMK half still needs the key combo, because nothing in the firmware BK runs today accepts a trigger. The left half exposes only a boot-keyboard HID interface, and the right half enumerates with no interfaces (observed with `ioreg` on 2026-10-15). After that one flash, every later flash is hands-free.

## Apply, sync and the keyboard's state

keyloom knows which revision each keyboard runs, because every keyloom build carries a marker in its USB serial number (D-070 for QMK, D-095 for ZMK). The header shows one sync state per connected board (D-094):

| State | Shown as | Meaning |
|---|---|---|
| In sync | "On your Moonlander" with a check | The keyboard runs the head revision |
| Syncing | "Building…", "Flashing the right half…", "Writing…" with progress | keyloom is putting the head revision on the keyboard |
| Behind | "2 changes not on your Glove80" with Sync now | Auto-sync is off, paused or failed |
| Needs a hand | The board's manual instruction, with the reason | The trigger didn't work, or it's the first flash of a ZMK half |
| Not connected | "Glove80 not connected" | No keyboard or marker seen on USB |
| Not keyloom's | "Running firmware keyloom didn't build" with Flash keyloom's build | The marker is missing: Oryx, MoErgo or someone else flashed the board |

### Auto-sync

With auto-sync on, Apply starts the sync.

- **Batching.** keyloom waits three seconds after the last Apply, so a burst of edits becomes one build, then syncs the head revision.
- **One at a time.** A new Apply during a sync queues one more sync. Two builds never run at once.
- **Failure.** A failed build leaves the keyboard on its last good firmware, and the state turns to Behind, with the error.
- **Verification.** A flash counts as In sync only when it's verified: the keyboard came back with the new marker (D-072).

Auto-sync is per board. It can turn on only after one verified hands-free flash on that board, because until then keyloom can't prove it can reach the board without BK's hands. It can be paused from the header. The blueprint assumes it's on by default once proven (Q16).

Measured times BK can expect:

- **Glove80.** A build takes 16 to 20 s (S7). A two-half copy took 41 s in flash `fl_01M5067Z2Y2JT3EDYD3JCY0NSC` (S8).
- **Moonlander.** A build takes about 100 s (S5), plus Zapp's write.
- **Live write.** Under a second.

These numbers decide rung 17 (see [live writes](#live-writes-are-built-only-if-auto-sync-is-too-slow-in-use)).

### Safety

- **A half can't be stranded.** A nRF52 half triggered on battery returns to its app after 3 s. A half triggered on USB waits in its bootloader until it's flashed or switched off. The bootloader reads its key combo before starting the app, so a broken app can always be recovered by hand (`bl-moergo@bb68c75` `src/main.c:197-209`).
- **keyloom keeps the last good image per board and half.** If a copy fails after a trigger, keyloom writes the last good image, so the board is never left without firmware it has run before. It says which image it wrote.
- **keyloom never writes a bootloader UF2** (family `0xd663823c`) through this path.
- **Firmware someone else built is never replaced automatically.** A board in the "Not keyloom's" state needs a deliberate Flash keyloom's build, with the flash dialog's existing confirmation (D-094).
- **Auto-sync never runs during a chat proposal preview.** Only applied revisions sync.

## Hands-free flash on ZMK: the `keyloom-zmk` module

keyloom vendors a small Zephyr module, `firmware/zmk/keyloom-zmk/`, and adds it to every ZMK build it makes (D-095).

- **Builds.** The MoErgo fork's Nix build takes it through `extraModules` (`zmk-fork@ce69e85` `nix/zmk.nix:112`). West builds take `-DZMK_EXTRA_MODULES`.
- **Size.** It's about 80 lines of C, plus Kconfig and a devicetree overlay.
- **Reference.** `tadakado/zmk-bootloader-1200@3445d71` is the reference, but keyloom can't use it as-is. It needs Zephyr's newer boot-mode retention, which neither keyloom pin has, and it has no relay to the right half.

What the module does:

1. **Adds a serial port.** It adds a CDC ACM serial port (`zephyr,cdc-acm-uart` under `&zephyr_udc0`) on both halves. If the Studio snippet already added one on the left half, the module watches that one instead.
2. **Enables USB serial.** It enables `USB_DEVICE_STACK`, `USB_CDC_ACM`, `SERIAL`, `UART_LINE_CTRL` and `UART_INTERRUPT_DRIVEN`, the same set the Studio snippet uses.
3. **Watches for the trigger.** It polls the port's line coding every 250 ms.
   - A close at 1200 baud reboots this half into its bootloader.
   - A close at 1201 baud, on the central only, relays `&bootloader` to every peripheral over the split link. It uses `zmk_split_central_invoke_behavior`, which works on the right half's existing firmware (`zmk-fork@ce69e85` `app/src/behavior.c:96-101`).
   - S12 settles whether the relay should be a baud rate or a text command.
4. **Reboots into the bootloader.** On Zephyr 3.5 it calls `sys_reboot(0x57)`, the Adafruit bootloader's UF2 magic, passed through GPREGRET (`bl-moergo@bb68c75` `src/main.c:112-116`). On newer Zephyr it calls `bootmode_set(BOOT_MODE_TYPE_BOOTLOADER)`.
5. **Marks the build.** It writes keyloom's marker into the USB serial number: `keyloom/<12 chars of the build ID>-<L|R>`.
   - On the Glove80 it keeps MoErgo's template and replaces the prefix (`app/boards/arm/glove80/usb_serial_number.c:26-39`).
   - On boards with no override of their own, the module provides `usb_update_sn_string_descriptor`.
   - S18 checks whether MoErgo's own tools read the `moergo.com:` prefix.

The host side reuses what keyloom already has:

- **Find.** On macOS, the IOKit walk (D-071) finds the device by its marker and reads its CDC interface's `IOCalloutDevice`. On Linux, keyloom reads `/dev/serial/by-id/`. Neither opens a device.
- **Trigger.** `stty -f <port> 1200` on macOS, `stty -F <port> 1200` on Linux. No serial library goes into the compiled binary. Linux users need to be in the `dialout` group (S17).
- **Flash.** The existing UF2 copy (D-038), which now explains a refused write (`190dd57`).
- **Verify.** keyloom waits for each half to come back with the new marker, as D-072 does.
- **Fall back.** If no marker, port or boot drive appears within 15 s, keyloom shows the board's manual instruction with the reason, as D-072 does.

`board.json` gains one block per board, so a new nRF52 ZMK board with an Adafruit bootloader needs only data ([04](04-boards-and-contributions.md)):

```json
"handsFree": {
  "trigger": "cdc-1200",
  "halves": [
    { "role": "central", "volume": "GLV80LHBOOT", "marker": "L" },
    { "role": "peripheral", "volume": "GLV80RHBOOT", "marker": "R", "relay": true }
  ],
  "serialMarker": "usb-sn-template"
}
```

Both of the Corne's halves mount as `NICENANO`, so its adapter flashes one half, waits for it to come back with the new marker, then does the other.

## Live writes are built only if auto-sync is too slow in use

A live write is worth its cost only if waiting for a flash gets in the way. Rung 13 measures that instead of assuming it. Rung 17 is built only if, after a week of auto-sync, BK says the wait between Apply and typing bothers him (D-096). Two things make this a decision and not a default:

- **Two sources of truth.** A live write changes the keyboard without changing the firmware image. keyloom must record each live write as a revision, reset the keyboard's stored keymap after every flash, and detect a board whose stored keymap has drifted.
- **Limited reach.** Live writes cover only key bindings and layers. On ZMK, hold-tap timing, combos, macros and tap dances still need a flash, because Studio can't change them (`studio.md:17-40` at `zmk@4dd95d7`). Those are exactly what BK's two problems turned on (D-025).

When live writes are built, Apply picks the route per change set. A change set that only replaces bindings with ones the firmware can store at runtime goes live. Anything else syncs by flash. The person sees one Apply either way, and the state line says which route ran.

### Moonlander: keyloom's own command, not Vial

The Moonlander keeps ZSA's fork (D-097).

- **Why not Vial.** Vial would bring live tap dance, combos and tapping term. But it means leaving ZSA's fork, which loses Oryx's live view, Keymapp and rev B support. Its bootloader jump also needs a physical unlock (`quantum/via.c:434-446` at `vial-qmk@dd43959`).
- **What instead.** keyloom's raw HID wrapper (D-070) gains a second command that calls QMK's `dynamic_keymap_set_keycode(layer, row, col, keycode)`. That needs `DYNAMIC_KEYMAP_ENABLE` to fit beside Oryx's modules in ZSA's fork, which S15 checks.
- **One source of truth.** After each flash, keyloom resets the dynamic keymap to the compiled one, so the file stays the source of truth.

### Glove80 and Corne: ZMK Studio's RPC

keyloom builds the left half with the `studio-rpc-usb-uart` snippet and `CONFIG_ZMK_STUDIO=y`.

- **Protocol.** keyloom speaks Studio's protobuf protocol over the same serial port, using the MIT-licensed `@zmkfirmware/zmk-studio-ts-client` codec.
- **Locking.** Hands-free live writes need `CONFIG_ZMK_STUDIO_LOCKING=n`, which lets any local process change the keymap. D-070 made the same trade-off for the Moonlander, and it's BK's call (Q17).
- **After a flash.** keyloom calls `reset_settings`, so the flashed `.keymap` takes effect again (`app/src/studio/core_subsystem.c:66-77`).
- **Open question.** S14 checks whether Studio runs on a stock-configured Glove80 build at all.

## What still needs a person

- **A cable.** Each half being flashed needs a USB cable. Flashing over Bluetooth would need the bootloader's BLE OTA mode and a Nordic DFU client in keyloom. That's a separate project, and nobody is known to use it on a Glove80 (D-095).
- **The first flash.** The first keyloom flash of each ZMK half needs the key combo.
- **The right half's cable.** The relay restarts the right half into its bootloader, but the half needs its own cable plugged in to mount a drive and stay there.
