---
name: add-keyboard
description: Add, model or contribute a QMK or ZMK keyboard to keyloom, from a local board export, USB identification or a firmware tree. Keep a polished generated case until photos permit a faithful model, and prepare a checked board-folder PR.
---

# Add a keyboard to keyloom

The result is one folder, `boards/<vendor>/<board>/`, in a pull request that touches nothing else. `CONTRIBUTING.md` is the reference for every field and recipe; this skill is the order to do it in and the checks that prove it. Read `CONTRIBUTING.md` once before starting, and follow it where the two differ.

Run `bun install` once in the clone. For repo changes, wherever this says `keyloom`, run `bun src/cli/main.ts`. The installed app also loads locally derived boards from its data directory; a new repo folder is only visible to a checkout that contains it. Pass a scratch `--data-dir` before the command name so contributor testing stays separate from real layouts.

If the person already added the board in the app, use **Manage keyboards → Prepare contribution** or `keyloom keyboard contribute <board> --as <maker>/<keyboard> --out <new-directory>`. Read the exported `CONTRIBUTION.md`, copy only its `boards/<maker>/<keyboard>/` folder into the clone, and continue at step 2. The export publishes nothing and excludes personal configs and recordings; keep the handoff file outside the PR.

## 0. Ask what you need, once

Ask the contributor for:

- the keyboard's name and maker, and whether it runs QMK or ZMK. The vendor folder is the maker as people know them (`mkdl/unix60`), not the folder the firmware sits in (`keyboards/fr4/unix60`);
- whether they own it and can flash it. If not, the board can still be added: build it if Docker is available, and say in the PR that it wasn't flashed (`CONTRIBUTING.md` step 7). It then waits for an owner to confirm;
- whether it is plugged in now;
- two or three photos of the real board from above (their own, or the maker's product shots), if available. Without them, retain the shared sculpted caps and generated shaded, raised enclosure. Describe the case as approximate and offer to refine it when photos arrive; lack of photos does not block local use or a draft contribution.

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

Without `--home-row` it prints the rows it found and writes nothing; ask the contributor which row their fingers rest on. The derived board lands in `/tmp/keyloom-<board>/boards/local/<keyboard>/`: its `board.json` and `geometry.json` are the starting point for the repo folder. Copy them to `boards/<vendor>/<board>/`, set the board ID to that folder path, and continue at step 2.

If it isn't plugged in, search by name with `keyloom keyboard detect --search <name>`; the same `keyboard add` command works without USB. If the index cannot supply the board, follow `CONTRIBUTING.md` steps 1 to 3 by hand: pin the firmware tree (mainline QMK or ZMK, or the maker's fork when only that has the controller) and the Docker image, copy `boards/_template/qmk` or `boards/_template/zmk`, and generate the geometry with `keyloom boards geometry boards/<vendor>/<board>`. Delete the QMK template's `layoutFile` when the layouts are in `keyboards/<qmkTarget>/keyboard.json`. Never write `geometry.json` by hand; it comes from the pinned firmware.

## 2. Hands, fingers, rows and mirror

Open the position overlay on a free port, without letting it open a browser:

```sh
keyloom --data-dir /tmp/keyloom-<board> serve --board-dev <vendor>/<board> --port <free port> --no-open
```

Open the printed link, including its `?t=` token. Keys are numbered from 1, as the editor numbers them; `board.json` counts from 0. Selecting a key shows what `board.json` says about it, and **Reload board.json** picks up edits. Every position must appear exactly once in `hands`, `fingers` and `rows`. Ask the contributor about any key whose finger is a judgement call.

A one-piece board still has two hands. Split it at the touch-typing line: 6, Y, H and N go right (B stays left), and give the spacebar to the thumb that presses it, so the bottom row's modifiers fall to the hand on their side.

`mirror` pairs a left key with the right key at the mirrored spot. Each pair is on one row and under one finger, and each right key is a target once. Pair every key on a split board with halves of the same size. For uneven thumb clusters, pair the thumb keys that sit in the same place and leave the extras out. For a one-piece board, pair from the touch-typing line outwards (F with J), or leave `mirror` empty. `CONTRIBUTING.md` step 4 has the rules.

## 3. Draw it like the real object

A board with no custom model still uses the app's physical renderer: sculpted caps, a generated raised body, shadows and the room's materials. This is a valid approximate starting point. If there are no photos, keep that fallback instead of inventing case details and continue to step 4. With photos, make it look like the keyboard on their desk. Everything here lives under `display` in `board.json` and changes only how the board is drawn, never what positions mean. The field reference is the `display` rows in `CONTRIBUTING.md`.

