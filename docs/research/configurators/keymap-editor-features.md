# keymap-editor feature inventory

Reviewed on 2026-10-15 at nickcoutsos/keymap-editor@e7946792cf674db20ab72ab67fea759fff4c3ccc

Default branch `main`, last commit 2023-10-30, MIT. Wiki checked at `keymap-editor.wiki@8f51409e81ed83c263f537b857f1f28af2f0da52`. The live app was driven with agent-browser on 2026-10-15 (Demo Keyboard source, nothing saved, no GitHub sign-in). This file extends `docs/research/keymap-editor.md` and does not repeat its parsing, licence and layout-geometry analysis.

## The repo shows about a third of what the live app does

The public source is a 2023 snapshot with one view: layers and keys. It has no combos, macros, behaviour editor, conditional layers, encoders, settings, dark mode or Apply/Cancel dialog. `grep -ri "sensor\|encoder"` over `api/` and `app/src/` returns nothing. Those features exist only in the deployed minified app, so each row below carries one of three evidence tags:

- `src` means read at the pinned SHA, with line ranges.
- `live` means observed on https://nickcoutsos.github.io/keymap-editor/ on 2026-10-15. Screenshots are in `docs/research/configurators/keymap-editor/` (03 to 07). Two earlier captures (welcome, layer 0) were saved outside the worktree and are not included.
- `wiki` means stated by the author in the wiki or README at the SHAs above. These are not re-verified against code.

## Feature table

