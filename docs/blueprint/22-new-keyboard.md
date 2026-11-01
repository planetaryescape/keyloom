# 22: A new keyboard: connect it and put my config on it

Status: engine and CLI built (rung 21 part 1, D-330 to D-335), 2026-10-16, on origin/main at `f0ac50d` (v0.31.1); the screens built on fake USB (part 2, D-336) and used on BK's real Moonlander and Keebart Corne, 2026-10-30; a board keyloom already knows but that has no config now opens its own setup card (put a config, import, or start blank), and a refused put leaves no config and says why, 2026-10-30, on main at `b95012e` (v0.61.0); the agent's `put_config` hands adaptation to a separate target conversation (D-460); the DFU flash recipes and the smoke build (S43) are built and run only against fakes and Docker, 2026-10-17, rung 21 part 2 (D-365 to D-369), so no recipe has flashed a physical keyboard. The rest of this chapter is the design it follows. Detection ran against BK's real USB bus once (S42) and the derived boards built in Docker (S43), both in [15](15-open-questions.md); the Keebart Corne and the Moonlander have since gone through the setup flow on physical boards, but the derived QMK DFU recipes are still untested.

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
| Flash recipe | From the bootloader type | 9% of QMK boards used recipes keyloom had. atmel-dfu, caterina and stm32-dfu cover 76% of the boards with USB IDs and are the new `dfu-tool` recipes (D-365) |

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

## What is built so far

Part 2 is the screens (D-336). They follow the sync engine's USB reads, which now publish unknown keyboards on the event stream. A stage card names the keyboard, and the column beside its drawn board asks for the home row and the controller. It then shows the board as read, with each finger and the flash. Putting a config on it ends in the new config's open proposals. The routes are `/api/keyboards/…` and `/api/configs/:ref/proposals`. Nothing in the flow writes to a device.

A board keyloom already knows but that has no config now opens a setup card too. The engine publishes those boards as `setupBoards` beside the unknown ones, because the board switch lists only boards that have a config and the board would otherwise be invisible. `src/web/keyboards/SetupCard.tsx` offers putting one of BK's configs on it, importing the board's own export, or starting blank; a chip in the board switch keeps it one click away after "Not now". The put is one transaction: when the validator refuses the mapping, no config is left behind, `previewPut` returns the refusal as `problems` and the page disables Make with the key and reason, and the server maps the failure to a 400 instead of an internal error. The source list leaves out archived configs and puts the ones on a keyboard first. That closes the first-run gap found while setting up BK's Corne and Moonlander on 2026-10-29.

Part 2 also added the flash recipes for a derived QMK board (D-365 to D-367) and the smoke build (D-368). A board with atmel-dfu, stm32-dfu or caterina gets a `dfu-tool` flash: keyloom waits for the bootloader (its USB ID, or for Caterina a new serial port), runs `dfu-programmer`, `dfu-util` or `avrdude`, checks each command exited 0, then waits for the keyboard to enumerate again. The tool is the person's to install, and `keyloom doctor` names the `brew install` line for each one a board needs. The chip the tools are told about is the `processor` in QMK's data, now in the keyboard index.

Part 1 is the engine and the CLI, with no screens. The demo runs with fakes in `test/app/keyboard-new.test.ts`: BK's Corne is hidden from detection, and a fake USB device with its real product string over ZMK's default ID is named, confirmed, derived and given his Glove80 layout.

- **Detect** (`keyloom keyboard detect`): the QMK and ZMK keyboards on USB, with vendor ID, product ID, product string and device version (`bcdDevice`, new in `src/firmware/toolchain/usb.ts`), each either a board keyloom has or a ranked list with the reasons. Index and matching: `src/boards/derive/`, `scripts/gen-keyboard-index.ts` (D-331). The index covers every QMK keyboard with USB IDs in the pinned tree, not a subset (about 890 KB); a QMK keyboard whose layout comes from `community_layouts` has none in its own files and cannot be derived yet.
- **Add** (`keyloom keyboard add`): reads the layout from the pinned tree (`keyboards/**/info.json` merged down to the keyboard, or ZMK's `zmk,physical-layout`, now addressable as `file#label` where a file holds several; 29 of 66 ZMK shields have one keyloom can read), derives hands, thumbs, fingers, rows and mirror pairs (D-332), builds the recipes (D-333), runs `boards check` on a copy, and stores the board (D-330). The home row, and for a ZMK shield the controller, are the confirmations. One to five small files are fetched from GitHub the first time and cached by SHA, as `boards geometry` does.
- **Put** (`keyloom keyboard put <layout> --on <board>`): D-334. Native keys whose meaning keyloom reads come across as the target's own (one-shot shifts, lighting, boot and reset keys, D-451); each key that doesn't says why.
- **The keyboard-state reader** (D-335): a derived QMK board is seen by doctor; sync still needs a keyboard keyloom can restart.
- **The agent** knows the three commands (`src/agent/prompts/system.md`), and a derived board's configs are in `list_layouts` like any other. `put_config` (D-372) runs `keyboard put` from chat as proposals on a new config; it applies nothing, and the validator checks every proposal (D-014). It works on the MacBook keyboard too (D-383), and the agent calls it at once with defaults (D-384).

Not built, and not guessed at:

- Flash recipes for the bootloaders that are neither a UF2 drive nor one of the three DFU ones (`halfkay`, `usbasploader`, `bootloadhid`, `stm32duino`, `wb32-dfu` and the rest). A derived board with one is flashed by hand and says so when it is added.
- A flash on a physical keyboard. The three `dfu-tool` recipes run the commands QMK's flashing guide gives and are tested against fake tools and a fake USB bus only (D-369).
- Reading Studio, Vial or VIA for the keyboard's own name or keymap, a bootloader drive's Board-ID for the controller, and the right half of a split ZMK keyboard (its product string is unobserved, spike 4).


## Agent copies refine a separate target config

The agent's `put_config` now hands adaptation to a conversation owned by a separate, unselected config (D-460), replacing the direct mapping alternatives described above for agent calls. Its first proposal adapts the complete setup from the existing translator's seed and source/target remembered reasons. D-452 questions refine it, and Apply records the final reason. Original configs and board selection stay intact, including when the target board has no config yet. Direct `keyboard put` retains its deterministic proposal behavior.