Work from the photos:

1. **Spacing.** If a split board's halves are drawn too close (their thumb clusters meet), slide one hand with `display.shift` (`dx` in key units). A real split board always shows a gap.
2. **Stagger and tilt.** Column stagger the geometry lacks is one `display.shift` entry per column with its own `dy`, negative to move up. Thumb keys or columns that turn on the real board and not in the geometry go in `display.rotate`.
3. **Odd caps.** A cap that isn't a rectangle (the Moonlander's red "house" thumb keys) goes in `display.keyShapes`; a cap of a different colour in `display.keycaps`.
4. **Surface.** `wells` for sculpted column wells (the Glove80), `deck` for a laptop deck; leave it out for a flat case.
5. **The case.** Trace the real outline as `display.case` parts: SVG paths in key units after `rotate` and `shift`. Each piece of the case is a `body` (a split board has one per half; a one-piece board one with `hand: null`), and a thumb cluster printed as part of the case is part of its `body`. `module` is only for a physically separate plate, such as the Moonlander's hinged thumb block. Add `ball` for a trackball, `hole` for screw heads, and `leg`, `knob`, `screen` and the rest only where the photos show them. Leave palm rests out. `boards/zsa/moonlander/board.json` is the worked example.
6. **Status LEDs** go in `display.statusLeds` where the case has them.

To trace a case from a photo:

1. Use a photo taken from straight above. Measure, in pixels, the centres of two keys a known number of key pitches apart on one row (on most boards one pitch is 19.05 mm, which is 1u). Their distance divided by the pitches between them is the pixel size of 1u.
2. Pick an unrotated key as the origin. Its key-unit position is its `x` and `y` in `geometry.json` plus any `display.shift` it has. A point on the photo is then `(pixel − origin pixel) / pixels per u + origin in u`.
3. Convert the outline's corners this way, round to two decimals, and write the path with `M` and `L`, rounding each corner with a short `Q`, as `roundedPath` in `src/web/keyboard/case-shape.ts` does.
4. Check it by overlaying the render on the photo: screenshot the overlay, scale it so 1u matches the photo, and lay one over the other at half opacity. Fix what doesn't line up.

Then look at it in the editor. The editor shows imported layouts, so import a stock keymap first (QMK: the keymap folder or its `keymap.json`; ZMK: the `.keymap`), then serve it on a second port while the overlay runs on the first:

```sh
keyloom --data-dir /tmp/keyloom-<board> import --board <vendor>/<board> <path to keymap folder, keymap.json or .keymap>
keyloom --data-dir /tmp/keyloom-<board> serve --port <another free port> --no-open
```

Take screenshots at 1440×900, 1366×768, 1280×577 and 390×844 in both themes, and put each next to a photo in one image. Every key must sit inside its body with a margin, and nothing may overlap across hands. On a phone a split board shows one hand at a time and a one-piece board stays whole, scrolling sideways when it is wide. Show the contributor the side-by-side and fix what they point at. Say plainly what still differs from the photos.

## 4. Optionally, the board's `SKILL.md`

`boards/<vendor>/<board>/SKILL.md` is added to keyloom's agent context for this board. Write only what the contributor knows from using it: which key opens the maker's system layer and must stay reachable, which thumb keys are easiest, how the factory layout is organised. Under 400 lines; `boards check` warns past that.

## 5. Check, import, build, and flash only with permission

```sh
keyloom boards check boards/<vendor>/<board>      # must say ok; it re-fetches the firmware file and compares geometry
bun test test/boards test/web/stage-fit.test.ts    # the board loads, its mirror is sound, and it fits the editor's stage at every size
```

Then the end to end test in `CONTRIBUTING.md` ("Test the board end to end"): build the layout you imported and, once the contributor says so, flash it to their keyboard and confirm the keys type what the editor shows. The pull request must say whether they flashed their own board.

## 6. The pull request

Only `boards/<vendor>/<board>/` changes, plus a note in `docs/issues/` when one is needed (below). Use `CONTRIBUTING.md` step 7 for what the description must contain (keyloom version, firmware pin, what was flashed and how it behaved). Attach render screenshots, with photo comparisons when available. Label an approximate case and any missing hardware verification; an unflashed draft waits for an owner to verify it.

When the board needs something keyloom can't do (a new flasher, a part the drawing can't express), don't work around it in `board.json`: draw what the schema can, and say in the PR what differs and why. If it needs a code change, describe it in the PR, or add a short note to `docs/issues/` in the same PR; this project tracks issues there, not on GitHub.