| Area | Feature | How it works (UI steps) | Source |
|---|---|---|---|
| Sources | Choose a keymap source | The welcome screen shows four cards: Demo Keyboard, GitHub, Clipboard, File System. A `Source` dropdown stays at the top-left afterwards. The last choice is remembered in `localStorage`. In the public source only Local and GitHub exist, and the dropdown is hidden if only one is enabled. | live; src `app/src/Pickers/KeyboardPicker.js#L11-L22`, `#L55-L66` |
| Sources | Clipboard and File System | Clipboard: paste the `.keymap` text. File System: pick files through the browser File System Access API, Chromium only. Not re-driven live. | wiki; README L40-L53 |
| Sources | Local dev source | The Express server reads `../zmk-config/config/info.json` and `keymap.json`. "Save Local" POSTs the keymap to `/keymap`, and the server writes files and runs `git status`. Keyboard name `dactyl` is hard-coded. | src `app/src/App.js#L26-L34`, `#L95-L99`; `api/services/zmk/local-source.js#L6-L7`, `#L44-L58` |
| GitHub | Sign in | Click `Login with GitHub`. This redirects to GitHub OAuth, and the server returns a JWT in `?token=`, which the page moves to `localStorage.auth_token`. A 401 anywhere restarts login. | src `app/src/Pickers/Github/Picker.js#L14-L23`, `#L119-L123`; `api.js#L41-L72`; `api/routes/github.js#L22-L37` |
| GitHub | Install the GitHub App | If signed in but no installation or repos exist, a second button `Add Repository` goes to `github.com/apps/<app>/installations/new`. The user grants repo access there. | src `Picker.js#L25-L34`, `#L177-L178`; `api.js#L74-L84` |
| GitHub | Pick repository and branch | Two dropdowns. The repo defaults to the last used one, else the first. The branch defaults to the only branch, else the last used, else the repo default. Selecting a branch loads it at once. A sync icon reloads. | src `Picker.js#L99-L117`, `#L142-L171`, `#L190-L242`; `storage.js#L1-L26` |
| GitHub | Load rule | The server reads `config/info.json` and `config/keymap.json` through the Contents API on the chosen branch. `keymap.json` is a sidecar of binding strings, not the `.keymap`. The app uses `layouts.default` or the first layout. | src `api/routes/github.js#L97-L128`; `app/src/Pickers/Github/api.js#L96-L120` |
| GitHub | Commit | Click `Commit Changes` (enabled only after an edit). The server builds one tree with the regenerated `.keymap` plus `config/keymap.json`, creates a commit "Updated keymap" and moves the branch ref. The first `*.keymap` in `config/` is overwritten. A `config/*.keymap.template` overrides the output skeleton. | src `app/src/App.js#L36-L54`, `#L100-L109`; `api/services/github/files.js#L62-L140` |
| GitHub | Branch creation, build, firmware download | Branch creation exists in the live app (three-dot menu). The app never triggers Actions, never lists runs and never downloads firmware. The user leaves for GitHub to flash. | wiki/issues via earlier review; README L73-L75 |
| Layers | Switch | Click a layer pill in the left rail. Pills show the index, and the name expands on hover. | src `Keyboard/LayerSelector.js#L96-L131`; `styles.module.css#L50-L55` |
| Layers | Add | Click `Add Layer`. A layer named `Layer #N`, filled with `&trans` for every key, is appended. | src `Keyboard/Keyboard.js#L92-L102`; `LayerSelector.js#L132-L135` |
| Layers | Rename | Click the already-active pill. An inline input appears with its text selected. Enter saves, Escape or an outside click cancels. | src `LayerSelector.js#L29-L38`, `#L49-L80`, `#L105-L119` |
| Layers | Delete | Click the `x` icon on a pill, then OK in a `window.confirm`. Layers are index-based, so `&mo N` references elsewhere are not updated. | src `LayerSelector.js#L44-L47`, `#L123-L127`; `Keyboard.js#L125-L137` |
| Layers | Reorder | Drag a layer in the Layers tab list. Not in the public source. | wiki via earlier review |
| Layers | Layer menu | The Layers tab has a menu button with `Change Configuration`, `Duplicate layer`, `Quick &kp Assignment`, and bulk converts: `&trans` to `&kp`, `&trans` to `&none`, `&none` to `&kp`, `&none` to `&trans`, `&kp ⦸` to `&trans`, `&kp ⦸` to `&none`. | live |
| Layers | Conditional layers | A `conditional layers` tab lists conditions (demo: `tri_layer` activates `3both` when `1raise` and `2lower` are held), with an `Any layer` filter and `Add conditional layer`. | live; README L33 |
| Key editing | Layout rendering | Keys are absolutely positioned `div`s at 65 px per unit with 5 px padding. Rotation uses CSS `rotate` with a per-key `transform-origin`. | src `app/src/key-units.js#L3-L29`; `KeyboardLayout.js#L7-L15` |
| Key editing | Reading a key | The small top-left label is the behaviour. The centre shows each parameter as its own target, with nested ones in `(` `)` and `,`. Font shrinks for long or multi-param bindings. Hover shows `(CODE) description`. Unset params show `⦸`. | src `Keys/Key.js#L92-L106`; `KeyParamlist.js#L8-L37`; `KeyValue.js#L12-L36`; `styles.module.css#L24-L29`; `Keys/util.js#L17-L33` |
| Key editing | Edit flow, public source | Click the top-left label to change behaviour, or click one parameter. A small popup picker opens on the click point. Picking a value closes it and applies at once, with no Apply step. Changing behaviour resets all params to empty. | src `Key.js#L49-L78`; `ValuePicker/index.js#L23-L184` |
| Key editing | Edit flow, live app | Click anywhere on a key. A centred dialog shows a mini keymap with the key highlighted, an arrow, a preview key, a `Behavior` row and a `Parameters` list. Click the behaviour or a parameter to open a side list. `Apply` is disabled until every param is set. `Cancel` discards. When the behaviour changes, compatible params are kept (`&kp TAB` to `&mt` kept `TAB` as the hold value). | live; screenshot 03 |
| Key editing | Behaviour list | A searchable list of every ZMK behaviour, then custom behaviours (`Custom behavior: homewrow_mods_left`), then custom macros (`Custom macro "KEY_PRESS_WITH_LEFT_SHIFT_MODIFIER"`). | live |
| Key editing | Value picker | Fuzzy search with `fuzzysort`, highlighted matches, up/down/Enter/Escape, outside click cancels. Search shows only above 10 choices. Capped at 30 results. The `Show all` button is broken: `onClick={setShowAll(true)}` calls the setter during render. | src `ValuePicker/index.js#L33-L55`, `#L102-L124`, `#L144-L151`, `#L178` |
| Key editing | Keycode picker, live app | For a `Key Code` param the side panel has a `Modifiers` section with eight checkboxes (LSHFT, LALT, LCTRL, LGUI, RSHFT, RALT, RCTRL, RGUI), then `Available Keycodes` with a search box. Ticking a modifier wraps the current code (`TAB` became `LC(TAB)`, shown as `Left Control + Tab`). | live; screenshot 04 |
| Key editing | Nested params | `&kp LC(A)` is a tree. Modifier functions (`LC`, `LS`) are keycode entries with a `(code)` param. In the public source the `mod` source is the set of modifier aliases. | src `app/src/keycodes.js#L17-L41`; `Keyboard.js#L26-L32`; `Keys/util.js#L54-L88` |
| Key editing | Quick `&kp` assignment | In the Layers tab menu. The wiki says it sets bindings key by key by typing. Not driven live. | live (menu item present); behaviour from earlier review |
| Behaviours | Built-in coverage, public source | 18 behaviours in `zmk-behaviors.json`: `&bl &bt &caps_word &kp &key_repeat &lt &mo &mt &out &sk &sl &to &tog &reset &bootloader &rgb_ug &ext_power &trans &none`. Param kinds are only `code`, `layer`, `mod`, `command`. `&bt BT_SEL` adds an integer enum 0 to 4. No `&mmv`, `&mkp`, `&msc`, `&td`, `&mm`, `&sr` or `&macro_*`. | src `api/services/zmk/data/zmk-behaviors.json`; `app/src/keymap.js#L5-L14`; `Keyboard.js#L52-L69` |
| Behaviours | Built-in coverage, live app | The `Add new behavior` type list has 13 ZMK types (below). Built-in picker also shows Mod Morph, Two axis input, Mod or Tap, mouse behaviours. | live; screenshot 07 |
| Behaviours | Create a custom behaviour | `behaviors` tab, `Add New Behavior`, open the type dropdown, choose a type (13: caps word, hold-tap, key repeat, key toggle, mod morph, two-axis input, mouse key press, sensor rotate, sensor rotate with params, soft-off, sticky key, tap dance, toggle layer), `Create`. An edit dialog follows with Node and Label (both `Automatic`) and a `Configuration` table of properties. `*` marks required ones. | live; screenshot 07 |
| Behaviours | Hold-tap properties | The hold-tap form has `bindings*` (`hold:` and `tap:` slots, each a binding), `tapping-term-ms*`, `quick-tap-ms`, `require-prior-idle-ms`, `flavor` (hold-preferred, balanced, tap-preferred, tap-unless-interrupted), `hold-while-undecided`, `hold-while-undecided-linger`, `retro-tap`, `hold-trigger-key-positions`, `hold-trigger-on-release`. | live |
| Behaviours | Reconfigure a built-in | `Add Behavior Reconfiguration` in the same tab overrides properties of a predefined behaviour (demo: `&sk` sticky-key). | live; wiki Features L62-L67 |
| Behaviours | Listing | The `behaviors` tab shows `Behavior`, `Compatible`, `Uses` and `Actions` columns. The demo lists `&as_ht`, `&hml`, `&hmr` (hold-taps with 2, 4, 4 uses) and `&volknob`, `&rgbknob` (sensor-rotate). | live |
| Behaviours | Param type inference | For a custom hold-tap with `bindings = <&mo>, <&sl>`, the editor matches those to known behaviours and shows layer pickers. | wiki Changelog L75-L94 |
| Behaviours | Experimental ZMK features | The Settings dialog toggles `Send String Behavior`. The wiki lists mouse emulation and send-string for unmerged ZMK branches. | live; wiki `Experimental-ZMK-Features.md` |
| Combos | List | `combos` tab. Each card has a name with a pencil, the bound key preview, a scaled mini-keyboard with the member keys in green, and wrench (properties), copy (duplicate) and trash (delete) icons. | live; screenshot 05 |
| Combos | Create | `Add New Combo` opens a dialog with `Name` (required), a `&none` binding tile, a mini-keyboard and a hint `Click on a key to add it to the combo`. Click mini-keyboard keys to add positions. Click the `&none` tile to open the binding editor. `Create` finishes. | live; screenshot 06 |
| Combos | Properties | The wrench sets `timeout`, `slow-release` and `layers`. | wiki Features L10-L17 |
| Macros | Editor | `macros` tab shows each macro as a vertical list of bindings with `Add Control Binding`, `Add Key Binding`, `Add String Sequence`. Control bindings are `&macro_press`, `&macro_tap`, `&macro_release`, `&macro_pause_for_release`, `&macro_param_1to1`, `&macro_param_2to2`. Drag reorders rows. | live; wiki `Using-Parameterized-Macros-in-Keymap-Editor.md` |
| Macros | Parameterised macros | A `&macro_paramXtoY` control binding injects a `??` placeholder into the next binding. The editor keeps `compatible` and `#binding-cells` in step and warns about misuse. Hover on a warning highlights the binding. | live; wiki Features L28-L47 |
| Encoders | Sensor bindings | Below the layer a `Sensor bindings` section shows `encoder_left`, `encoder_right`, each with an up and down binding such as `RGB_HUI`, `RGB_HUD`, `&rgbknob`. Sensors are found in the board or shield files and `status = "disabled"` is ignored. | live; wiki Changelog L189-L198; Limitations L27-L31 |
| Theming | Dark mode and settings | A half-circle button toggles theme. A gear opens Settings: `Interpret HYPER mod`, `Use Unicode Glyphs`, `Platform specific glyphs` (Automatic, Windows, macOS), and the experimental feature toggles. | live |
| Validation | GitHub load errors | A modal titled by the error class (`InfoValidationError`, `KeymapValidationError`, missing-file) lists errors, with the file path and a hint to try another repo or branch. A warning modal appears when `info.json` has no `row`/`col` on any key. | src `ValidationErrors.js#L23-L51`; `Picker.js#L62-L73`, `#L220-L237` |
| Validation | Keymap content checks | The server checks only that each binding starts with a known behaviour. "TODO: validate remaining bind parameters". | src `api/services/zmk/keymap.js#L142-L178` |
| Validation | Live warnings | A `Warnings` tab flags duplicate node names, duplicate labels and macros whose name suggests a password. Unset required params disable `Apply`. | earlier review; live (disabled Apply) |
| Undo | None | No undo or redo. Edits live in `editingKeymap` until commit. `Commit Changes` is disabled when nothing changed. | src `App.js#L23`, `#L100-L109`; earlier review |
| Shortcuts | Keyboard use | Only inside pickers: arrow keys, Enter, Escape. Enter and Escape also work in the layer rename input. No global shortcuts. | src `ValuePicker/index.js#L106-L124`; `LayerSelector.js#L110-L113` |
| Glyphs | Keycode symbols | 366 keycode entries carry names, descriptions, categories and optional symbols. Basic, Unicode and per-OS glyph sets render `⌘`, `⌥`, `⮐`. | src `app/src/keycodes.js#L17-L41`; wiki Changelog L139-L158 |
| Locales | Other layouts | `keys_xx.h` headers from zmk-locale-generator, added to `config/` and included, add keycodes to the picker. | wiki `Keycodes-for-other-locales.md` |

