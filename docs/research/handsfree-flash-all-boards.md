# Hands-free flashing and live editing on BK's three boards

Checked 2026-10-15. Code claims come from clones under `/tmp/keyloom-refs/` at the SHAs below. Claims about BK's own keyboards come from `ioreg` on his Mac on the same day, with both Glove80 halves and the Moonlander plugged in. Nothing was flashed or rebooted.

Each claim carries one of these tags: "verified in source" (repo, SHA, path and lines), "observed" (a command on BK's machine), "from docs" (a URL) or "unverified".

| Repo | Ref | SHA |
| --- | --- | --- |
| `moergo-sc/Adafruit_nRF52_Bootloader` | `master` | `bb68c75e33c6bebaa5f770a28bd76e667b46634d` |
| `adafruit/Adafruit_nRF52_Bootloader` | `master` | `c67f0bcf0fa8e841426335b1bbde91cda6ca1f50` |
| `moergo-sc/zmk` | `main` = `v26.09` (keyloom's Glove80 pin) | `ce69e85f585c724142aae37ddf8a7e019ff19e93` |
| `zmkfirmware/zmk` | `main` | `4dd95d7840eb3d5a3f59bb29fbf1ab054715ef85` |
| `zmkfirmware/zmk` | `v0.3.0` (keyloom's Corne pin) | `edf5c0814fd3ea202e43aad2d68fd32e882a518c` |
| `zmkfirmware/zephyr` | `v3.5.0+zmk-fixes` (used by the fork and by v0.3.0) | `dacab4875df72109b96cc8977547a0dc04875bcd` |
| `zmkfirmware/zephyr` | `v4.1.0+zmk-fixes` (used by ZMK `main`) | `10ba6d0cb38bc3d258775d27982f707599320085` |
| `zmkfirmware/zmk-studio-messages` | `main` | `6cb4c283e76209d59c45fbcb218800cd19e9339d` |
| `tadakado/zmk-bootloader-1200` | `main` | `3445d716611c3117ea700521324709133e9fe960` |
| `zzeneg/zmk-raw-hid` | `main` | `6a37765dfab6197292e7a9f47305dcf87386d56a` |
| `adafruit/Adafruit_nRF52_nrfutil` | `master` | `7fdfe15feee5f304fb7d9b031721dcefa1f72b58` |
| `vial-kb/vial-qmk` | `vial` | `dd43959ae5c08d8a28d38a1acf7b04e86b14a344` |

Short forms below: `bl-moergo` for MoErgo's bootloader, `bl-ada` for Adafruit's, `zmk-fork` for `moergo-sc/zmk`, `zmk-main` and `zmk-0.3` for upstream, `zephyr-3.5` and `zephyr-4.1`.

## Summary

| Board | No-touch flash | No-flash live edit |
| --- | --- | --- |
| Moonlander rev A (QMK) | Done: raw-HID `0xE7 KLBOOTLD`, then Zapp (D-070 to D-074). BK's Moonlander is running a keyloom build now: serial `keyloom/YRHRBG0T2H8R` (observed). | Vial supports it, but means leaving ZSA's fork and Oryx. A smaller route is a keyloom "set keycode" command in the raw-HID wrapper keyloom already has. |
| Glove80 (ZMK, MoErgo fork) | Possible with a small keyloom ZMK module: a 1200-baud touch on a USB serial port puts each half into its UF2 bootloader. Both halves need a USB cable. The first keyloom flash of each half still needs the key combo. | ZMK Studio, built into the left half. It changes bindings and layers, not hold-tap settings, combos or macros. |
| Corne (ZMK v0.3.0, nice!nano v2 assumed) | The same module and host code as the Glove80. Each half needs a cable. | ZMK Studio, the same as the Glove80. |

The generic design is one trigger per firmware family: raw HID for QMK and a 1200-baud USB serial touch for ZMK on nRF52. A board adapter only names the volumes, the halves and the marker.

## Every nRF52 half enters its UF2 bootloader when the app writes 0x57 to GPREGRET and resets

The Glove80's bootloader is MoErgo's fork of Adafruit's nRF52 bootloader. It reads `NRF_POWER->GPREGRET` on boot. `0x57` starts UF2 mode (USB serial plus the mass-storage drive), `0x4e` starts serial-only DFU, `0xA8` starts BLE OTA DFU and `0x6d` skips DFU. Verified in source `bl-moergo@bb68c75` `src/main.c:101-116` and `:246-266`.

UF2 mode entered this way has a safety timeout. If USB has not enumerated within 3 s, for example on battery, the half restarts into its app. Once USB is mounted, the timeout is cancelled and the half waits in the bootloader with no time limit. Verified in source `bl-moergo@bb68c75` `src/main.c:337-345` and `lib/sdk11/components/libraries/bootloader_dfu/bootloader.c:91-98`. Upstream Adafruit has the same logic (`bl-ada@c67f0bc` `src/main.c:252`, `:339-342`, `bootloader.c:109`, `:156`).

The bootloader scans the key matrix before it decides anything, and the DFU combo forces UF2 mode whatever the app is. That is why Magic+E and I+PgDn work even when the app is broken. Verified in source `bl-moergo@bb68c75` `src/main.c:197-209`, `:273`, and the combo `src/boards/glove80_v1_lh/board.h` (`KM_COMBO_DFU`, C6R6 + C3R3).

The volumes and family IDs are per half. The left is `GLV80LHBOOT` with app family `0x9807B007`, and the right is `GLV80RHBOOT` with `0x9808B007`. Verified in source `bl-moergo@bb68c75` `src/boards/glove80_v1_lh/board.h:87-90` and `src/boards/glove80_v1_rh/board.h:86-89`. A UF2 block with another family ID is rejected (`write_block` returns -1). That is how one combined `glove80.uf2` flashes the right image to each half. Verified in source `bl-moergo@bb68c75` `src/usb/uf2/ghostfat.c:409-413` and `:566`. This settles an open question in `zmk-and-glove80.md`.

The nice!nano v2 uses upstream Adafruit's bootloader with the volume `NICENANO` and board ID `nRF52840-nicenano`. Verified in source `bl-ada@c67f0bc` `src/boards/nice_nano/board.h:51-57`. That BK's Corne uses nice!nano v2 controllers is an assumption: keyloom's Corne board file says `nice_nano_v2` and `NICENANO` (`boards/foostan/corne/board.json`), but nobody has looked at the hardware. Both nice!nano halves use one family ID, so the bootloader will take a left image on the right half. keyloom has to pick the image by half; the bootloader will not catch a mistake.

## ZMK's &bootloader is that same write, and both of keyloom's ZMK pins use the old path

In the fork and in v0.3.0, `&bootloader` is `zmk,behavior-reset` with `type = <RST_UF2>` (`0x57`), and pressing it calls `sys_reboot(0x57)`. Verified in source `zmk-fork@ce69e85` `app/dts/behaviors/reset.dtsi:19-21`, `app/include/dt-bindings/zmk/reset.h:13`, `app/src/behaviors/behavior_reset.c:32`; the same lines in `zmk-0.3@edf5c08`.

On Zephyr 3.5, `sys_reboot(type)` on nRF52 writes the type to GPREGRET and resets when `NRF_STORE_REBOOT_TYPE_GPREGRET` is set, and ZMK sets it by default. Verified in source `zephyr-3.5@dacab48` `soc/arm/nordic_nrf/nrf52/soc.c:25-36` and `zmk-fork@ce69e85` `app/Kconfig:45-47`.

ZMK `main` (Zephyr 4.1) moved to Zephyr's retention boot mode. Its `&bootloader` calls `bootmode_set(BOOT_MODE_TYPE_BOOTLOADER)` then a warm reboot, and a ZMK mapper turns that into `0x57` in GPREGRET for Adafruit bootloaders. Verified in source `zmk-main@4dd95d7` `app/src/behaviors/behavior_reset.c:39-51`, `app/src/boot/bootmode_to_magic_mapper.c:23-52`, `app/src/boot/Kconfig.defaults:18-25`, `app/dts/common/nordic/nrf52840_uf2_boot_mode.dtsi:1-29`. In Zephyr's DTS `gpregret1` is the register at `0x4000051c`, which is GPREGRET (`zephyr-4.1@10ba6d0` `dts/arm/nordic/nrf52840.dtsi:67`). A keyloom module has to support both paths, because the Glove80 pin is on Zephyr 3.5 and ZMK `main` is on 4.1.

## No route exists on the firmware BK runs today, so the first keyloom flash of each ZMK board needs the key combo

Observed with `ioreg -p IOService -r -n "Glove80 Left" -l`: the left half has one USB interface, a boot keyboard HID (class 3, subclass 1, protocol 1) with usage pairs keyboard and consumer. Its largest output report is 2 bytes (the LED report). There is no vendor HID interface and no CDC ACM. `ls /dev/cu.*` shows no `usbmodem` port.

Observed: the right half enumerates as `Glove80 Right`, VID `0x16C0` (5824), PID `0x27D9`, `bcdDevice` `0x0305`, serial `moergo.com:GLV80-58291CCA4B6E75B0`. It has zero interfaces. The fork's right-half defconfig sets `CONFIG_ZMK_USB=n` (`zmk-fork@ce69e85` `app/boards/arm/glove80/glove80_rh_defconfig:9`), but `src/usb.c` calls `usb_enable` whenever the USB device stack is built (`app/CMakeLists.txt:101`, `app/src/usb.c:78-81`). `ZMK_SLEEP` implies `USB` (`app/Kconfig:405-410`), and Layout-Editor-style configs set `CONFIG_ZMK_SLEEP=y` (keyloom fixture `test/fixtures/zmk/layout-editor-style/Sample.conf:1`). That chain explains a right half with USB up and no class. That it is the cause on BK's board is unverified. It matters because the right half's USB stack already runs, so adding a CDC ACM interface to it is a small step.

So there is nothing a host can send today. This is the same as the Moonlander before D-070: the first flash of keyloom's firmware is manual, and every later one is not.

## A 1200-baud touch on a USB serial port is the right trigger for ZMK, and someone has already built it

Zephyr has no built-in 1200-baud touch for nRF. The only user of the CDC ACM "baud changed" callback is the Atmel SAM0 BOSSA code (`zephyrproject-rtos/zephyr` `soc/atmel/sam0/common/bossa.c`, found by GitHub code search; unverified at a SHA). Zephyr's CDC ACM driver stores the host's line coding and DTR, and `uart_line_ctrl_get` returns both. Verified in source `zephyr-3.5@dacab48` `subsys/usb/device/class/cdc_acm.c:165-185` and `:871-886`.

`tadakado/zmk-bootloader-1200` is a ZMK module that does this. A low-priority thread polls the CDC ACM. When the baud rate is 1200 and DTR is low (the host closed the port), and both still hold 250 ms later, it calls `bootmode_set(BOOT_MODE_TYPE_BOOTLOADER)` and `sys_reboot(SYS_REBOOT_WARM)`. On a split peripheral, where `ZMK_USB` is off, it calls `usb_enable` itself. Verified in source `tadakado/zmk-bootloader-1200@3445d71` `src/bootloader_1200.c:38-80`. The host side is `stty -f /dev/cu.usbmodemXXXX 1200` on macOS or `stty -F /dev/ttyACMn 1200` on Linux (from the module's README, `README.md:8-13`; unverified on any of BK's boards).

It cannot be used as-is. Its Kconfig `depends on RETENTION_BOOT_MODE` (`Kconfig:4`), which neither the fork nor v0.3.0 has. Its README targets the Seeed XIAO and ZMK `main`. It is MIT-licensed. It last changed on 2026-07-03 and has no tests.

The same trigger is what `adafruit-nrfutil dfu serial --touch 1200` sends before a serial DFU. Verified in source `Adafruit_nRF52_nrfutil@7fdfe15` `nordicsemi/__main__.py:281-286` and `nordicsemi/dfu/dfu_transport_serial.py:97-110`.

## Raw HID would reuse keyloom's QMK code, but it only works on the left half

`zzeneg/zmk-raw-hid` adds a vendor HID interface on usage page `0xFF60`, usage `0x61`, 32-byte reports. That is the same interface keyloom's macOS and Linux transports already find and write to (D-071). Verified in source `zzeneg/zmk-raw-hid@6a37765` `Kconfig:1-20`, `include/raw_hid/raw_hid.h:7-21`, `src/usb_hid.c:27-38`. It also exposes the interface over BLE (`src/hog.c`).

Its Kconfig has `depends on !ZMK_SPLIT || ZMK_SPLIT_ROLE_CENTRAL` (`Kconfig:3`). The right half would still need another route, so raw HID adds a second mechanism without removing the first. The BLE exposure also means a paired host could send the reboot without a cable. Its own `config/west.yml` pins ZMK `v0.3`, so it probably builds on keyloom's pins. That is unverified.

## ZMK Studio has no reboot or bootloader request, and modules cannot add one

Studio's core subsystem has four requests: `get_device_info`, `get_lock_state`, `lock` and `reset_settings`. Verified in source `zmk-studio-messages@6cb4c28` `proto/zmk/core.proto:10-17`. The request is a fixed protobuf `oneof` over core, behaviors and keymap (`proto/zmk/studio.proto:11-19`), and the firmware registers handlers only for those subsystems (`zmk-main@4dd95d7` `app/src/studio/core_subsystem.c`, `keymap_subsystem.c`, `behavior_subsystem.c`). A module would have to fork the message repo to add a request. An open upstream PR, zmkfirmware/zmk#3213 "Add a way to jump to bootloader and/or reset settings on startup", is about startup, not host requests (title only, not read).

Studio does matter for flashing in one way. Its USB transport is a CDC ACM UART added by the `studio-rpc-usb-uart` snippet (`zmk-main@4dd95d7` `app/snippets/studio-rpc-usb-uart/`). A keyloom module can watch that same port's line state for the 1200 touch without reading its data. That sharing is unverified.

## The left half can send &bootloader to the right half over BLE, and it works with the right half's existing firmware

`&bootloader` has locality `BEHAVIOR_LOCALITY_EVENT_SOURCE`. On the central, a binding whose event source is not local is sent to that peripheral with `zmk_split_central_invoke_behavior`. Verified in source `zmk-fork@ce69e85` `app/src/behaviors/behavior_reset.c:38`, `app/src/behavior.c:96-101`, `app/include/zmk/split/central.h:35`; the same in `zmk-main@4dd95d7` `app/src/behavior.c:93-105`.

The behavior is sent by device name, at most 8 characters plus a NUL (`app/include/zmk/split/bluetooth/service.h:12`, `:31`). The node is named `bootload` for this reason (`app/dts/behaviors/reset.dtsi:18-19`, with the comment "Behavior can be invoked on peripherals"). `reset.dtsi` has no omit guard, so every build of both halves includes it.

So a keyloom module on the left half can build a binding for `bootload` with `event.source = 0` and invoke it. The right half runs the reset as if its own key were pressed. That needs no change to the right half's firmware. This is how `Magic + '` on the default layout already reaches the right half (`app/boards/arm/glove80/glove80.keymap:121`).

The right half still needs its own USB cable. Over BLE alone it enters UF2 mode, sees no USB within 3 s and goes back to its app (see the bootloader section). That also makes the relay harmless when the right half is unplugged.

The relay's real use is the first keyloom flash of the right half. Once the left half runs keyloom's module, keyloom can put the right half into its bootloader whatever the right half runs, provided it is cabled and connected to the left over BLE. After that, the right half has its own trigger.

## Serial DFU and BLE OTA exist in the bootloader but give keyloom nothing it needs now

In UF2 mode the bootloader exposes both a CDC serial port and the drive. Verified in source `bl-moergo@bb68c75` `src/usb/usb_desc.c:91-119`. `adafruit-nrfutil dfu serial` can flash through that port with a `.zip` package. That would avoid mounting a drive on a headless Linux box. keyloom already copies UF2 files to drives (`src/firmware/zmk/flash.ts`, D-038). Serial DFU would add a Python tool and a second package format. It is not worth it until mounting fails somewhere.

BLE OTA (`0xA8`) is the only cable-free route. The bootloader brings up the SoftDevice and advertises "Glove80 LH Bootloader" (`bl-moergo@bb68c75` `src/main.c:252`, `:323-328`, and `src/boards/glove80_v1_lh/board.h`, `BLEDIS_MODEL`). keyloom would need a Nordic legacy DFU client over BLE on macOS and Linux, plus a `type = <0xA8>` reset behavior on both halves. MoErgo does not document it, and nobody is known to use it on a Glove80. It is a separate project, not part of this design.

## Moonlander rev A: flashing is done, and live editing means Vial or a few keyloom commands

The no-touch flash is shipped: the raw-HID `0xE7` + `KLBOOTLD` packet, wired in with `--wrap=raw_hid_receive`, then Zapp, with a fallback to the reset key (D-070 to D-074, `src/firmware/qmk/handsfree-flash.ts`). Observed: the Moonlander enumerates now with serial `keyloom/YRHRBG0T2H8R`, so it runs a keyloom build and its next flash needs no keypress.

Vial supports the Moonlander. `vial-qmk` has `keyboards/zsa/moonlander/keymaps/vial/` with `VIA_ENABLE`, `VIAL_ENABLE` and `VIALRGB_ENABLE`, and an unlock combo on matrix (0,2) and (0,4). Verified in source `vial-qmk@dd43959` `keyboards/zsa/moonlander/keymaps/vial/rules.mk:1-3` and `config.h:7-11`. That board is upstream QMK's single Moonlander definition (`stm32-dfu`, PID `0x1969`, `keyboard.json:6-8`, `:176`), not ZSA's fork with `reva` and `revb`. `qmk-and-moonlander.md` already records that Vial targets rev A only.

Vial edits more at runtime than Studio does. It changes keymaps, macros, tap dance, combos and key overrides (`quantum/vial.c:227`, `vial_dynamic_entry_op`). Its QMK settings cover tapping term, permissive hold, hold on other key press and chordal hold (`quantum/qmk_settings.c:53-73`). Those are the settings BK's two problems turn on (D-025).

Vial has three costs. Moving to Vial leaves ZSA's fork and Oryx, so Oryx's live view and Keymapp support go. Vial's own bootloader jump only works once the board is unlocked, which needs a physical key combo (`quantum/via.c:434-446`). keyloom's `0xE7` command would keep working, because `via.c` defines `raw_hid_receive` (`quantum/via.c:211`) and the same `--wrap` applies (unverified until built). Macro writes are also refused while the board is locked (`quantum/via.c:398-404`), and so is assigning `QK_BOOT` (`quantum/vial.c:81`).

A smaller route keeps ZSA's fork. keyloom's existing raw-HID wrapper can take a second command that calls QMK's `dynamic_keymap_set_keycode(layer, row, col, keycode)` (`quantum/dynamic_keymap.h:35`). That needs `DYNAMIC_KEYMAP_ENABLE`. It changes keycodes only, not tapping term or combos. Whether `DYNAMIC_KEYMAP_ENABLE` fits in ZSA's fork next to Oryx's modules is unverified.

## Glove80: ZMK Studio is supported by the fork, but a stock build does not enable it

The fork has the Studio code and the snippet, and `glove80.zmk.yml` lists `studio` (`zmk-fork@ce69e85` `app/src/studio/`, `app/snippets/studio-rpc-usb-uart/`, `app/boards/arm/glove80/glove80.zmk.yml:11`). Its Nix build takes `snippets` and `extraModules` (`nix/zmk.nix:8-9`, `:112-113`). Commit `4b2f3b9` (authored 2026-07-15) made `CONFIG_ZMK_STUDIO=y` build at all. Its message says it was tested on the Go60 over BLE. Nothing in the fork says it was tested on the Glove80.

Studio runs only on the left half. `ZMK_STUDIO` selects `ZMK_STUDIO_RPC` only when the half is not a split peripheral (`zmk-main@4dd95d7` `app/src/studio/Kconfig:4-6`). The keymap lives on the central, so Studio's changes cover keys on both halves.

Studio changes bindings, renames layers, enables extra layers defined in devicetree and picks a physical layout. It cannot configure behavior properties (hold-tap timing and flavor), macros, tap dance, combos or conditional layers. From docs https://zmk.dev/docs/features/studio, matching `zmk-main@4dd95d7` `docs/docs/features/studio.md:17-40`. BK's two problems need hold-tap and combo settings (D-025), so a flash stays the way to change those.

Studio locks the keyboard by default. `ZMK_STUDIO_RPC` implies `ZMK_STUDIO_LOCKING`, which defaults to locking after 600 s idle and on disconnect (`app/src/studio/Kconfig:17-28`, `:39`). Unlocking needs a `&studio_unlock` key press. For truly hands-free edits keyloom would set `CONFIG_ZMK_STUDIO_LOCKING=n`. That is the same trade-off as D-070: any local process could then change the keymap.

Once Studio has saved a change, the flashed `.keymap` is ignored until settings are reset (from docs, `studio.md:49`). The RPC `reset_settings` calls `zmk_keymap_reset_settings` (`app/src/studio/core_subsystem.c:66-77`, `keymap_subsystem.c:244-246`). keyloom should call it after each flash, so that its file stays the source of truth, and it should record every live edit in its layout so the next flash keeps it.

keyloom can speak the protocol. It is protobuf with SoF/Esc/EoF framing over a CDC ACM or BLE GATT (from docs https://zmk.dev/docs/development/studio-rpc-protocol). The official client `@zmkfirmware/zmk-studio-ts-client` is MIT-licensed (`zmk-and-glove80.md`). A bun serial transport for it does not exist yet. Opening `/dev/cu.usbmodem*` from bun in raw mode is unverified.

## Corne: the same as the Glove80 on upstream v0.3.0

v0.3.0 has the same `&bootloader` path (`zmk-0.3@edf5c08` `app/src/behaviors/behavior_reset.c:32`, `:38`) on the same Zephyr 3.5. It has the same split relay (`app/src/behavior.c:96-101`) and Studio (`app/src/studio/`, `app/snippets/studio-rpc-usb-uart/`). The Corne shield lists `studio` and chooses a physical layout (`app/boards/shields/corne/corne.zmk.yml`, `corne.dtsi:21-24`).

The differences are in the adapter. Both halves mount as `NICENANO` and take one family ID, so they must be flashed one after the other and matched by marker, not by volume. The nice!nano has a reset pin, so double-tapping reset is the manual fallback, as keyloom's board file already says. Whether the Corne's peripheral half brings up USB without help is unverified, so the module calls `usb_enable` on peripherals, as tadakado's does.

## Recommendation: one module per firmware family, and a small adapter per board

### QMK family (Moonlander and future QMK boards)

Keep D-070 to D-074 unchanged. For live editing, start with keyloom's own `dynamic_keymap_set_keycode` command in the existing wrapper. Move to Vial only if BK wants runtime tapping-term and combo edits on the Moonlander enough to give up Oryx.

### ZMK family on nRF52 with an Adafruit-style UF2 bootloader (Glove80, Corne)

keyloom vendors a small Zephyr module, `keyloom-zmk`, in its tree and passes it to every ZMK build. The fork's Nix takes it through `extraModules` (`nix/zmk.nix:112`). The west builds take `-DZMK_EXTRA_MODULES`. The module is custom code, about 80 lines. tadakado's module is the reference, but it cannot run on keyloom's pins, and keyloom needs the relay and the Zephyr 3.5 path.

The module does five things.

1. A devicetree overlay adds a `zephyr,cdc-acm-uart` node under `&zephyr_udc0` on both halves, unless the Studio snippet already added one on the left half, in which case it watches that one.
2. Kconfig enables `USB_DEVICE_STACK`, `USB_CDC_ACM`, `SERIAL`, `UART_LINE_CTRL` and `UART_INTERRUPT_DRIVEN`, the same set the Studio snippet uses (`app/snippets/studio-rpc-usb-uart/studio-rpc-usb-uart.conf`).
3. A thread polls the port every 250 ms. Port closed at 1200 baud means this half reboots into its bootloader. Port closed at 1201 baud, on the central only, means it relays `bootload` to each peripheral. Both are debounced the way tadakado's module does it.
4. The reboot calls `bootmode_set(BOOT_MODE_TYPE_BOOTLOADER)` then `sys_reboot(SYS_REBOOT_WARM)` when `CONFIG_RETENTION_BOOT_MODE` is set, and `sys_reboot(0x57)` otherwise.
5. On a peripheral with `ZMK_USB` off, it calls `usb_enable(NULL)`.

```c
static void reboot_to_uf2(void) {
#if IS_ENABLED(CONFIG_RETENTION_BOOT_MODE)
    bootmode_set(BOOT_MODE_TYPE_BOOTLOADER);
    sys_reboot(SYS_REBOOT_WARM);
#else
    sys_reboot(0x57); /* Adafruit DFU_MAGIC_UF2_RESET, via NRF_STORE_REBOOT_TYPE_GPREGRET */
#endif
}

#if IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
static void relay_to_peripherals(void) {
    struct zmk_behavior_binding b = {.behavior_dev = "bootload"};
    for (uint8_t i = 0; i < ZMK_SPLIT_CENTRAL_PERIPHERAL_COUNT; i++) {
        struct zmk_behavior_binding_event ev = {.source = i, .timestamp = k_uptime_get()};
        zmk_split_central_invoke_behavior(i, &b, ev, true);
    }
}
#endif
```

`ZMK_SPLIT_CENTRAL_PERIPHERAL_COUNT` exists in the fork (`zmk-fork@ce69e85` `app/include/zmk/split/central.h:29`). The sketch has not been compiled.

A marker identifies keyloom's build and its half, as `keyloom/<12 chars>` does on the Moonlander (D-070). On the Glove80, set `CONFIG_USB_DEVICE_SN="keyloom/<12>-<L|R>:GLV80-0123456789ABCDEF"`. The board code keeps the template's prefix and overwrites only the last 16 characters with the chip ID (`zmk-fork@ce69e85` `app/boards/arm/glove80/usb_serial_number.c:26-39`), and the observed serials have that form. Whether anything of MoErgo's reads the `moergo.com:` prefix is unverified.

On the Corne the same Kconfig does not work. Zephyr 3.5's default `usb_update_sn_string_descriptor` replaces the whole string with the chip ID in hex (`zephyr-3.5@dacab48` `subsys/usb/device/usb_descriptor.c:304-331`). Only the Glove80 board overrides it (`git grep` at `zmk-0.3@edf5c08`). So the module defines its own strong `usb_update_sn_string_descriptor` on boards without one, and returns the marker followed by the chip ID.

The host side reuses what keyloom has.

- Discovery. On macOS, keyloom's IOKit walk (D-071) finds the USB device by the marker in its serial and reads the `IOCalloutDevice` of its CDC interface. On Linux it reads `/sys/class/tty/ttyACM*/device/../serial`, or `/dev/serial/by-id/`. Neither opens anything.
- Trigger. keyloom runs `stty -f <port> 1200` on macOS or `stty -F <port> 1200` on Linux. That needs no serial library in the compiled binary. On Linux the user needs the `dialout` (or `uucp`) group. ModemManager may probe a new ACM port and should be told to ignore it with a udev rule (unverified on BK's machines).
- Flash. The existing `flash.ts` waits for the volume and copies the file. The Glove80's halves have different volumes and can go in parallel or right-then-left as MoErgo says. The Corne's halves go one after the other: trigger one half, copy its image, wait for it to come back with the new marker, then do the other.
- Verify. After a flash, keyloom waits for the half to come back with the new build's marker, as in D-072.
- Fallback. If there is no marker, no port, or no volume within 15 s, keyloom shows the board's existing manual instruction with the reason, as in D-072.

The board adapter adds one block to `board.json`: the trigger kind (`cdc-1200`), each half's target, volume and marker role, whether the central can relay, and how the marker is written (`usb-sn-template` or `usb-sn-override`). A new nRF52 ZMK board with an Adafruit bootloader needs only that block. Other bootloaders (tinyuf2, RP2040, STM32) would need other magic values. ZMK `main` already maps them through retention boot mode, so the module's retention path covers them once keyloom builds on ZMK `main`.

### A half cannot be stranded, and the recovery is the existing key combo

- A half triggered while on battery returns to its app after 3 s (verified above).
- A half triggered on USB waits in its bootloader until it is flashed or power-cycled. keyloom must say so if the copy then fails, as in D-072, and `keyloom flash` must accept a half already sitting in its bootloader. keyloom should keep the last good UF2 per half so that it can always write something known to work.
- A flashed app that crashes or loses USB cannot block recovery. The bootloader reads the DFU key combo before it starts the app (`bl-moergo` `src/main.c:197-209`). On the nice!nano, the double-tap reset is handled by the bootloader too (`bl-ada` `src/main.c`, `DFU_DBL_RESET_MAGIC`).
- keyloom never writes a bootloader UF2 (family `0xd663823c`) through this path.

### What still needs a person or a cable

- A USB cable to each half being flashed. BLE-only flashing would need BLE OTA DFU, which is out of scope.
- The first keyloom flash of each ZMK half. After the left half runs keyloom's module, the relay covers the right half's first flash.
- A Studio unlock key press, unless keyloom builds with `CONFIG_ZMK_STUDIO_LOCKING=n`.
- Hold-tap, combo and macro changes on ZMK, which still take a flash. That flash needs no keypress once the module is in.

### Product check

Hands-free flashing removes a real chore that keyloom repeats on every ZMK change, and the Moonlander shows it pays off. Live editing is a new feature with its own sync problem: Studio's saved settings against keyloom's file. Studio cannot change the settings BK's two problems depend on. Weigh that before building the Studio client.

## Spikes on BK's real boards

1. Build the fork at `ce69e85` with the module for `glove80_lh` and `glove80_rh`. Flash both by key combo. Check that both halves show a `/dev/cu.usbmodem*` port, that the serial carries the marker, and that typing and BLE pairing are unchanged.
2. Run `stty -f <left port> 1200`. Expect `GLV80LHBOOT` within a few seconds. Repeat for the right half.
3. Unplug the right half's cable, send the relay touch to the left, and check that the right half keeps typing (it entered UF2 mode and timed out after 3 s). Plug it in and repeat: expect `GLV80RHBOOT`.
4. Build the left half with `studio-rpc-usb-uart` and `CONFIG_ZMK_STUDIO=y`. Check that https://zmk.studio/ connects, and that the 1200 touch still works on the shared port.
5. Corne: confirm the controller is a nice!nano v2 (the bootloader drive's `INFO_UF2.TXT`), then repeat 1 to 3 with `NICENANO`.
6. Linux: repeat step 2 on a Linux machine and check the `dialout` group and ModemManager.

## Unresolved questions

- Should the relay be a second baud rate (1201) or a short text command on the port? The baud rate needs no data path in the firmware, and a text command could also return the build ID.
- Does the Glove80's factory bootloader on BK's halves match `bl-moergo@bb68c75`? The `0x57` path is old Adafruit code, so it very likely does, but `INFO_UF2.TXT` on each drive would settle it.
- Does anything break when the Glove80's serial no longer starts with `moergo.com:`? MoErgo's Layout Editor and support tools are the ones to check.
- Is building with `CONFIG_ZMK_STUDIO_LOCKING=n` acceptable, given that it lets any local process change the keymap?
