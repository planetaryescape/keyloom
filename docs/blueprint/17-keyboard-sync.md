# 17: Keyboard sync: Apply puts the change on the keyboard

Status: split ZMK rollback, shared-drive identity checks and incomplete-recovery sync states are implemented and tested with fake halves (D-437, D-438, 2026-10-22); hardware rollback is unobserved. A put onto a new board never starts a sync by itself, tested in `test/app/keyboard-put-sync.test.ts` (D-376), 2026-10-17; hands-free flashing and auto-sync are built (rungs 12 and 13: the Moonlander in v0.9.0, the `keyloom-zmk` module in v0.12.0, the sync engine in v0.14.0), as of v0.36.1. On hardware, the Glove80 has been flashed hands-free on both halves with a verified result (S12, 2026-10-16). The Corne has not (S13 not run). The week of use that rung 13 asks for is not recorded. Live writes (rung 17: Moonlander set-keycode, ZMK Studio) are not built, on purpose: they wait on rung 13's verdict about the wait. Written 2026-10-15 against origin/main at `65cc12a` (v0.10.1).

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

A ZMK half with a distinct boot-drive label can take its first keyloom flash through the manual key combo. For a shared label such as `NICENANO`, a manual drive must appear after the prompt, and every peer sharing that label must visibly run firmware on USB immediately before the write. Keyloom or other firmware is accepted when the running half can be identified; a peer that is on USB without a marker cannot be confirmed and refuses the write. A peer that is not on USB at all cannot own a boot drive, so it no longer blocks the flash (D-465). A drive already open before the prompt is refused (D-437). On macOS, keyloom checks the current console user's screen-lock state before restarting a half or waiting for a drive; if locked, it asks for unlock before any half is restarted. If macOS locks during the wait, the instruction explains why the boot drive cannot mount. A drive already mounted can still be used while locked (D-442).

## Apply, sync and the keyboard's state

keyloom knows which revision each keyboard runs, because every keyloom build carries a marker in its USB serial number (D-070 for QMK, D-095 for ZMK). The header shows one sync state per connected board (D-094):

| State | Shown as | Meaning |
|---|---|---|
| In sync | "On your Moonlander" with a check | Every expected half is present and verified on the head revision, with no unresolved split-flash failure |
| Syncing | "Building…", "Flashing the right half…", "Writing…" with progress | keyloom is putting the head revision on the keyboard |
| Behind | "2 changes not on your Glove80" with Sync now | Auto-sync is off, paused or failed |
| Needs a hand | The board's manual instruction, with the reason | The trigger didn't work, or it's the first flash of a ZMK half |
| Not connected | "Glove80 not connected" | No keyboard or marker seen on USB |
| Not keyloom's | "Running firmware keyloom didn't build" with Flash keyloom's build | The marker is missing: Oryx, MoErgo or someone else flashed the board |

### Auto-sync

With auto-sync on, Apply starts the sync.

- **Batching.** keyloom waits three seconds after the last Apply, so a burst of edits becomes one build, then syncs the head revision. The three seconds run from the revision's own time, so an Apply from the CLI counts too (D-161).
- **One at a time.** Two builds never run at once, in this process or another. An Apply during a build stops that build and one sync follows, for the head. An Apply during a flash lets the flash finish, then one more sync follows (D-161).
- **Failure.** A failed build leaves the keyboard on its last good firmware, and the state turns to Behind, with the error.
- **Verification.** A flash counts as In sync only when it's verified: the keyboard came back with the new marker (D-072).

Auto-sync is per board. It can turn on only after one verified hands-free flash on that board, because until then keyloom can't prove it can reach the board without BK's hands. It can be paused from the header. It is on by default once proven (Q16, D-162).