## Core task click counts

Counts are mouse clicks. Typing is listed separately because it is optional where the target is on screen.

### Mod-tap (hold Ctrl, tap A) in the live app: 8 clicks and 2 typed strings

Measured on the Demo Keyboard on 2026-10-15 against a `&kp TAB` key.

1. Click the key. The dialog opens.
2. Click the `Behavior` row.
3. Type `&mt`, click `Mod or Tap behavior`.
4. Click the `hold` parameter.
5. Type `LCTRL`, click `Left Control`.
6. Click the `tap` parameter.
7. Click `a and A` (it is the first list item, so no typing).
8. Click `Apply`.

Two things cost extra. The hold parameter is typed `Key Code`, not a modifier, so the modifier checkboxes alone cannot set it. Ticking `LCTRL` there made `LC(TAB)`, which is the wrong value for `&mt`. And the new tap slot starts empty, so `Apply` stays disabled until it is filled.

### Mod-tap in the public source: 6 clicks and 1 or 2 typed strings

Read from code, not run. Click the top-left label (`Key.js#L92-L99`), pick `&mt` (the list has 18 entries, so a search box shows). Click the first parameter, which is a modifier list (`mod` kind, `Keyboard.js#L26-L32`), and pick `LCTRL`. Click the second parameter and pick `A`. Each pick applies at once, so there is no confirm step. Params reset to empty after the behaviour switch (`Key.js#L70-L71`).

