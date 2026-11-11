# Recorded build-log lines (R5-02)

Each file is what a toolchain printed, replayed by the fake `docker` scripts so the build drivers classify real lines without a real build.

- `qmk-unknown-keycode.log`: Arm GNU Toolchain 15.2.Rel1 `arm-none-eabi-gcc -c` on a `keymaps/keyloom/keymap.c` that names `KC_NOPE`, 2026-11-11. An unknown QMK key code fails this way, as a compile error.
- `ld-region-overflow.log`: GNU ld 2.45.1 (Arm GNU Toolchain 15.2.Rel1) linking 256 bytes of data into a 64-byte `FLASH` region, 2026-11-11. The toolchain's install path is shortened to `/opt/arm-gnu-toolchain`. QMK on ARM and ZMK (Zephyr SDK binutils) link with GNU ld.
- `qmk-avr-too-large.log`: QMK's AVR size check, built from `MSG_FILE_TOO_BIG` (`builddefs/message.mk:97`, printed by `platforms/avr/platform.mk:128`) in ZSA's fork at `93b2b9ec`. The numbers are an example; the words and colour codes are the fork's.
- `zmk-devicetree-error.log`: Zephyr's devicetree script on a keymap with a key name it doesn't know, as recorded in `docs/research/spikes/S6.md` (column 245 on a 100-character line).
- `zmk-docker-disk-full.log`: a full Docker disk, which can pass once space is freed.
