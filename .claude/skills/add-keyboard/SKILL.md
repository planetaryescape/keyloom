---
name: add-keyboard
description: Add a new QMK or ZMK keyboard to keyloom as a board folder, from a plugged-in keyboard or its firmware tree, drawn faithfully from photos of the real board, and checked end to end. Use when a contributor wants keyloom to support their keyboard.
---

# Add a keyboard to keyloom

The result is one folder, `boards/<vendor>/<board>/`, in a pull request that touches nothing else. `CONTRIBUTING.md` is the reference for every field and recipe; this skill is the order to do it in and the checks that prove it. Read `CONTRIBUTING.md` once before starting, and follow it where the two differ.

Run keyloom from the clone, because a new board only exists for a keyloom started from a checkout that has its folder: wherever this says `keyloom`, run `bun src/cli/main.ts`. Use a scratch data directory (`--data-dir /tmp/keyloom-<board>`) for every import, build and flash, so the contributor's real layouts are never touched.

## 0. Ask what you need, once

Ask the contributor for:

- the keyboard's name and maker, and whether it runs QMK or ZMK;
- whether it is plugged in now;
- two or three photos of the real board from above (their own, or the maker's product shots). The drawing is made from these; without them, say the case will be drawn from the keys and offer to redo it when photos arrive.

Never flash their keyboard without their go-ahead in this session. Building is fine.

## 1. Let keyloom derive what it can

If the keyboard is plugged in:

```sh
keyloom --data-dir /tmp/keyloom-<board> keyboard detect
```

It lists candidates with reasons. When one is right:

```sh
keyloom --data-dir /tmp/keyloom-<board> keyboard add --candidate <id> --home-row <row>   # --controller <name> for a ZMK shield
```

Without `--home-row` it prints the rows it found and writes nothing; ask the contributor which row their fingers rest on. The derived board lands in `/tmp/keyloom-<board>/boards/local/<keyboard>/`: its `board.json` and `geometry.json` are the starting point for the repo folder. Copy them to `boards/<vendor>/<board>/`, set the board ID to that folder path, and continue at step 3.

If it isn't plugged in, or detection can't name it, follow `CONTRIBUTING.md` steps 1 to 3 by hand: pin the firmware tree and Docker image, copy `boards/_template/qmk` or `boards/_template/zmk`, and generate the geometry with `keyloom boards geometry boards/<vendor>/<board>`. Never write `geometry.json` by hand; it comes from the pinned firmware.

## 2. Hands, fingers, rows and mirror

A derived board has these filled in from heuristics (hands by the widest gap, thumbs by rotation and position, fingers by column from the home row). Check every one against the real board with the position overlay:

```sh
keyloom serve --board-dev <vendor>/<board>
```

Open the printed link, including its `?t=` token. Each key shows its position; selecting one shows what `board.json` says about it, and **Reload board.json** picks up edits. Every position must appear exactly once in `hands`, `fingers` and `rows`, and every left position needs a `mirror` entry. Ask the contributor about any key whose finger is a judgement call.

## 3. Draw it like the real object

A board drawn as rectangles in a generic tray is wrong. Make it look like the keyboard on their desk. Everything here lives under `display` in `board.json` and changes only how the board is drawn, never what positions mean. The field reference is the `display` rows in `CONTRIBUTING.md`.

Work from the photos:

1. **Spacing.** If a split board's halves are drawn too close (their thumb clusters meet), slide one hand with `display.shift` (`dx` in key units). A real split board always shows a gap.
2. **Tilt.** If the photos show thumb keys or columns turned, and the geometry doesn't, add `display.rotate`.
3. **Odd caps.** A cap that isn't a rectangle (the Moonlander's red "house" thumb keys) goes in `display.keyShapes`; a cap of a different colour in `display.keycaps`.
4. **Surface.** `wells` for sculpted column wells (the Glove80), `deck` for a laptop deck; leave it out for a flat case.
5. **The case.** Trace the real outline as `display.case` parts: SVG paths in key units after `rotate` and `shift`, one `body` per half plus a `module` for each separately shaped part (a thumb cluster, a hinged block). Add `leg`, `knob`, `screen` and the rest only where the photos show them. Leave palm rests out. `boards/zsa/moonlander/board.json` is the worked example.
6. **Status LEDs** go in `display.statusLeds` where the case has them.

Then look at it: start `keyloom serve --board-dev <vendor>/<board>` and the editor, take screenshots at 1440×900, 1366×768, 1280×577 and 390×844 in both themes, and put each next to a photo. Every key must sit inside its body or module with a margin, nothing may overlap across hands, and the board must fit the stage at every size. Show the contributor the side-by-side and fix what they point at. Say plainly what still differs from the photos.

## 4. Optionally, the board's `SKILL.md`

`boards/<vendor>/<board>/SKILL.md` is added to keyloom's agent context for this board. Write only what the contributor knows from using it: which key opens the maker's system layer and must stay reachable, which thumb keys are easiest, how the factory layout is organised. Under 400 lines; `boards check` warns past that.

## 5. Check, import, build, and flash only with permission

```sh
keyloom boards check boards/<vendor>/<board>          # must say ok; it re-fetches the firmware file and compares geometry
bun test test/web/fit.test.ts test/boards              # the drawing still fits and the board loads
```

Then the end to end test in `CONTRIBUTING.md` ("Test the board end to end"): import a layout, build it, and, once the contributor says so, flash it to their keyboard and confirm the keys type what the editor shows. The pull request must say they flashed their own board.

## 6. The pull request

Only `boards/<vendor>/<board>/` changes. Use `CONTRIBUTING.md` step 7 for what the description must contain (keyloom version, firmware pin, what was flashed and how it behaved), and attach the photo-versus-render screenshots. If something needed code (a new flasher, a renderer change), stop and open an issue instead, as `CONTRIBUTING.md` says.
