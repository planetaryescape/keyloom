# 22: A new keyboard: connect it and put my config on it

Status: proposal, 2026-10-15. Source baseline: origin/main after v0.19.1.

BK: "If I get a new keyboard I just connect it and say put my config on this. Doesn't matter what keyboard it is as long as it uses ZMK or QMK."

Today a board reaches keyloom as a contributed definition ([04](04-boards-and-contributions.md), rung 8). This chapter makes keyloom build that definition itself, from a keyboard it sees on USB. BK then confirms only what it can't work out, and says "put my config on this" (D-236). The research, with pinned sources and counts across QMK's and ZMK's trees, is [../research/new-keyboard.md](../research/new-keyboard.md).

## Recognising the keyboard

- **QMK:**
  - The USB vendor and product ID names the board from QMK's own data 73% of the time.
  - Adding the product string and device version names it 93% of the time, from a merge of every `info.json` at qmk_firmware `7a1bbf3`.
  - The placeholder `0xFEED:0x0000` is shared by 175 boards, so it always falls back to a list.
  - Only Vial firmware describes itself over raw HID. VIA has no name command.
- **ZMK:**
  - Most boards share ZMK's default ID `0x1D50:0x615E`, and the product string is the only fingerprint. On split shields only the left half carries it.
  - ZMK Studio, where enabled, can return the physical layout.
  - The dependable path is a searchable list of ZMK boards and shields, narrowed by the product string, as `zmk keyboard add` does.
- **When keyloom isn't sure,** it asks once, with the candidates it found. It never guesses silently.

## Building the board definition

The physical layout comes from the firmware tree: QMK's `keyboard.json` `LAYOUT`, or ZMK's `zmk,physical-layout` where the shield has one (29 of 63 in-tree shields do). The rest of the board definition is derived by heuristics that BK confirms:

| Field | How | Tested on BK's boards |
|---|---|---|
| Hands | Split by the widest x-gap | 194 of 194 keys right |
| Thumbs | Rotation and position below the home rows | 26 of 26 right |
| Fingers | Column from the home row | 132 of 132 on the Moonlander and Glove80. The Corne differed by one column because its committed table was wrong, fixed in D-227 (S40) |
| Home row | BK points at it once | Can't be derived |
| Flash recipe | From the bootloader type | 9% of QMK boards use recipes keyloom has. atmel-dfu and stm32-dfu cover 54% and are new recipes |

The derived definition goes through the same `keyloom boards check` as a contributed one. BK can contribute it upstream with one command, which closes the loop with rung 8.

## Putting BK's config on it

- **Start from BK's config, not the board's current keymap.** Only Vial, VIA and Studio-enabled ZMK boards can be read at all. The board's default keymap is built once as a smoke test.
- **"Put my config on this"** maps a chosen layout through rung 19's cross-board mapping ([20](20-cross-board.md)). That covers all layers, combos, macros, tap dances and hold-tap profiles, with placement proposals for anything with no counterpart. It ends in a normal proposal BK applies.
- **The first flash of a new board stays manual.** After it:
  - nRF52 ZMK boards get hands-free flashing through `keyloom-zmk` ([17](17-keyboard-sync.md)).
  - QMK hands-free is ZSA-only today. Generalising it is unproven (S41).

## Corrections the research found

Two corrections were found while researching this (D-237):

- **VIA's jump command.** Mainline QMK's `via.c` has no bootloader-jump handler (only Vial adds one). keyloom's own `0xE7` packet doesn't depend on VIA, so D-070's mechanism is unaffected, but any text implying VIA could do the jump is wrong.
- **The ZSA-only check.** The keyboard-state reader's `isKeyboard` hard-codes ZSA's vendor ID. A new QMK board would be invisible to `doctor` and sync until that is generalised. This is part of this rung.