### Combo of two keys, live app: 12 clicks and 1 typed name

Measured up to the final Apply step, not saved.

1. Click `combos` tab.
2. Click `Add New Combo`.
3. Click the pencil next to `Name`, type `esc`, press Enter.
4. Click the first key on the mini-keyboard.
5. Click the second key.
6. Click the `&none` binding tile.
7. Click the `Behavior` row, then pick `&kp` (two clicks, counted as one step; the total below includes both).
8. Click the `Key Code` parameter.
9. Pick `ESC`.
10. Click `Apply` in the binding dialog.
11. Click `Create`.

Steps 6 to 10 repeat the key-edit dialog inside the combo dialog, so a combo costs the single-key flow plus four extra clicks. The mini-keyboard is small (screenshot 06), and the combo is created on `Create` only after the binding dialog closes.

## Limitations and pain points

- Every edit goes through a dialog with Apply. Changing one key from `&kp` to a mod-tap takes 8 clicks. The dialog has no "recent" or "common" shortcuts. Modifier tick boxes apply to code wrapping, not to the hold slot of `&mt`.
- Combos cannot be made from the keymap view. The user must switch tabs, name the combo, pick positions on a tiny map, then set a binding in a second stacked dialog.
- A custom hold-tap must be created in the `behaviors` tab first (type choice, Create, property form with a required `tapping-term-ms` and two nested binding slots) before it can be placed on a key. Homerow mods therefore start with a separate form, not the key.
- Required values stay empty until set. A new `&mt` has an empty tap slot and a disabled Apply, with no suggested default.
- The public source cannot do any of combos, macros, hold-tap creation, sensors or conditional layers. A team that reads only the repo would underrate the product and copy the wrong thing.
- Building and flashing are out of scope. Commit pushes straight to the chosen branch with the message "Updated keymap". There is no diff or review step before it (`App.js#L36-L54`).
- Layer delete does not renumber references (`Keyboard.js#L125-L137`). Layers are identified by index.
- GitHub is the only convenient route. It needs OAuth, a GitHub App install, a hosted server holding a JWT with the user's OAuth token (`auth.js#L61-L68`), and a fixed `state: 'foo'` on the OAuth redirect (`auth.js#L27-L31`). Local use means pasting from the clipboard or a Chromium-only file picker.
- The GitHub path needs `config/info.json` and `config/keymap.json` in the repo. A repo without them shows an error, not a conversion offer. Only the first `*.keymap` in `config/` is handled.
- Validation is structural. The server accepts any parameter text after a known behaviour name (`keymap.js#L169`).
- No undo, no redo, no global shortcuts, no multi-key select for bulk edits outside the Quick Assignment menu.
- Accessibility. Keys render as `button` elements with the code text nested in non-focusable `span`s in the live app. The public source uses plain `span`s with click handlers (`KeyParamlist.js#L17-L18`, `KeyValue.js#L29-L35`).
- ZMK only. No QMK.
- The source is frozen. Features above beyond the 2023 snapshot cannot be inspected or patched.

