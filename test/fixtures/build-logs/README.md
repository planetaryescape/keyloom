# Build-log lines (R5-02)

The fake `docker` scripts replay these lines, so the build drivers classify them without a real build. Each entry says where its lines come from: a toolchain run outside QMK's or ZMK's container, a message rebuilt from the toolchain's source, or a line recorded in a spike.

- `qmk-unknown-keycode.log`: Arm GNU Toolchain 15.2.Rel1 `arm-none-eabi-gcc -c` on a `keymaps/keyloom/keymap.c` that names `KC_NOPE`, 2026-11-11. An unknown QMK key code fails this way, as a compile error.
- `ld-region-overflow.log`: GNU ld 2.45.1 (Arm GNU Toolchain 15.2.Rel1) linking 256 bytes of data into a 64-byte `FLASH` region, 2026-11-11. The toolchain's install path is shortened to `/opt/arm-gnu-toolchain`. QMK on ARM and ZMK (Zephyr SDK binutils) link with GNU ld.
- `qmk-avr-too-large.log`: QMK's AVR size check, built from `MSG_FILE_TOO_BIG` (`builddefs/message.mk:97`, printed by `platforms/avr/platform.mk:128`) in ZSA's fork at `93b2b9ec`. The numbers are an example. The words are the fork's; the fork prints them in `\033[31;01m`, and this file uses `\033[31m`. The classifier strips both.
- `zmk-devicetree-error.log`: Zephyr's devicetree error on a keymap with a key name it doesn't know. The `devicetree error: …glove80.keymap:89 (column 245)` part is as recorded in `docs/research/spikes/S6.md`. The `parse error: expected number` reason is not in that record; it is an example.
- `zmk-docker-disk-full.log`: a full Docker disk, which can pass once space is freed.
