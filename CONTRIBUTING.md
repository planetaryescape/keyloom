# Adding a keyboard to keyloom

Using Claude Code? Run `/add-keyboard` in a clone of this repo. It walks you through the steps below, including drawing your board from photos of it.

A board is a folder in this repo. You add one with a pull request that holds only that folder. You don't write code.

You need the keyboard on your desk. keyloom's maintainer can't test hardware he doesn't own, so your PR must say you built the firmware and flashed it to your own board.

The folder is `boards/<vendor>/<board>/`. The board ID is the folder path, such as `foostan/corne`. Use lowercase letters, digits and dashes. The vendor is the maker as people know them, not the folder their firmware happens to live in: the Unix60 is by mkdl, so it is `mkdl/unix60`, though QMK keeps it under `keyboards/fr4/`.

## Before you start

You need these installed:

- [bun](https://bun.sh).
- Docker. On macOS with Colima, Docker only sees folders under your home directory. keyloom keeps its build files in `~/.cache/keyloom`, which is fine. Set `XDG_CACHE_HOME` to a folder under your home directory if you moved it.
- git.

Clone this repo and install its packages:

```sh
git clone https://github.com/planetaryescape/keyloom
cd keyloom
bun install
```

Run keyloom from the clone, because a new board is only known to a keyloom started from a clone that has its folder. Wherever this guide says `keyloom`, run this instead:

```sh
bun src/cli/main.ts
```

Check that it works:

```sh
bun src/cli/main.ts --version
bun src/cli/main.ts doctor
```

`doctor` shows whether Docker is running. It warns about `zapp`. Ignore that warning unless your board is a ZSA board.

Use a scratch data directory for your own layouts, so test imports don't mix with real ones. Add `--data-dir /tmp/keyloom-test` to any command that imports, builds or flashes.

## The seven steps

### 1. Find the firmware tree and pin it

keyloom builds from an exact commit of the firmware source. Find the repo that builds your board.

For QMK, that is usually [`qmk/qmk_firmware`](https://github.com/qmk/qmk_firmware). Find your keyboard under `keyboards/`. Some boards have a revision folder, such as `keyboards/crkbd/rev1`. Read the folders at the commit you pin, not the board's readme, which can be out of date.

Use mainline QMK when it has a folder for the controller your board has. Some makers keep newer controllers only in their own fork (Bastard Keyboards' RP2040 boards are in `bastardkb/bastardkb-qmk`). Then pin the fork: `source.repo` can be any GitHub repo, and each controller is its own entry in `revisions`.

For ZMK, that is [`zmkfirmware/zmk`](https://github.com/zmkfirmware/zmk). Find your board's shield under `app/boards/shields/<name>/`. A split board lists its two halves in `<name>.zmk.yml` under `siblings`, such as `corne_left` and `corne_right`.

Pin a commit. Use a release tag so the pin means something:

```sh
git ls-remote https://github.com/zmkfirmware/zmk refs/tags/v0.3.0
```

The 40-character hash is the `sha`. The tag is the `ref`. For QMK you can pin a recent commit of `master`:

```sh
git ls-remote https://github.com/qmk/qmk_firmware refs/heads/master
```

Next, pin the Docker image that builds it. keyloom wants a digest so the image can't change under you:

```sh
docker pull zmkfirmware/zmk-build-arm:stable
docker inspect --format '{{index .RepoDigests 0}}' zmkfirmware/zmk-build-arm:stable
```

For QMK use `ghcr.io/qmk/qmk_cli:latest` in the same two commands. Put the whole result, including `@sha256:...`, in `build.image`.

### 2. Write `board.json`

Pick a template and copy it:

```sh
mkdir -p boards/foostan
cp -r boards/_template/zmk boards/foostan/corne     # or boards/_template/qmk
```

Open `boards/foostan/corne/board.json` and replace every value. The template is a four-key toy board, so you will replace the key facts too. [How to pick a recipe](#how-to-pick-a-recipe) says which build and flash recipe to use. [The field reference](#boardjson-field-reference) says what each field means.

Leave `hands`, `fingers`, `rows` and `mirror` as they are for now. Step 4 fills them in. Set `keyCount` to the number of keys on the board, counting both halves. The QMK template's `layoutFile` points at an `info.json`; delete it when the layouts are in `keyboards/<qmkTarget>/keyboard.json`, as they are for most boards in current QMK.

### 3. Generate `geometry.json`

keyloom draws your board from `geometry.json`. You never write this file. keyloom generates it from the pinned firmware tree:

```sh
keyloom boards geometry boards/foostan/corne
```

It fetches one file from GitHub at your pinned commit and writes `geometry.json` beside `board.json`. For QMK it reads the `layouts` entry named by `build.layoutMacro`, from `build.layoutFile` when you set it, and else from `keyboards/<qmkTarget>/keyboard.json`. For ZMK it reads the `zmk,physical-layout` node in `build.physicalLayout`.

The keys come out in the firmware's order. For QMK that is the order of the keys in the layout macro. For ZMK it is the order of the `keys` in the `zmk,physical-layout` node, which is also the order a `.keymap` lists its bindings in. Position 0 is the first of them. That order matters for everything that follows.

If this fails, the message says what is wrong. The usual causes are a wrong path, a wrong `layoutMacro`, or a `keyCount` that differs from the file.

### 4. Fill in hands, fingers, rows and mirror

keyloom's agent and validator need to know which hand and finger each key belongs to. The firmware doesn't say. Open the position overlay:

```sh
keyloom serve --board-dev foostan/corne
```

It prints a link with a `?t=` token on the end. Open that exact link; the bare address shows "This page needs keyloom's link". If port 4477 is taken (another `keyloom serve` is running), add `--port 4478`. Each key shows its number counted from 1, as the editor does. `board.json` counts from 0, so the key the overlay calls 1 is position 0 in `board.json`. The panel shows both.

Hover or select a key to see what `board.json` says about it. The page reads `board.json` again when you press **Reload board.json**, so edit the file and reload to check your work. The panel counts how many positions each fact covers.

Fill in these four fields. Every position from 0 to `keyCount - 1` must appear exactly once in `hands`, once in `fingers` and once in `rows`.

- `hands` has `left` and `right`, each a list of positions.
- `fingers` maps every position to a name. Use `left-pinky`, `left-ring`, `left-middle`, `left-index`, `left-thumb`, and the same with `right-`. Give each key to the finger that normally presses it. On a column-staggered split, the index finger usually takes the two inner columns, and on a 6-column board the pinky takes the two outer columns.
- `rows` maps a row name to its positions. Use names like `number`, `top`, `home`, `bottom`, `thumb`.
- `mirror` maps a left-hand position to the right-hand key at the mirrored spot. It lets keyloom answer "do that on the other hand too", such as copying home-row mods across. Each pair is on one row (the same name in `rows`) and under the same finger, and each right-hand key is the target of one entry at most. On a split board with halves of the same size, pair every key: same row, same distance from the outer edge. The tests then check that the pairs are mirror images in the drawing.
  - Uneven thumb clusters (five thumb keys on the left, three on the right): pair the thumb keys that sit in the same place under the thumb, such as the key the thumb rests on with its opposite, and leave the extra keys out. Don't pair a key with one that is somewhere else just to fill the map.
  - A one-piece board (a 60%, a laptop): pair each key with the one the same finger presses on the same row, counting out from the touch-typing line (F with J, D with K, and so on). Leave out keys with no opposite, such as a spacebar or the extra keys at the right end of a row. You may also leave `mirror` empty; `boards check` then doesn't warn.
  - `boards check` warns about each left key without a partner on a split board. A warning for a key that has no opposite is expected.

The overlay keeps going without a `board.json`, so you can open it before step 2 is done.

### 5. Optionally write `SKILL.md`

`SKILL.md` is plain Markdown that keyloom adds to the agent's context for your board. Write what the facts can't say: which key opens a vendor's system layer and must stay reachable, which thumb keys are easiest to press, how the factory layout is organised.

Write only what you know from using the board. Keep it under 400 lines. `boards check` warns past that, because every agent turn pays for it. Skip this step if you have nothing to add.

### 6. Check, import, build and flash

Check the folder:

```sh
keyloom boards check boards/foostan/corne
```

It must report `ok`. It checks the fields, then fetches the firmware file again and fails if `geometry.json` differs from it. CI runs the same command.

Then prove the board works end to end with your own layout. [Test the board end to end](#test-the-board-end-to-end) has the commands.

### 7. Open the pull request

Put only `boards/<vendor>/<board>/` in the PR. Do not change any other file, except for a note in `docs/issues/` when the board needs a code change (below).

The PR description must say all of this:

- The keyloom version, from `keyloom --version`.
- That you built the firmware with keyloom and flashed it to your own board, and that the board then typed correctly. If you built it but can't flash it (you don't have the board to hand), say so plainly. The PR then waits until someone who owns the board flashes it and confirms.
- Which board and revision you own, and which firmware tree and commit you pinned.
- Which layout you imported. Say if it was a stock keymap or your own.
- The output of `keyloom boards check`.

Commit messages use `type: description`, such as `feat: add the foostan/corne board`.

The maintainer reviews the format only. He can't test your hardware, so he relies on what you state.

## How to pick a recipe

A recipe says how keyloom builds and flashes a board. It is the `kind` of `build` and of `flash` in `board.json`.

| Your board | `build.kind` | `flash.kind` |
| --- | --- | --- |
| ZSA Moonlander, Voyager or another ZSA board built from ZSA's QMK fork | `qmk-docker` | `zapp` |
| QMK board on STM32 with the stm32-dfu bootloader, from any QMK tree | `qmk-docker` with `artifact: "bin"` | `dfu-tool` (dfu-util) |
| QMK board on AVR with the atmel-dfu bootloader | `qmk-docker` with `artifact: "hex"` | `dfu-tool` (dfu-programmer) |
| QMK board on AVR with a Caterina bootloader (Pro Micro, Elite-C) | `qmk-docker` with `artifact: "hex"` | `dfu-tool` (avrdude) |
| Any other QMK bootloader | `qmk-docker` | `manual` |
| QMK board on RP2040 with a UF2 bootloader | `qmk-docker` with `artifact: "uf2"` | `uf2-drives` |
| ZMK split board from upstream ZMK, such as the Corne on a nice!nano | `zmk-west-docker` | `uf2-drives` |
| MoErgo Glove80 | `zmk-moergo-template` | `uf2-drives` |

Use `build.kind: "qmk-docker"` for every QMK board. The firmware tree it builds from is the `source` of the revision, so mainline QMK and a vendor's fork both work.

`manual` means keyloom builds the file but can't flash it. `keyloom flash` then fails with the file's path and your `instructions`. Flash the file yourself with QMK Toolbox, `qmk flash`, `dfu-util` or `avrdude`, and say so in the PR. `dfu-tool` runs dfu-programmer, dfu-util or avrdude, which the person installs (`keyloom doctor` says how). `zapp`, `uf2-drives` and `dfu-tool` flash from keyloom today. A new flasher needs code, and that is the one case where a board PR is more than data. This project tracks issues as Markdown in `docs/issues/`, not on GitHub: describe what's needed in the PR, or add a short note there in the same PR. The same goes for a part of the real board the drawing can't express: draw what `display` can, and say in the PR what differs, rather than working around it in `board.json`.

### QMK: `qmk-docker`

- `qmkTarget` is what you give `make`, such as `crkbd/rev1`. It is the folder under `keyboards/`.
- `layoutMacro` is the `LAYOUT_*` name the keymap is written with, such as `LAYOUT_split_3x6_3`. Find it in the board's `keymap.c` or its `info.json`.
- `layoutFile` is the JSON file that holds the board's `layouts`, when that isn't `keyboards/<qmkTarget>/keyboard.json`. Some boards keep them in an `info.json` one folder above the revision, such as `keyboards/crkbd/info.json`. Delete the field when the layouts are in `keyboards/<qmkTarget>/keyboard.json`.
- `keymapsDir` is the folder keyloom writes its keymap into, such as `keyboards/crkbd/keymaps`.
- `submodules` lists the git submodules the build needs. Other submodules are skipped to keep the checkout small. An AVR board (a Pro Micro or Elite-C, whose bootloader is `caterina`, `atmel-dfu`, `qmk-dfu`, `lufa-dfu`, `halfkay` or `lufa-ms`) needs `lib/lufa`. An ARM board needs `lib/chibios`, `lib/chibios-contrib` and `lib/printf`, and an RP2040 also `lib/pico-sdk`. These are what `keyboard add` puts in a derived board; if the build fails on a missing file under `lib/`, add that submodule here.
- `artifact` is `bin` (the default), `hex` or `uf2`. It is the file `make` produces.
- Each revision of a board with several hardware revisions is its own entry in `revisions`. keyloom can pick one from a connected keyboard when you set `detect.usbProductId`. Otherwise people pass `--board-rev`.

### ZMK: `zmk-west-docker`

For external hardware definitions, set `boardModule` to their repository URL and immutable commit SHA. `source` still pins ZMK itself. Geometry comes from `physicalLayout` in the hardware module; append `#label` to select its physical layout in the generated keymap. See `boards/keebart/corne-choc-pro-bt/board.json` for an integrated split board with separate targets and rotary encoders.

`config` supplies board defaults before the layout settings in the generated `.conf`. `sensorBindings` supplies one devicetree binding per sensor, in hardware order, on every layer. Encoder presses remain normal key bindings.

- `board` is the `west build -b` board, such as `nice_nano_v2`. A shield whose `.zmk.yml` says `requires: [pro_micro]` fits any Pro Micro–compatible controller; the nice!nano v2 is one.
- `targets` has one entry per half. `shield` is the optional `-DSHIELD` value, such as `corne_left`. Integrated boards set a per-target `board` instead, such as `corne_choc_pro_left`. `id` is a short name, such as `left`.
- `keymapName` is the shield name without `_left` or `_right`. keyloom writes `config/<keymapName>.keymap` and `config/<keymapName>.conf`.
- `physicalLayout` is the file in the ZMK tree that holds the `zmk,physical-layout` node. Look in `app/dts/layouts/` for your board, such as `app/dts/layouts/foostan/corne/6column.dtsi`. Boards with several layouts, such as 5-column and 6-column, have several files. To find which one your shield uses, open the shield's `.dtsi` under `app/boards/shields/<shield>/` and look for `chosen { zmk,physical-layout = &...; }`; the file that defines that label is the one. Its key count must equal `keyCount`.
- Each flash step has a `target` that names a build target. `volume` is the label of the boot drive. A nice!nano shows up as `NICENANO`. `enter` is how to put that half into its bootloader. For a nice!nano that is a double tap on the reset button.

keyloom builds in the Docker image with `west`. The first build downloads Zephyr and ZMK's modules into `~/.cache/keyloom/build/<board>`, so it takes several minutes. Later builds reuse them. The Docker image's Zephyr must match your pinned ZMK. Use the `stable` image for a stable ZMK release.

## Test the board end to end

Import a real layout. Use a stock keymap if you have no layout of your own.

```sh
# ZMK: a folder with one .keymap file, or the file itself
keyloom --data-dir /tmp/keyloom-test import --board foostan/corne path/to/config
# QMK: a keymap folder, such as keyboards/crkbd/keymaps/default, or the keymap.json in one
keyloom --data-dir /tmp/keyloom-test import --board foostan/corne path/to/keymap-folder
```

A ZMK import without a `.conf` next to the `.keymap` prints "no .conf beside the .keymap; no settings imported". That is fine for a test layout.

The importer reads the `importers` you named. Use `qmk-keymap` for QMK and `zmk-keymap` for ZMK. Oryx exports (`oryx-source`) and Layout Editor exports (`zmk-layout-editor-keymap`) go through the same readers.

The import prints a report. Bindings it can't model are kept as they were written, under `native`. That is expected. A layer with the wrong number of keys is an error, and means `keyCount` or the import is wrong.

Look at it:

```sh
keyloom --data-dir /tmp/keyloom-test layout list
keyloom --data-dir /tmp/keyloom-test layout show <layout>
keyloom --data-dir /tmp/keyloom-test serve
```

Check that the drawn keyboard looks like yours and that each legend sits on the key the keymap file puts it on.

Build it. This needs Docker to be running:

```sh
keyloom --data-dir /tmp/keyloom-test build <layout>
```

It prints the build ID, the artifact's path and the log's path (as JSON when the output isn't a terminal, with `artifact_path` and `log_path`). A ZMK build makes a `.zip` that holds one UF2 per half. A QMK build makes a `.bin`, `.hex` or `.uf2`.

Flash it. This overwrites the firmware on your keyboard. Keep a copy of your current layout first.

```sh
keyloom --data-dir /tmp/keyloom-test flash --layout <layout>
```

keyloom tells you what to do for each half. For `uf2-drives`, double-tap reset when it asks. It waits for the boot drive, copies the file, and waits for the drive to go away. That is how it knows the write worked. Then check that the keyboard types what the layout says.

For `manual`, `flash` fails and prints the file's path. Flash it yourself.

## `board.json` field reference

Every field below is checked by the schema in `src/boards/schema.ts` and `src/boards/recipes.ts`. A test fails if this table and the schema disagree. A field that isn't in the table is rejected by `boards check`.

Paths ending in `[]` are lists. The "For" column says which recipe uses the field.

| Field | For | What it holds |
| --- | --- | --- |
| `schemaVersion` | all | Always `1`. |
| `id` | all | `<vendor>/<board>`. Must equal the folder path. |
| `name` | all | The board's name as people say it, such as `Corne`. |
| `vendor` | all | The maker as people know them, such as `foostan` or `Bastard Keyboards`. |
| `firmware` | all | `qmk` or `zmk`. It decides the importer, the generator and the validator rules. |
| `keyCount` | all | The number of keys. It must equal the number of keys in `geometry.json`. |
| `revisions` | all | A list of hardware revisions. One entry when there is only one. |
| `revisions[].id` | all | A short name, such as `default` or `rev1`. Unique in the board. |
| `revisions[].source` | all | The pinned firmware tree. |
| `revisions[].source.repo` | all | A `github.com` repo URL. |
| `revisions[].source.ref` | all | The tag or branch name. Informational. |
| `revisions[].source.sha` | all | The full 40-character commit. This is what is checked out. |
| `revisions[].qmkTarget` | QMK | The `make` target, such as `crkbd/rev1`. Required for QMK, not allowed for ZMK. |
| `revisions[].build` | all | The build recipe. |
| `revisions[].build.kind` | all | `qmk-docker`, `zmk-west-docker` or `zmk-moergo-template`. |
| `revisions[].build.image` | `qmk-docker`, `zmk-west-docker` | The Docker image, pinned by `@sha256:` digest. |
| `revisions[].build.layoutMacro` | `qmk-docker` | The `LAYOUT_*` macro the keymap uses. Geometry is read from the layout of the same name. |
| `revisions[].build.keymapsDir` | `qmk-docker` | Where keyloom writes the keymap, relative to the QMK tree. |
| `revisions[].build.submodules` | `qmk-docker` | Submodules the build needs. May be empty. |
| `revisions[].build.modules` | `qmk-docker` | QMK community modules to write into `keymap.json`. ZSA boards use it. Leave it out otherwise. |
| `revisions[].build.layoutFile` | `qmk-docker` | The JSON file with `layouts`, when it isn't `keyboards/<qmkTarget>/keyboard.json`. |
| `revisions[].build.artifact` | `qmk-docker` | `bin` (default), `hex` or `uf2`. |
| `revisions[].build.template` | `zmk-moergo-template` | MoErgo's config template. Only the Glove80 uses it. |
| `revisions[].build.template.repo` | `zmk-moergo-template` | The template's repo URL. |
| `revisions[].build.template.sha` | `zmk-moergo-template` | The template's pinned commit. |
| `revisions[].build.physicalLayout` | ZMK | The file in the ZMK tree with the `zmk,physical-layout`. Geometry is generated from it. |
| `revisions[].build.board` | `zmk-west-docker` | The `west build -b` board, such as `nice_nano_v2`. |
| `revisions[].build.keymapName` | `zmk-west-docker` | The base name of `config/<name>.keymap` and `.conf`. |
| `revisions[].build.targets` | `zmk-west-docker` | One west build per half, in the order built. |
| `revisions[].build.targets[].id` | `zmk-west-docker` | A short name, such as `left`. Names the half's UF2. |
| `revisions[].build.targets[].shield` | `zmk-west-docker`, optional | The `-DSHIELD` value, such as `corne_left`. |
| `revisions[].build.targets[].board` | `zmk-west-docker`, optional | Overrides the recipe's `board` for this half. |
| `revisions[].build.boardModule` | `zmk-west-docker`, optional | External hardware definitions. Also owns `physicalLayout`. |
| `revisions[].build.boardModule.repo` | `zmk-west-docker` | Hardware module repository URL. |
| `revisions[].build.boardModule.sha` | `zmk-west-docker` | Immutable hardware module commit SHA. |
| `revisions[].build.rgbMatrix` | `zmk-west-docker`, optional | Per-key RGB engine; requires an LED map and the keyloom module. |
| `revisions[].build.rgbMatrix.module` | `zmk-west-docker` | Pinned RGB module dependency. |
| `revisions[].build.rgbMatrix.module.repo` | `zmk-west-docker` | RGB module repository URL. |
| `revisions[].build.rgbMatrix.module.sha` | `zmk-west-docker` | Immutable RGB module commit SHA. |
| `revisions[].build.rgbMatrix.strip` | `zmk-west-docker` | Devicetree label of the LED strip. |
| `revisions[].build.rgbMatrix.physicalLayout` | `zmk-west-docker` | Devicetree label of the physical key layout. |
| `revisions[].build.rgbMatrix.leftLedCount` | `zmk-west-docker` | Number of entries at the start of the LED map belonging to the left half. |
| `revisions[].build.rgbMatrix.leftTarget` | `zmk-west-docker` | Target ID for the left half; the build supplies a per-half devicetree flag. |
| `revisions[].build.rgbMatrix.maxBrightness` | `zmk-west-docker` | Hardware brightness cap, 1–100 percent, scaled by the master control. |
| `revisions[].build.config` | `zmk-west-docker`, optional | `CONFIG_…=…` defaults, emitted before layout settings. |
| `revisions[].build.sensorBindings` | `zmk-west-docker`, optional | Devicetree sensor bindings in hardware order, emitted on every layer. |
| `revisions[].build.kanataVersion` | `kanata-config` | The kanata release the generated config targets, such as `1.12.0`. Software-remapper boards only; `source.ref` must be `v<version>`. |
| `revisions[].flash` | all | The flash recipe. |
| `revisions[].flash.kind` | all | `zapp`, `uf2-drives`, `dfu-tool`, `manual` or, for a software remapper, `kanata-reload`. |
| `revisions[].flash.bootloader` | `zapp`, `dfu-tool` | The bootloader's USB `VID:PID`, such as `0483:df11`. A `dfu-tool` with `tool: "avrdude"` has none: Caterina is found as a new serial port. |
| `revisions[].flash.tool` | `dfu-tool` | `dfu-programmer`, `dfu-util` or `avrdude`. |
| `revisions[].flash.mcu` | `dfu-tool` | The chip as the tool names it, such as `atmega32u4`. `dfu-util` takes none. |
| `revisions[].flash.enter` | `dfu-tool` | How to put the board into its bootloader. keyloom shows it while it waits. |
| `revisions[].flash.tcpPort` | `kanata-reload` | The loopback port the daemon starts kanata's TCP server on. |
| `revisions[].flash.driverVersions` | `kanata-reload` | The Karabiner VirtualHID driver versions this kanata release can use. |
| `revisions[].flash.steps` | `uf2-drives` | The boot drives to flash, in order. |
| `revisions[].flash.steps[].volume` | `uf2-drives` | The drive's volume label, such as `NICENANO`. |
| `revisions[].flash.steps[].label` | `uf2-drives` | What to call this part, such as `left half`. |
| `revisions[].flash.steps[].enter` | `uf2-drives` | How to put it into its bootloader. keyloom shows it while it waits. |
| `revisions[].flash.steps[].target` | `zmk-west-docker` | The build target whose UF2 this step writes. |
| `revisions[].flash.handsFree` | `uf2-drives`, optional | Present when the ZMK build carries keyloom's module, so a flash after the first needs no keypress (D-095). |
| `revisions[].flash.handsFree.trigger` | `handsFree` | `cdc-1200`: closing a half's USB serial port at 1200 baud restarts that half into its bootloader. |
| `revisions[].flash.handsFree.usbVendorId` | `handsFree`, optional | The board's USB vendor ID while it runs, such as `0x16c0`. |
| `revisions[].flash.handsFree.halves` | `handsFree` | One entry per half. Exactly one is the central. |
| `revisions[].flash.handsFree.halves[].role` | `handsFree` | `central` or `peripheral`. |
| `revisions[].flash.handsFree.halves[].step` | `handsFree` | The `label` of the flash step that writes this half. |
| `revisions[].flash.handsFree.halves[].marker` | `handsFree` | `L` or `R`: the letter after the build ID in the half's USB serial number. Unique per half. |
| `revisions[].flash.handsFree.halves[].usbProductId` | `handsFree`, optional | The half's USB product ID while it runs. Without it any port with this letter is taken to be the half. |
| `revisions[].flash.handsFree.halves[].relay` | `handsFree`, optional | A peripheral the central can restart over the split link when it has no serial port of its own. |
| `revisions[].flash.handsFree.serialMarker` | `handsFree` | `usb-sn-template` if the board already fills `CONFIG_USB_DEVICE_SN` with the chip ID (the Glove80), else `usb-sn-override`. |
| `revisions[].flash.handsFree.serialTail` | `handsFree` | What follows `keyloom/<12>-<L\|R>` in the serial template, starting with `:` and ending in the 16 characters the chip ID replaces. |
| `revisions[].flash.instructions` | `manual` | What to tell the person: which tool flashes the file, and how to enter the bootloader. |
| `revisions[].detect` | all | `null`, or an object that names the USB device. |
| `revisions[].detect.usbProductId` | all | The board's USB product ID, such as `0x1969`. keyloom uses it to tell hardware revisions apart. |
| `revisions[].detect.product` | optional | Exact USB product string required in addition to IDs; use it for hardware sharing ZMK's default USB IDs. |
| `revisions[].detect.usbVendorId` | optional | The vendor ID the running firmware reports, such as `0x4653`, when the board is not ZSA's. keyloom assumes ZSA's `0x3297` for a ZSA board without it. |
| `revisions[].device` | `kanata-config`, optional | How a software remapper finds the keyboard to take. A board with no USB IDs (a laptop's own) has `detect: null` and this. |
| `revisions[].device.kind` | `device` | `macos-product-name`. |
| `revisions[].device.name` | `device` | The exact product string `kanata --list` prints, such as `Apple Internal Keyboard / Trackpad`. |
| `hands` | all | Which positions are under each hand. |
| `hands.left` | all | The left hand's positions. |
| `hands.right` | all | The right hand's positions. |
| `fingers` | all | An object from every position number, as a string, to a finger name such as `left-index`. |
| `rows` | all | An object from a row name to its positions. Every position is in exactly one row. |
| `mirror` | all | An object from a left-hand position to the right-hand position it mirrors to, on the same row and under the same finger. Each target once. Keys with no opposite are left out. |
| `physicalKeys` | `kanata-config`, optional | The key each position is on the device, in binding order: KeyCode names, plus `FN` for the Apple fn/globe key. A software remapper grabs keys by name. |
| `holdKeyPreference` | optional | Positions where a layer or hold key lands first when the board it came from had more thumb keys, best first. |
| `holdKeyFallback` | optional | Positions a layer may be held from once the preferred ones are used, so no carried layer has no way in; less-used keys such as `;` and `'`. |
| `importers` | all | The readers keyloom can use to import a layout. `qmk-keymap` or `oryx-source` for QMK, `zmk-keymap` or `zmk-layout-editor-keymap` for ZMK. |
| `lighting` | qmk | Optional. Present on a board with per-key RGB that keyloom writes layer colours for. |
| `lighting.ledPositions` | qmk, zmk with RGB matrix | For each LED number, the key position it sits under. Read it from the firmware's `rgb_matrix.layout` and keyboard layout by matching matrix coordinates. |
| `lightingControls` | all | Optional. `true` when the firmware has lighting control keys (RGB underglow or the RGB matrix's controls) but no per-key LED table. Set it only with evidence from the firmware's own config, such as a `CONFIG_*RGB*=y` line in the board's defconfig, and say where in the commit. |
| `limits` | all | Optional. What the board can't do, in a sentence the agent and the validator can quote. |
| `limits.lighting` | all | Why the board can't show per-key colours, such as "its lights are underglow, which shows one effect across the whole strip". Set it on a board with no `lighting`. |
| `settingDefaults` | all | Optional. An object from a setting's name to the value this board has by default when that differs from the firmware's, such as `"MOUSEKEY_ENABLE": true`. |
| `display` | all | Optional. Changes how the board is drawn, never what positions mean. |
| `display.rotate` | all | Optional. A list of rotations to draw. |
| `display.rotate[].positions` | all | The keys to turn. |
| `display.rotate[].r` | all | The angle in degrees. |
| `display.rotate[].rx` | all | The x of the point to turn around, in key units. |
| `display.rotate[].ry` | all | The y of the point to turn around, in key units. |
| `display.shift` | all | Optional. A list of slides to draw, applied after rotation. |
| `display.shift[].positions` | all | The keys to slide. |
| `display.shift[].dx` | all | How far to slide them, in key units. Use it when a split board's halves are drawn too close for their tilted thumb clusters. |
| `display.shift[].dy` | all | Optional. How far to move them down, in key units; negative moves them up. Use it when a row above is drawn taller than the geometry has it, or to draw column stagger the geometry lacks: one entry per column, each with its own `dy`. |
| `display.keycaps` | all | Optional. An object from a position, as a string, to the physical keycap colour where it is not the board's usual one. Only `red` exists, for the Moonlander's two big thumb keys. |
| `display.surface` | all | Optional. How the editor draws the case under the keys: `wells` sinks each column into a sculpted well (the Glove80), `deck` draws a laptop's aluminium deck with the keys in a recess (the MacBook). Leave it out for a flat case. |
| `display.statusLeds` | all | Optional. The case's status LEDs (the Moonlander has three per half). The editor lights each one in the layer's colour. |
| `display.statusLeds[].x` | all | An LED's horizontal position, in key units after `rotate` and `shift`. |
| `display.statusLeds[].y` | all | The LED's vertical position, in the same units. |
| `display.caseHug` | all | Optional. Draws a case that hugs the keys, reaching this many key units past each one, instead of one outline around them all. Keys turned about the same point (a thumb fan) get a curved band. The Glove80 uses `0.3`. |
| `display.keyShapes` | all | Optional. Caps that aren't the geometry's rectangle, keyed by position as a string (the Moonlander's red thumb caps). Each may give `x`, `y`, `w` and `h` to replace the cap's box, in the geometry's unrotated key units, and an `outline` of `[x, y]` points in fractions of that box, such as `[[0, 0.38], [0.5, 0], [1, 0.38], [1, 1], [0, 1]]` for a house shape; corners are rounded for you. An optional `kind: "rotary-encoder"` draws a circular knurled control while retaining its editable press binding. Drawing only: binding order never changes. |
| `display.colourways` | all | Optional. The case and keycap colours the maker sells, so the drawn board can be pinned to the one on the desk in Settings (D-395, D-319). Leave it out and the board follows the theme. |
| `display.colourways.cases` | all | The case colours, at least two. |
| `display.colourways.cases[].id` | all | A short id, kept in the browser when it is pinned, such as `black`. |
| `display.colourways.cases[].name` | all | What the setting says: `Black`, `Grey`, `White`. |
| `display.colourways.cases[].maker` | all | Optional. The maker's own name where it differs, such as ZSA's `Dark Matter`. |
| `display.colourways.cases[].tone` | all | `dark`, `grey` or `light`. `grey` is a charcoal case lighter than black (MoErgo's grey Glove80). |
| `display.colourways.cases[].stockCaps` | all | The id of the caps this case is sold with, from `caps`. An older single colourway choice of this case is read as these caps. |
| `display.colourways.caps` | all | The keycap colours, at least two. Any case can be pinned with any caps. |
| `display.colourways.caps[].id` | all | A short id, such as `white`. |
| `display.colourways.caps[].name` | all | What the setting says: `Black`, `White`. |
| `display.colourways.caps[].maker` | all | Optional. The maker's own name, such as MoErgo's `Opaque Black`. |
| `display.colourways.caps[].tone` | all | `dark` or `light`. |
| `display.case` | all | Optional. The case drawn from photos of the real board instead of computed from the keys. Each part is an SVG path in key units after `rotate` and `shift`. Leave it out and the editor draws a case from the keys. |
| `display.case[].hand` | all | `left`, `right`, or `null` for a one-piece case. A split board's halves part for the key card by hand. |
| `display.case[].kind` | all | `body` for each piece of the case, including a thumb cluster printed or milled as part of it; `module` only for a physically separate plate, such as the Moonlander's hinged thumb block; `deck` and `recess` for a laptop's top case and keyboard well; `screen` for a display's dark cover; `grille` for a speaker grille; `sensor` for a fingerprint key; `leg` and `knob` for metal tenting parts; `knurl` for fine lines, such as a knob's knurling or a fingerprint key's ring; `hole` for a pinhole or a screw head; `ball` for a trackball, given as the ball's circle (the editor draws its socket ring and shading). |
| `display.case[].d` | all | The part's path, using absolute `M`, `L`, `Q`, `A` and `Z` commands. |

Use `display.rotate` only when the firmware's own geometry doesn't tilt keys that really tilt. The Moonlander's thumbs are the example.

## What `boards check` does

It runs on a board folder:

```sh
keyloom boards check boards/foostan/corne
```

It fails when:

- `board.json` or `geometry.json` is missing, or doesn't match the schema. A misspelled field is an error.
- The `id` differs from the folder path.
- `keyCount` differs from the number of keys in `geometry.json`.
- A position is missing from `hands`, `fingers` or `rows`, or appears twice.
- A `mirror` entry points the wrong way (its source must be a left key and its target a right key), uses a target that another entry already uses, or pairs keys on different rows or under different fingers.
- The recipes don't fit the firmware, or the flash steps and build targets don't line up.
- `geometry.json` differs from what the pinned firmware file generates. Run `keyloom boards geometry` again.

It warns when a left-hand key of a split board has no mirror entry, or when `SKILL.md` is past 400 lines. A one-piece board with an empty `mirror` gets no mirror warnings.

CI runs it on every board in `boards/`. It checks the format. It can't check that your board builds or flashes. You do that in step 6.

`--offline` skips the fetch and the geometry comparison. Use it only for a quick check of the fields.

## If something fails

- `skipping boards/...` when you start keyloom: that folder's `board.json` or `geometry.json` is unfinished or invalid. keyloom ignores it so other commands still run. `keyloom boards check` on the folder says what is wrong.
- `has no layout named ...`: `build.layoutMacro` or `build.layoutFile` is wrong. The message lists the layout names the file has.
- `Docker can't see ...`: Docker doesn't share the cache folder. Put `XDG_CACHE_HOME` under your home directory.
- A QMK build that ends with `was not produced`: set `build.artifact` to the file type your board builds.
- A QMK build that stops on a missing `lib/...` path: add that submodule to `build.submodules`.
- `... didn't appear within 120 s`: the boot drive's label differs from `volume`. Look at the drive's name while the board is in its bootloader, and use that.
- The build log is in the keyloom data directory under `logs/`. The path is printed when a build fails.

## Licence

keyloom is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). By opening a pull request you agree that your contribution is licensed under the same terms.