## What keyloom should take

- Give each key a click-to-edit panel with Behavior and Parameters rows, a live preview of the resulting binding, and a mini-keymap with the edited key highlighted (screenshot 03).
- Make the hold slot of a mod-tap a modifier-only picker, so "hold Ctrl, tap A" takes a click on the key, a click on mod-tap, a click on Ctrl, a click on A, and Apply.
- Offer common bindings (mod-tap, layer-tap, one-shot) as pickable shortcuts, so a mod-tap is one choice instead of search then two params.
- Keep a searchable fuzzy picker with highlighted matches and arrow, Enter and Escape handling, capped at 30 results.
- Keep compatible parameters when the behaviour changes (`&kp TAB` to `&mt` kept TAB as hold). The public source clears them, so copy the live behaviour.
- Disable Apply until every required parameter is set, and mark unset parameters with a visible `⦸`.
- Show nested parameters as `(`, `)` and `,` around inner values, and shrink font by label length (`styles.module.css#L24-L29`).
- Show a combo on its own card with the member keys lit on a scaled mini-keyboard, and give each card rename, properties, duplicate and delete.
- Let a user create a combo from the keymap view by selecting two keys, so keyloom beats its 12-click flow.
- Build hold-tap creation inline from the key editor, with the keymap-editor property list (`tapping-term-ms`, `flavor` and the rest) as the form and required fields marked.
- Include a bulk "convert all `&trans` to `&kp`" style layer menu, plus Duplicate layer.
- Rename a layer inline by clicking the active name, with Enter and Escape.
- Warn before layer delete and list every `&mo`, `&lt`, `&tog` or `&to` that references it.
- Show a diff of the proposed `.keymap` and a validator result before any write, so there is nothing like `Updated keymap` pushed blind.
- Add undo and redo, which the reference lacks.
- Add a settings dialog with a glyph set (basic, Unicode, per OS) and a theme toggle.
- Show an encoder row per sensor with up and down bindings under the layer.
- Keep errors in a modal that names the file and lists problems, as `ValidationErrors.js#L23-L51` does.
- Render keycodes as real buttons with labels, so the editor is keyboard-operable.
- Skip a hosted OAuth server. Read and write local files, and treat GitHub as optional.
