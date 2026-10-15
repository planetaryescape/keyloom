# What keyloom can learn from nickcoutsos/keymap-editor

Repo https://github.com/nickcoutsos/keymap-editor, `main` at `e7946792cf674db20ab72ab67fea759fff4c3ccc` (last commit 2023-10-30), MIT, checked 2026-10-15.

## The public source is a 2023 snapshot, and the live app is closed

The author stopped publishing source. The wiki page "Source-Code-Updates" says he has "indefinitely paused publishing source updates" and keeps the repo "as a public archive of the last public code release" (wiki `8f51409e81ed83c263f537b857f1f28af2f0da52`, `Source-Code-Updates.md` L20-35). In September 2026 he confirmed "There won't be any source code updates" and pointed people to ZMK Studio (issue #375).

The two versions differ in kind, so this note keeps them apart:

- **`main` at `e7946792`** is the readable code. Every `path#Lx-Ly` below refers to it unless marked otherwise. It doesn't parse `.keymap` files at all (see the parsing section).
- **The deployed app** is the `pages` branch at `e954e104d5f2aeb7f2b6ef95cbb525ef5eb0c3cf` (2026-08-26). It's a minified webpack build, so claims about it name the bundle file and the string found there, not line ranges. The wiki and the author's issue comments describe it too.
- **Branch `devicetree-parser`** at `52f9f165b9678b2c8c06e0f467581b69a5002273` (2021-12-22) holds the first tree-sitter experiment.
- **`nickcoutsos/keymap-layout-tools`** at `16182b20803893736ce9c5b856b9762cbc016435` (MIT) is where the author moved the layout geometry code.

## Architecture: a React app, an Express server and a GitHub App. Builds are left to GitHub Actions

### Frontend

The frontend is React 18 on Create React App (`app/package.json#L5-L28`). State is plain `useState` in `App.js` (`app/src/App.js#L17-L24`), and keycodes and behaviours are shared through a context (`app/src/providers.js#L3-L10`). The deployed app has since moved to Redux. `main.ea06a4be987c56af35de.js` reads selectors such as `n.navigation.activeLayer`. It loads the editors as lazy tab chunks: `LayerEditorTab`, `ComboEditorTab`, `MacroEditorTab`, `BehaviorEditorTab`, `ConditionalLayerEditorTab` and `WarningsTab` (chunk map in `runtime.54dda229b2d74e590393.js`).

### Backend

The backend is Express (`api/index.js#L1-L27`). It serves the keycode and behaviour JSON and the local keymap (`api/routes/keyboards.js#L6-L28`). With `ENABLE_GITHUB` set, it also serves the GitHub routes (`api/index.js#L25`). In dev mode it spawns the CRA dev server as a child process (`api/routes/application.js#L10-L29`).

### Reaching the zmk-config

There are two routes at `e7946792`.

- **GitHub App.** OAuth signs the user in, and the server mints a JWT that holds the user's OAuth token (`api/services/github/auth.js#L42-L74`). Repo access uses installation tokens (`auth.js#L11-L22`). Saving builds a tree, a commit and a ref update through the Git Data API. That pushes straight onto the branch with the message "Updated keymap" (`api/services/github/files.js#L89-L140`). It only looks in `config/`, and it takes the first `*.keymap` it finds (`files.js#L62-L74`). The deployed app later added branch creation from a three-dot menu (issue #120, closed by the author).
- **Local.** The server reads `../zmk-config/config/info.json` and `keymap.json`, from a symlinked or cloned zmk-config next to the repo (`api/services/zmk/local-source.js#L6-L37`). The keyboard name `dactyl` is hard-coded on L7.

The deployed app adds Clipboard, File System and Demo sources (README L40-L44 and L66-L71; chunks `ClipboardPicker`, `FileSystemPicker`, `DemoPicker`, `LocalPicker`, `GithubPicker`). File System uses the browser File System Access API, so it is "only supported in Chromium-based browsers" (README L53). Firefox support is still an open request (#373).

### Builds

Builds are out of scope: "Actual firmware builds are outside of the scope of this project" (README L73-L75). The local "Save Local" path writes the files and then runs `git status`. A comment says a ZMK dev environment "proved to be more complex than I had patience for" (`local-source.js#L44-L58`). Builds happen when the user pushes and the zmk-config's GitHub Actions workflow runs. It has no flashing.

## Parsing and serialisation: the public code regenerates the whole file, and the live app edits a tree-sitter tree but rejects preprocessor macros

### At `e7946792`: a JSON sidecar and a template

The public code never reads `.keymap`. It reads `config/keymap.json`, a sidecar of binding strings, plus `config/info.json` (`files.js#L16-L41`). If `keymap.json` is missing, it starts from an empty keymap (`files.js#L29-L36`).

- **Binding parser.** It uses regexes. The behaviour is `^(&.+?)\b`. Params are split on spaces, and `X(Y)` nests recursively (`api/services/zmk/keymap.js#L52-L71`). `&lt 1 LC(A)` becomes `{value:'&lt', params:[{value:'1'},{value:'LC', params:[{value:'A'}]}]}`. Comma-separated nesting works, but nested parentheses with spaces don't.
- **Writer.** It renders a whole new `.keymap` from a fixed template (`api/services/zmk/defaults.js#L1-L25`). The template has `{{behaviour_includes}}` and `{{rendered_layers}}` slots (`keymap.js#L89-L112`). A repo can supply `config/*.keymap.template` to override it (`files.js#L76-L87`). Without one, every behaviour definition, combo, macro, comment and `#define` is lost. Layer 0 is always named `default_layer`. The others become `layer_<name>` with non-alphanumerics replaced (`keymap.js#L93-L101`).
- **Includes.** These come from a table. Each behaviour in `zmk-behaviors.json` lists the headers it needs, and the writer emits the ones used (`keymap.js#L114-L118`).
- **Formatting.** Bindings are laid out as a text table. Each key's `row`/`col` from `info.json` sets its place, and columns are padded to a common width (`api/services/zmk/layout.js#L11-L56`). Wrong `row`/`col` values shuffle the generated text (issue #93).
- **Validation.** It only checks that each binding starts with a known behaviour. "TODO: validate remaining bind parameters" (`keymap.js#L142-L178`, L169).

### On the `devicetree-parser` branch: tree-sitter, first draft

`test-tree-sitter.js#L89-L152` at `52f9f165` loads `tree-sitter-devicetree.wasm` with `web-tree-sitter`. It finds `/ > keymap`, takes each child node as a layer, and groups binding tokens by starting a new binding at each `&` token (L95-L109). It picks out `<dt-bindings/...>` includes as the managed set (L147-L150).

### In the deployed app: edit in place, reformat everything

`shared.a0e66b60205008f391d6.js` loads `tree-sitter-devicetree.wasm` and defines a `DevicetreeDocument` class. The grammar is the 34,669-byte `2f0cf3405ab1202f0045.wasm`, which exports `tree_sitter_devicetree`.

The wiki says changes are "applied directly to your existing keymap code". It also says the app does "a proper formatting pass over the entire document, not just the edited portions" (`Devicetree-Source-Formatting.md` L1-L3). A `// dt-formatter: key=value` modeline sets the indent, the multi-line cell indent, the comma style and a `style="table"` layout for combos (L10-L99).

### Unknown content survives, but not untouched

The author says the app "does its best to preserve any part of the keymap file it can't directly process. So `#define` lines should be left alone" (issue #302, 2025-05-03). It may resolve `&mo LAYER_FOO` to `1` in memory and keep the original text if the user doesn't touch that key (same comment). Two known failures:

- **Includes are managed.** The app adds and removes `dt-bindings` headers based on the behaviours in use. It deleted a user's `ext_power.h` include that the user's firmware needed (issue #245). It also reorders includes, which broke a local `#include` that had to come after another. The workaround is to move the include inside a root node (issue #205).
- **Formatting is global.** Any save reformats the whole file (wiki above).

### Preprocessor macros are refused by design

The wiki gives three reasons (`Preprocessor-Support.md` L49-L144):

- The grammar doesn't accept preprocessor statements at arbitrary places in the tree.
- Running a real preprocessor means fetching includes, and possibly a whole ZMK fork through `west.yml`.
- A `#define` is one-way, so the app can't write it back faithfully.

The author's position: "if you want to use this tool to edit keymaps then you don't need preprocessor macros. If you want to use preprocessor macros, then you don't need this tool" (L142-L144).

Issues confirm the effect:

- `&kp SCREENSHOT` from a `#define` fails (#162).
- `AS(Q)` bindings give "Could not parse keymap" (#103).
- urob's zmk-helpers fail with "Missing devicetree root node" (#238).
- `#ifdef` layout variants show up as duplicate layers (#147).
- Layer-number `#define`s remain an open request (#302).
- Locale headers from `zmk-locale-generator` are the one exception. The app recognises them by name and adds their keycodes to the picker without parsing the header (#222). The deployed `runtime.54dda229b2d74e590393.js` lists about 200 `locales/keys_*-keycodes` chunks.

### Other limits from the wiki and issues

- It can't edit keymaps inside a ZMK fork. It expects the user-config repo layout (`Limitations-of-the-Keymap-Editor.md` L45-L49).
- Behaviours from unmerged ZMK branches can be referenced but not edited (L33-L39; `Features.md` L69-L77).
- Encoders are found only in the expected board files, and the app ignores `status = "disabled"` (L27-L31).
- Hosting has failed users before: `PayloadTooLargeError` on large keymaps (#140), and a GitHub integration outage (#191).

## Physical layout: geometry comes from a QMK-style info.json, not ZMK physical layouts, and the rendering is about 70 lines

### Where geometry comes from

Geometry comes from `info.json` in QMK's key-dictionary format: `x`, `y`, `w`/`u`, `h`, `r`, `rx` and `ry`. `row`/`col` are added for text formatting (`Defining-keyboard-layouts.md` L11-L21). The validator checks those fields (`layout.js#L58-L117`). The app picks `layouts.default`, or else the first layout (`app/src/Pickers/Github/api.js#L107`).

There are three ways to get one:

- **The repo's own file.** `config/info.json` or `config/<keyboard>.json` (`Limitations-of-the-Keymap-Editor.md` L51-L53).
- **Community metadata.** `nickcoutsos/keymap-editor-contrib` has `glove80.json` and `ergodox.json`. That repo has no licence (`gh repo view`, checked 2026-10-15). The deployed app bundles this metadata as `keyboard-data/*-json-metadata` chunks.
- **Auto-generation from the matrix transform's `RC(r,c)` grid.** It gives a rough grid with no thumb sweep (`Defining-keyboard-layouts.md` L28-L58).

ZMK's `zmk,physical-layout` isn't supported. The author: "ZMK Studio uses a different property (`zmk,physical-layout` I think) which Keymap Editor doesn't support" (issue #312). He also said he "stopped due to the depth of physical layouts" (issue #201). No `physical-layout` string appears in the deployed bundle outside HID usage names. Picking a layout by `zmk,matrix-transform` works, but a mismatch shifts every key by one position (issue #372).

### Glove80 in the deployed metadata

`keyboard-data/glove80-json-metadata.6c8cfcdc73375e9ab85d.js` has one layout, `default_transform`, with 80 keys. Thumb keys share a rotation origin and fan out by angle: `{"x":4,"y":4.6,"rx":4.5,"ry":9.35,"r":30}`, then `r:45` and `r:60`. The right hand mirrors this with negative angles.

### How it renders

The rendering is small and easy to port.

- **Placement.** `app/src/key-units.js#L6-L29` turns each key into an absolutely positioned `div`. It uses `top`/`left` and `width`/`height` in pixels at 65 px per unit with 5 px padding. Rotation is `transform: rotate(a deg)`, with `transform-origin` set to the rotation origin relative to the key (`rx - x`, `ry - y`, scaled).
- **Bounding box.** `getKeyBoundingBox` rotates the four corners and takes min/max (`key-units.js#L31-L72`). `Keyboard.js#L71-L90` sizes the wrapper from it.
- **Prop extraction.** `KeyboardLayout.js#L7-L15` reads `{x,y}`, `{rx,ry,r}` and `{w|u,h}` from each key.

Thumb clusters need no special case. They are just keys with `r`, `rx` and `ry`.

The cleaned-up version is `keymap-layout-tools/lib/geometry.js#L1-L136` at `16182b20` (MIT). It adds configurable key size and padding, `transformKeyPolygon`, `getLayoutKeyPolygons` and a bounding-box union. The author left a note in it: "I hate this so much, I need to update function signatures to just take the `keyLayout` type" (L19-L20).

The math matches ZMK's `&key_physical_attrs w h x y r rx ry`, where `rx`/`ry` are absolute and the units are centi-keys and centi-degrees (`zmk-and-glove80.md`). It also matches QMK `info.json`. The same 40 lines would serve both after dividing ZMK values by 100.

## Behaviours and keycodes: bindings are trees driven by JSON metadata, and the keycode file is reusable ZMK data under MIT

### Behaviour metadata

At `e7946792`, `api/services/zmk/data/zmk-behaviors.json` (202 lines) lists 18 behaviours. Each has:

- `code` (`&kp`)
- `name`
- `params`, a list of param kinds from `code`, `layer`, `mod` and `command` (`app/src/Keyboard/Keys/keyPropTypes.js#L3-L12`)
- `includes`, the headers to emit

Some examples:

- `&kp` has `params: ["code"]` and `keys.h` (L64-L69).
- `&mt` has `["mod","code"]` (L85-L89). `&lt` has `["layer","code"]` (L75-L79).
- Command behaviours list `commands`, and a command can add params. `BT_SEL` adds `{name:"index", type:"integer", enum:[0..4]}` (L50-L57).

There's a data bug: the descriptions of `OUT_BLE` and `OUT_USB` are swapped (L95-L101).

### How bindings are modelled

A binding is a tree, `{value, params:[{value, params}]}` (`keymap.js#L52-L71`). `hydrateTree` attaches the metadata for each node by its param kind (`app/src/Keyboard/Keys/util.js#L54-L88`). For `command` behaviours, `getBehaviourParams` appends the chosen command's `additionalParams` (`app/src/keymap.js#L5-L14`). Each param kind maps to a choice list for the picker (`app/src/Keyboard/Keyboard.js#L43-L69`). Modifier functions like `LS(code)` are keycodes that take a `code` param. `normalizeZmkKeycodes` splits them into a plain alias entry with `isModifier` and a function entry with `params: ['code']` (`app/src/keycodes.js#L17-L41`).

The deployed app replaced the hand-written list with schemas extracted from ZMK's devicetree binding YAML. The Changelog entry for 2023-01-30 says: "I've created scripts to extract schema information about every behavior in ZMK's repository, and overlay metadata files" (`Changelog.md` L41-L61). The same entry describes an `integer-union` type that shows bitmask `mods` as a set of modifiers. `shared.a0e66b60205008f391d6.js` contains these schemas. `"zmk,behavior-hold-tap"` lists `tapping-term-ms`, `quick-tap-ms` (default -1), `require-prior-idle-ms`, `flavor` (enum of four, default `hold-preferred`), and deprecated snake_case aliases.

For custom behaviours, the deployed app infers param kinds from the behaviour's `bindings`. A hold-tap over `<&mo>, <&sl>` gets layer params (`Changelog.md` L75-L94).

### Keycode data

`api/services/zmk/data/zmk-keycodes.json` (5,550 lines) has 366 entries. Each one has these fields:

- `names`: the alias list, such as `["LEFT_SHIFT","LSHIFT","LSHFT","LS(code)"]`. 163 entries have more than one name.
- `description`
- `context`, the category. The counts are Keyboard 192, Consumer 41, Consumer AL 37, Consumer AC 35, Keypad 24, Consumer Media 18, Consumer Menu 13 and Consumer KBIA 6.
- `clarify`
- `documentation`, a HID spec page link
- `os`, a support matrix for Windows, Linux, Android, macOS and iOS
- `footnotes`
- `symbol`, a display glyph, on 28 entries (`(`, `⮐`, `␣`, `⇧`)
- `faIcon`, on 3 entries

Examples are entry `A` at L2-L16 and `LEFT_SHIFT` at L2865-L2879.

The data comes from ZMK's documentation and is MIT, "Copyright (c) 2020 The ZMK Contributors" (`api/services/zmk/data/LICENSE`; README L88-L89). The upstream source is still `docs/src/data/hid.js` in `zmkfirmware/zmk` at `4dd95d7840eb3d5a3f59bb29fbf1ab054715ef85` (`gh api`, checked 2026-10-15). The deployed copy has a newer shape, with `usages` (HID application and item IDs) in `shared.a0e66b60205008f391d6.js`.

The deployed app also layers platform glyph sets: basic, Unicode, and per-OS ones such as `⌥` and `⌘` on macOS (`Changelog.md` L139-L158).

### Licence

The code is MIT, "Copyright (c) 2021 Nick Coutsos" (`LICENSE`). The keycode data is MIT under the ZMK Contributors. `keymap-layout-tools` is MIT. `keymap-editor-contrib` has no licence, so its layout files can't be reused as they are.

## UX worth copying: one click edits one parameter, the picker is keyboard-first, and quick-assign handles bulk work

### At `e7946792`

- **Clicks map to parts of the binding.** The small top-left label is the behaviour (`app/src/Keyboard/Keys/Key.js#L92-L99`). Each parameter in the middle is its own click target, nested ones too (`Keys/KeyParamlist.js#L8-L37`). `running-locally.md` L27-L28 describes it as "Click on the top-left corner of a key to change its bind behaviour, or in the middle to change the bind parameter."
- **Nested params read like the source.** CSS adds `(`, `)` and `,` around nested params (`Keys/styles.module.css#L27-L29`). `&mt LSHIFT LC(A)` reads as `⇧ LC(A)`.
- **Font size follows label length.** One-character labels grow, and long or multi-param ones shrink (`Keys/util.js#L17-L33`, `styles.module.css#L24-L25`). The hover title shows `(CODE) description` (`Keys/KeyValue.js#L14`).
- **The value picker is keyboard-first.** It's a fuzzy search (`fuzzysort`) with matches highlighted. It autofocuses and selects the input, handles ArrowUp/ArrowDown/Enter/Escape, and cancels on outside click. Results are capped at 30, and search only appears above 10 choices (`app/src/ValuePicker/index.js#L23-L184`). The "Show all" button has a bug: `onClick={setShowAll(true)}` calls the setter during render (L178).
- **Layers.** Clicking the active layer renames it inline, with Enter to save and Escape to cancel. Delete asks for confirmation. New layers fill with `&trans` (`Keyboard/LayerSelector.js#L29-L57`, `Keyboard.js#L92-L102`).

### In the deployed app

Bundle evidence, wiki and issues:

- **Quick assign.** It sets `&kp` bindings key by key by typing ("Rapidly set keycode bindings by typing or clicking", `LayerEditorTab.ca311b49b1c69f94d7fa.js`). It's in the layer's three-dot menu next to "Duplicate layer" and "Change Configuration". The author points to it for bulk edits and quick swaps (#221, #328).
- **Drag to reorder layers.** List items are `draggable` with drop targets (`LayerEditorTab`).
- **Modifier picker.** The keycode picker has modifier toggles, so users stop writing macros for Shift+key (`Changelog.md` L98-L126).
- **Parameters are kept when the behaviour changes.** When param kinds line up, they survive the switch (`&hm` to `&mt` keeps both). This was restored after a rewrite (#225).
- **Key-position selector.** It has drag-select across a region. It's used for combos and for `hold-trigger-key-positions` (`Changelog.md` L3-L12).
- **Combo editor.** It shows a scaled-down keymap for choosing positions, with `timeout`, `slow-release` and `layers` (`Features.md` L10-L17).
- **Macro editor.** It supports parameterized macros. It manages `compatible` and `#binding-cells` automatically and warns about misuse. Hovering a warning highlights the binding (`Features.md` L20-L59). Macro bindings can be dragged by row or column (`MacroEditorTab`).
- **Behaviour editor.** It creates and overrides behaviours from schemas (`Features.md` L62-L77). Conditional layers have their own tab.
- **Warnings tab.** It flags duplicate node names, duplicate labels, node names that redefine ZMK identifiers, and macros whose names suggest passwords (`WarningsTab.b219616848293106abf3.js`).
- **Unsaved-change guard.** A `beforeunload` listener warns when the active keymap differs from the original (`main.ea06a4be987c56af35de.js`, pages commit "Catch beforeunload event to avoid losing unsaved progress").
- **Nudges toward shortcuts.** A component counts repeated interactions and then suggests the faster way (#90).
- **Incomplete bindings get a visual cue.** Added in the 2022-07-05 Changelog entry (L171).

## What it doesn't do, or does badly

- **It has no undo or redo.** The deployed `main`, `shared` and six tab chunks contain "undo" only as HID keycode names (`K_UNDO`, `C_AC_UNDO`). The safety net is "don't commit yet" plus the `beforeunload` guard.
- **It doesn't build or flash.** That's left to the user's GitHub Actions and manual flashing (README L73-L75). A WebUSB and artifacts request is still open (#236).
- **It depends on GitHub and a hosted backend.** The convenient route is a third-party GitHub App with write access, pushing commits straight to a branch (`files.js#L89-L140`). The server holds a JWT that embeds the user's OAuth token (`auth.js#L61-L68`). Local editing means pasting from the clipboard or using a Chromium-only file API.
- **Preprocessor keymaps don't load.** Layer `#define`s, `ZMK_MACRO`-style helpers, urob's helpers and `#ifdef` are rejected or confused (see the parsing section). Many advanced Glove80 and Corne configs use them.
- **Saves touch lines the user didn't edit.** The whole file is reformatted, and includes are added, removed and reordered (#205, #245).
- **Layers are referenced by index.** At `e7946792`, deleting a layer splices the array and leaves every `&mo N` pointing at the wrong layer (`Keyboard.js#L125-L137`).
- **It only validates syntax.** The public code checks only that the behaviour name is known (`keymap.js#L142-L178`). The deployed Warnings tab is structural. It doesn't say whether a function is still reachable.
- **It doesn't support ZMK physical layouts.** Layouts come from a parallel JSON format that can drift from the firmware (#312, #372).
- **It's ZMK-only.** There's no QMK, and a request for non-ZMK devices is open (#262).
- **Accessibility is weak.** Keys are `span`s (#332), and contrast and font size limit use (#235).
- **The source is frozen.** Nothing can be patched upstream. Ideas transfer, code beyond 2023 doesn't.

## What keyloom should adopt, adapt or skip

| Idea | Where in keymap-editor | Verdict | Why |
|---|---|---|---|
| Rotated-rectangle key geometry (`x y w h r rx ry`, origin-relative `transform-origin`, polygon bounding box) | `app/src/key-units.js#L6-L72`; `keymap-layout-tools/lib/geometry.js#L1-L136` at `16182b20` | Adopt | About 40 lines of math, MIT, and the same model as ZMK `key_physical_attrs` and QMK `info.json`. Thumb clusters need no special case. Rewrite it in TypeScript as one function that takes one key type |
| Geometry source: QMK-style `info.json` plus community metadata | wiki `Defining-keyboard-layouts.md` L11-L58; `keymap-editor-contrib` | Skip | keyloom's board definition should come from ZMK `zmk,physical-layout` and QMK `info.json` directly. The contrib repo has no licence, and a parallel format drifts (#372) |
| ZMK keycode table with aliases, categories, descriptions, OS support and glyphs | `api/services/zmk/data/zmk-keycodes.json`; upstream `zmk` `docs/src/data/hid.js` at `4dd95d78` | Adapt | **Correction (2026-10-15): upstream `hid.js` is `CC-BY-NC-SA-4.0`, not MIT** (header at `zmk@4dd95d7`). keyloom generates its ZMK column from the MIT firmware header `app/include/dt-bindings/zmk/keys.h` instead. QMK names come from QMK's own files |
| Behaviour metadata with typed params (`code`, `layer`, `mod`, `command` + `additionalParams`) | `api/services/zmk/data/zmk-behaviors.json`; `app/src/keymap.js#L5-L14` | Adapt | It's a good shape for picking `native` binding params. Extract it from ZMK's binding YAML as the deployed app does (`Changelog.md` L41-L61), and fix the swapped `OUT_*` descriptions |
| Binding as a value/params tree with modifier functions as nested params | `api/services/zmk/keymap.js#L52-L71`; `app/src/Keyboard/Keys/util.js#L54-L88` | Skip | keyloom's IR already models `key` + `mods` and typed `holdTap`/`layer` (02). The regex parser breaks on spaced nesting. Use tree-sitter tokens |
| Tree-sitter devicetree parsing through `web-tree-sitter` | `devicetree-parser` branch `test-tree-sitter.js#L89-L152`; deployed `shared.a0e66b60205008f391d6.js` | Adopt | It confirms 06's choice. Group binding cells by `&` the same way, after keyloom's preprocessor step |
| Refuse preprocessor macros | wiki `Preprocessor-Support.md` L49-L144 | Skip | keyloom preprocesses against the pinned include tree (06), and the generator owns the output. Its one-way-`#define` objection doesn't apply when keyloom writes fresh files |
| Edit the user's file in place and reformat it whole | wiki `Devicetree-Source-Formatting.md` L1-L99; issues #205, #245 | Skip | keyloom generates deterministic output from the IR and keeps unknown blocks as `Passthrough`. Never drop an include it didn't add |
| Text-table layout of bindings by physical row/column | `api/services/zmk/layout.js#L11-L56` | Adapt | Generated `.keymap` and the agent's `get_layout` grid (03) should both read like the keyboard. Take row/column from board geometry, not hand-set `row`/`col` |
| Click the behaviour label vs click each parameter | `Key.js#L92-L106`; `KeyParamlist.js#L8-L37` | Adapt | Direct, and it shows the structure. In keyloom, click selects a key for chat context (D-012), so open editing from a separate action or a double-click |
| Keyboard-first fuzzy picker | `app/src/ValuePicker/index.js#L23-L184` | Adopt | Fuzzy search, highlight, arrow keys, Enter and Escape, autofocus. Search aliases and descriptions too, and use a real `<button>`/listbox for accessibility |
| Modifier toggles inside the keycode picker | `Changelog.md` L98-L126 | Adopt | Maps straight onto `{ code, mods }`, and stops users writing macros for Shift+key |
| Keep parameters when switching behaviour if kinds match | issue #225 | Adopt | Cheap, and it matters when trying hold-tap profiles. In keyloom, that's changing `profileId` while keeping `tap` and `hold` |
| Quick assign by typing | `LayerEditorTab.ca311b49b1c69f94d7fa.js`; issues #221, #328 | Adopt | The fastest way to fill a layer. Each keystroke becomes a `setBinding` op in one change set, so it undoes as one |
| Drag-select key positions | `Changelog.md` L3-L12 | Adopt | Serves combos, `hold-trigger-key-positions` and multi-key chat selection |
| Duplicate layer, drag-reorder layers | `LayerEditorTab` | Adopt | Safe in keyloom because layers are referenced by `id`, and indices are assigned at generation (02). keymap-editor's index splice shows the bug to avoid (`Keyboard.js#L125-L137`) |
| Warnings tab (duplicate names, ZMK identifier clashes, password macros) | `WarningsTab.b219616848293106abf3.js` | Adapt | Add these as validator rules (07). The password-macro warning costs little and protects users |
| `beforeunload` guard on unsaved edits | `main.ea06a4be987c56af35de.js` | Skip | Every keyloom edit is a saved revision in SQLite, so there's nothing to lose on close |
| Shortcut nudges after repeated actions | issue #90 | Skip | Not for v1. Revisit once the core editing flows exist |
| GitHub App committing to the user's branch | `api/services/github/files.js#L89-L140`; `auth.js#L42-L74` | Skip | keyloom is local-first with a local Docker build (D-028, D-036). A hosted backend holding OAuth tokens is the trust cost keyloom avoids |
| Clipboard and Chromium file pickers for local files | README L66-L71 | Skip | A bun server reads and writes the filesystem directly. Import is `keyloom import <file>` |
| Builds left to the user | README L73-L75; `local-source.js#L52-L57` | Skip | Build and flash are core to keyloom (06) |
| No undo | deployed bundle search | Skip | keyloom has append-only revisions and undo as a new revision (D-015) |