The engine runs inside `keyloom serve` and works from the database, so an Apply from `keyloom change apply` syncs too. `keyloom sync <layout>` runs one sync from the command line, `keyloom sync status` shows each board's state and timings, and `keyloom autosync on|off|pause|resume|status <board>` sets what the header's menu sets ([10](10-cli.md#sync-and-autosync-put-the-head-on-the-keyboard)).

A keyboard is tracked against the layout it runs. Edits to another layout of the same board don't start a sync, because that would replace what the keyboard runs; the header offers "Put this layout on it" (D-163). A keyloom build this copy has no record of is treated like firmware keyloom didn't build.

Measured times BK can expect:

- **Glove80.** A build takes 16 to 20 s (S7). A two-half copy took 41 s in flash `fl_01M5067Z2Y2JT3EDYD3JCY0NSC` (S8).
- **Moonlander.** A build takes about 100 s (S5), plus Zapp's write.
- **Live write.** Under a second.

These numbers decide rung 17 (see [live writes](#live-writes-are-built-only-if-auto-sync-is-too-slow-in-use)).

### Safety

- **A half can't be stranded.** A nRF52 half triggered on battery returns to its app after 3 s. A half triggered on USB waits in its bootloader until it's flashed or switched off. The bootloader reads its key combo before starting the app, so a broken app can always be recovered by hand (`bl-moergo@bb68c75` `src/main.c:197-209`).
- keyloom keeps the last-good image per board and half, promoting the images only after the whole split flash verifies (D-437). If a later half fails, keyloom reads it and restores every already verified half to the saved build. A failed half still reporting that build needs no rewrite. With a distinct boot-drive label, keyloom asks for its bootloader with its own key combo, waits the normal 2 minutes, writes its saved image and verifies it too. Shared labels follow the identity rule below. Each restore verifies against the key inside the saved image.
- A rollback is a failed flash and sync, including when paused or stopped during recovery. Its log and error name each half's observed build and, after full recovery, say the keyboard is back on the previous build. The board stays behind the applied revision. If an expected half is missing, it needs a hand and shows the stored recovery error, even when the visible half runs the head. A later edit or unplugging every half does not hide a failed split flash. The header and toast cannot report success from the remaining halves. Flash again follows the recipe's original step order; wait for each prompt before opening that half's bootloader. A later successful flash of the failed revision or a descendant, corroborated by every expected half running its build, supersedes the old sync failure, allowing `in_sync` and auto-sync on later edits. The failed sync row remains in history. QMK and single-step boards follow the same rule. A verified kanata running-revision match with the head clears a failed remapper sync without a flash row.
- Recovery stops after one attempt per half. Missing or unsafe saved images, a failed restore, or an ambiguous shared boot drive produce an error naming each half's observed state and the next action. A saved image must match that half's known pre-flash key, including the failed half. Every UF2 block's family, number and declared count must agree, and the image must be complete.
- A distinct boot drive already open can be used. For a shared label, recovery requires keyloom to restart that specific target and observe its drive appear, with every peer reporting running marked firmware before the restart and when the drive appears. Normal flashing and Flash again also accept manual drives appearing after the prompt, but, when hooks are available, re-read every shared-label peer before each write attempt and the final sync: each must visibly run keyloom or other firmware on USB. A peer that is absent from USB cannot own the drive and does not refuse the write; a peer that is on USB and cannot be identified does, including a delayed drive from that peer (D-465). A half with no serial port of its own is still read from the marker in its USB serial number (D-465). Keyloom cannot tell which half owns a drive from the label alone; the peer must be running or not attached, or recovered on its own with only that half connected first. Boards without hands-free hooks keep their existing manual behaviour, including an already mounted shared drive; they have no rollback, verification or peer check. Every write attempt and the final sync must still match the selected mount path, device and inode. Duplicate mounts of one label are ambiguous and refused. Reboot-only writes no drive and requires no peer marker.
- **keyloom never writes a bootloader UF2** (family `0xd663823c`) through this path.
- **Firmware someone else built is never replaced automatically.** A board in the "Not keyloom's" state needs a deliberate Flash keyloom's build, with the flash dialog's existing confirmation (D-094, D-167).
- **Auto-sync never runs during a chat proposal preview.** Only applied revisions sync.

## Hands-free flash on ZMK: the `keyloom-zmk` module

keyloom vendors a small Zephyr module, `firmware/zmk/keyloom-zmk/`, and adds it to every ZMK build it makes (D-095).

- **Builds.** The MoErgo fork's Nix build takes it through `extraModules` (`zmk-fork@ce69e85` `nix/zmk.nix:112`), from a `config/default.nix` keyloom writes into its template checkout. West builds take `-DZMK_EXTRA_MODULES`. Both also pass the overlay that adds the serial port as `EXTRA_DTC_OVERLAY_FILE`, because Zephyr 3.5 modules can't carry a snippet (D-130, D-131).
- **Size.** It's about 80 lines of C, plus Kconfig and a devicetree overlay.
- **Reference.** `tadakado/zmk-bootloader-1200@3445d71` is the reference, but keyloom can't use it as-is. It needs Zephyr's newer boot-mode retention, which neither keyloom pin has, and it has no relay to the right half.

What the module does:

1. **Adds a serial port.** It adds a CDC ACM serial port (`zephyr,cdc-acm-uart` under `&zephyr_udc0`) on both halves. When rung 13 adds the Studio snippet, the module is to watch Studio's port on the left half instead (not built yet, D-130).
2. **Enables USB serial.** It enables `USB_DEVICE_STACK`, `USB_CDC_ACM`, `SERIAL`, `UART_LINE_CTRL` and `UART_INTERRUPT_DRIVEN`, the same set the Studio snippet uses.
3. **Watches for the trigger.** It polls the port's line coding every 250 ms.
   - A close at 1200 baud reboots this half into its bootloader.
   - A close at 1201 baud, on the central only, relays `&bootloader` to every peripheral over the split link. It uses `zmk_split_central_invoke_behavior`, which works on the right half's existing firmware (`zmk-fork@ce69e85` `app/src/behavior.c:96-101`). The module sets the rate back to 115200 afterwards so the next touch is seen (D-133).
   - S12 settles whether the relay should be a baud rate or a text command.
4. **Reboots into the bootloader.** On Zephyr 3.5 it calls `sys_reboot(0x57)`, the Adafruit bootloader's UF2 magic, passed through GPREGRET (`bl-moergo@bb68c75` `src/main.c:112-116`). On newer Zephyr it calls `bootmode_set(BOOT_MODE_TYPE_BOOTLOADER)`.
5. **Marks the build.** It writes keyloom's marker into the USB serial number: `keyloom/<12 chars of the build ID>-<L|R>:<tail>` (D-132).
   - On the Glove80 it keeps MoErgo's template and replaces the prefix (`app/boards/arm/glove80/usb_serial_number.c:26-39`), with one template per half.
   - On boards with no override of their own, the module provides `usb_update_sn_string_descriptor`, and keyloom turns it on.
   - S18 checks whether MoErgo's own tools read the `moergo.com:` prefix.

The host side reuses what keyloom already has:

- **Find.** On macOS, an IOKit walk like D-071's lists the serial ports and reads each one's `IOCalloutDevice` and its owning device's serial number. On Linux, keyloom reads sysfs and returns the `/dev/serial/by-id` link. Neither opens a device (D-134).
- **Trigger.** `stty -f <port> 1200` on macOS, `stty -F <port> 1200` on Linux. No serial library goes into the compiled binary. Linux users need to be in the `dialout` group (S17).
- **Flash.** The existing UF2 copy (D-038), which now explains a refused write (`190dd57`).
- **Verify.** keyloom waits for each half to come back with the new marker, as D-072 does.
- **Fall back.** With a distinct boot-drive label, if no marker, port or boot drive appears within 15 s, keyloom shows the board's manual instruction with the reason, as D-072 does. A shared label follows the peer check and drive-identity rules above.

The flash recipe gains one block per revision, so a new nRF52 ZMK board with an Adafruit bootloader needs only data ([04](04-boards-and-contributions.md)). A half names the label of the flash step that writes it, and the block sits in `flash` beside the steps (D-136):

```json
"handsFree": {
  "trigger": "cdc-1200",
  "usbVendorId": "0x16c0",
  "halves": [
    { "role": "central", "step": "left half", "marker": "L", "usbProductId": "0x27db" },
    { "role": "peripheral", "step": "right half", "marker": "R", "usbProductId": "0x27d9", "relay": true }
  ],
  "serialMarker": "usb-sn-template",
  "serialTail": ":GLV80-0123456789ABCDEF"
}
```

Both of the Corne's halves mount as `NICENANO`, so its adapter flashes one half, waits for it to come back with the new marker, then does the other. The Corne's USB IDs are unknown until S13, so its ports are told apart from the Glove80's by the Glove80's IDs (D-134).

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
