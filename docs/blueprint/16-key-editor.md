# 16: Key editor: everything about a key is built on the key

Source update, 2026-11-01: ZMK encoder turns are editable per layer on the encoder's key card (D-469). This replaces the encoder deferral in D-105, not the other deferred features below. [The encoder recipe](../encoder-layers.md) covers availability, the UI and checked CLI path; compilation passed for both Keebart halves, with no new hardware test.

Status: built in v0.11.0 to v0.19.0 (rungs 9, 11, 14, 15, 16 and 18), as of v0.36.1. That covers changing any key, the key panel, tap dance slots, macros, combos from a selection, layer management, moving and copying keys, history, the settings page and per-key and per-layer lights. Conditional layers were added afterwards (D-385 to D-389). Not built: the features in "What keyloom doesn't take, and why" (D-105). The hardware checks in the rungs' "done when" lines are mostly unrecorded; see [13](13-roadmap.md). Written 2026-10-15 against origin/main at `65cc12a` (v0.10.1).

This chapter adds what keyloom's web editor lacks compared with keymap-editor, Oryx and Vial. BK asked us to "go through every feature of nickcoutsos' configurator and every feature of oryx" and "do the same for vial", "so that we can build those features into keyloom". It replaces the binding editor in [09](09-web-editor.md#interactions) with a key panel. It also adds tap dance, macros made on the key, combos made from a selection, layer management and moving keys. How a change reaches the keyboard is in [17](17-keyboard-sync.md). How it all looks is in [18](18-visual-design.md).

The research behind it, with click counts measured in each tool:

- [../research/configurators/oryx-features.md](../research/configurators/oryx-features.md): configure.zsa.io, driven live on a scratch layout.
- [../research/configurators/vial-features.md](../research/configurators/vial-features.md): vial-gui and vial-qmk, read at pinned SHAs.
- [../research/configurators/keymap-editor-features.md](../research/configurators/keymap-editor-features.md): the deployed keymap-editor, driven live, plus its 2023 source.
- [../research/keyloom-ui-audit.md](../research/keyloom-ui-audit.md): keyloom v0.10.1, driven against a copy of BK's layouts.

## BK's rule: never create a thing elsewhere and come back to assign it

BK's words: "Others need you to first go create a thing somewhere else and then you come and assign the thing to the key, there's no way to click a key and then create the complex thing for the key right there. but I think oryx comes close to this." And: "Oryx is great in terms of the actual configuring and making keys be what you want them to be. I think configuring takes the least steps in oryx." (D-085)

The research confirms the pattern he describes:

| Tool | Where a tap dance is made | Where a macro is made | Where a custom hold-tap is made |
|---|---|---|---|
| Vial | The Tap Dance tab, then assigned as `TD(n)` from the keymap palette (9 clicks) | The Macros tab, then Save, a 5 s physical unlock, and assigning `Mn` (8 clicks) | Not per key: the tapping term is global |
| keymap-editor | The `behaviors` tab: Add New Behavior, pick a type, Create, fill the property form | The `macros` tab | The `behaviors` tab, before it can be placed |
| Oryx | On the key, by filling "double-tapped" (5 clicks) | On the key, in the picker's Macro tab (12 clicks) | On the key, by filling "held" |
| keyloom v0.10.1 | Impossible: tap dance isn't in the model | CLI or chat only | Profiles exist and are picked on the key |

So keyloom takes Oryx's model and removes the steps Oryx still has (D-086).

## The key panel

Clicking a key opens its panel beside the board ([18](18-visual-design.md#the-board-stays-in-view-while-a-key-is-edited)). The panel describes the key as up to four slots, following Oryx's model (D-086):

```
┌ Key 31 · Layer "Base" ─────────────────────────────── ✕ ┐
│ When tapped            A                          ⋯     │
│ When held              Left Ctrl                  ⋯     │
│ + When double-tapped                                    │
│ + When tapped, then held                                │
│                                                         │
│ Feels like: home-row mod, 400 ms, tap preferred   Tune  │
│ A on the keyboard: also on Layer "Nav" key 12           │
│                                                         │
│ Swap · Copy · Label · Colour              Undo  Apply ↵ │
└─────────────────────────────────────────────────────────┘
```

- **Slots.** "When tapped" always shows. "When held", "When double-tapped" and "When tapped, then held" each take one click to add, and a filled slot has a clear button. The filled slots decide the binding kind, so the person never picks a kind first (D-086):

  | Filled slots | Binding kind (02) | QMK output | ZMK output |
  |---|---|---|---|
  | tap | `key`, `modifier`, `layer` or `macro` | a keycode | `&kp`, `&mo` … |
  | tap + hold | `holdTap` | `MT()`/`LT()`, or a custom hold-tap | `&mt`/`&lt`, or a hold-tap node |
  | tap + double-tap, with or without hold or tap-then-hold | `tapDance` (new) | a `TD(n)` entry that keyloom names and numbers | a `&td` node, with a hold-tap inside when "held" is set |

- **One picker for every slot.** Clicking a slot opens the same picker in the panel (D-087).
  - The search box is focused, with keyloom's fuzzy matching over names, aliases and labels.
  - The category tabs are Letters and digits, Punctuation, Modifiers, Layers, Navigation and editing, Media and system, Mouse, Function keys, Macro, and Any.
  - The hold slot opens on Modifiers and Layers, because those are almost always what a hold is. This fixes keymap-editor's `&mt` hold slot, which takes keycodes, so "hold Ctrl" there needs a search.
- **Modifiers on any key.** Under the chosen key, Shift, Ctrl, Option/Alt and Cmd/GUI toggles turn it into a one-key shortcut. keyloom's current editor already does this, and so does Oryx.
- **Any.** A text field takes a firmware expression (`LCTL_T(KC_A)`, `&mt LCTRL A`) and shows what it parses to. This escape hatch lets the categories stay small, as Vial's "Any" does. An expression that keyloom's model can represent becomes a model binding. Anything else becomes a `native` binding (D-024).
- **Apply.**
  - Each change is checked as it's made, by the in-browser validation (D-014), and shown on the board as a draft.
  - Enter or Apply commits it. A change with no warnings needs no confirmation.
  - The panel stays on the key after Apply, so the next slot can be filled straight away. Vial moves the selection off a key after the first pick of a mod-tap, which costs two clicks.
- **Keeping values.** Moving between kinds keeps whatever matches. Adding a hold to A keeps A as the tap. Adding a double-tap to a mod-tap keeps both. keyloom's current editor already does this, and so does the live keymap-editor.
- **Timing on the key.** A key with a hold shows its timing profile in one plain sentence. Tune opens the profile editor that rung 6 built (D-057). Per-key timing is set here, not on a settings page; Oryx sends people to its settings page for this (D-103).
- **Where else.** The panel says where else the key's function lives, so dropping it is never a surprise (see [dropping a function](#replacing-a-key-whose-function-exists-nowhere-else-asks-in-plain-words)).

### Encoder turns and presses share a card

Select a layer, then click its encoder press. Clockwise and Counterclockwise controls appear before the ordinary press slots, including on phones. Choose a key, mouse movement, scrolling or Nothing. Edit the press below; mouse buttons can use the Any picker with exact ZMK calls such as `&mkp LCLK`.

Turns and the press share Apply, Discard and the preserved-draft lifecycle. If another edit changes the key or the layer's sensor bindings, the parked draft is discarded rather than overwriting newer work. Use board defaults on this layer resets turns only, through the same validated Apply.

On the Keebart Corne, each physical knob has two alternative firmware sensor footprints. The card changes both together and leaves the other knob and other layers alone. An opaque imported sensor call reads Custom encoder behaviour; replacing it with a direction choice creates an editable pair, with Nothing for the other direction until selected. Use a keyloom JSON export to retain typed pairs; firmware-source reimport may preserve them as opaque calls instead.

To check this without a keyboard, run `bun scripts/dev-encoders.ts 4493` and open its printed URL. Click the left encoder, change a turn, then Discard; repeat with Apply and switch to Numbers to check its turns stayed unchanged. [Light/dark desktop/phone captures](../screenshots/encoder-layers/README.md) record the tested states.

### Macros are made in the picker, and each pick adds a step

The picker's Macro tab builds a macro for this slot (D-088):

```
┌ When tapped › Macro ─────────────────────────────────────┐
│ Type text  [ git status⏎               ]                 │
│ or add keys: [search…]  ⌃ ⇧ ⌥ ⌘                          │
│ 1  ⌘ + C                         wait 0 ms   ↑ ↓ ✕       │
│ 2  ⌘ + Tab                       wait 100 ms ↑ ↓ ✕       │
│ 3  ⌘ + V                                     ↑ ↓ ✕       │
│ Sends ⌘C, then ⌘Tab, waits 100 ms, then ⌘V        Done   │
└──────────────────────────────────────────────────────────┘
```

- **Steps.** Picking a key in the search adds a step and keeps the search open. A three-key macro is: click the slot, Macro, three picks, Done. That's six clicks against Oryx's 12, because Oryx needs a CLOSE after each step.
- **Text.** A text step types a string. keyloom turns it into taps, with the right shift states for the OS layout in [02](02-layout-model.md#keycode-is-keylooms-own-name-set).
- **Modifiers and waits.** Each step can carry modifiers and a wait. The summary line reads the macro back in words, as Oryx's "sends these keys in sequence" does.
- **Naming and reuse.**
  - The macro is stored as a `Macro` in the layout, with a generated name ("Copy, switch, paste") that BK can change. It is never created anywhere else first.
  - A macro used by more than one key appears in the layout's library (see [the library](#the-library-lists-what-keys-share-and-is-never-a-required-step)).
  - Editing a shared macro from any key asks "this key only, or every key that uses it?".
- **Passwords.** A macro whose text looks like a password gets the warning keyloom already gives ([07](07-change-validation.md#warnings)).
- **Holds.** ZMK and kanata can run a macro from a hold-tap's tap slot; keyloom preserves that macro while editing the hold. QMK's basic `MT`/`LT` tap parameter cannot run a macro, so validation refuses that combination and recommends a tap dance instead (D-024). ZMK generation uses a specialized behavior rather than placing a macro label in a keycode cell ([06](06-firmware-zmk.md#generation-writes-glove80keymap-and-glove80conf)).

### Tap dance is a key with a double-tap slot

Filling "When double-tapped" or "When tapped, then held" makes the key a tap dance (D-086). The person never sees `TD(n)` or `&td`.

- keyloom gives the entry a stable ID and generates the firmware construct.
- The cap shows every slot ([18](18-visual-design.md#a-keycap-shows-every-slot-it-has)).
- A tap dance has one tapping term, shown in the panel's timing sentence.

This chapter adds to the data model in [02](02-layout-model.md#the-layout-document) (D-093):

```ts
type SlotAction =                       // what one slot does
  | { kind: "key"; code: KeyCode; mods?: Mod[] }
  | { kind: "modifier"; mods: Mod[] }
  | { kind: "layer"; action: "momentary" | "toggle" | "to" | "oneShot"; layerId: string }
  | { kind: "macro"; macroId: string };

type Binding =
  | /* … the existing kinds … */
  | { kind: "tapDance"; tapDanceId: string };

type TapDance = {
  id: string; name: string;
  tap: SlotAction;
  hold?: SlotAction;
  doubleTap?: SlotAction;
  tapThenHold?: SlotAction;
  termMs?: number;                      // falls back to the firmware's tapping term
};

// Layout gains: tapDances: TapDance[]
```

- **QMK.** keyloom emits `tap_dance_actions[]` with `ACTION_TAP_DANCE_FN_ADVANCED` and a small state machine per entry, in the shape Oryx generates. That lets the importer read BK's existing Oryx tap dances (TD0, TD1 and DF0 on his Moonlander) into the model, instead of keeping them as opaque `native` keys (S16).
- **ZMK.** keyloom emits a `&td` node whose `bindings` are the tap and double-tap actions. When "held" or "tapped, then held" is set, each position in it is a hold-tap node that keyloom generates. ZMK's tap dance has no separate tap-then-hold, so keyloom builds it from a hold-tap in the second position. The emulators check whether that feels the same as QMK's (S16).
- **Combos.** Tap-dance keys can be in combos in both firmwares. Oryx forbids this; keyloom doesn't follow it.
- **Validation.** The reachability rules treat each slot's action as a function ([02](02-layout-model.md#functions-and-reachability)). A tap dance whose tap and double-tap match gets a warning.

### Combos are made from a selection

Select two or more keys on the board, then choose "Make a combo" in the selection bar. The key panel opens on the combo's output, with the same picker (D-089).

- The name is optional. keyloom names the combo from its output ("Esc combo").
- Layers default to all, with a choice under "More".

A two-key combo then takes five clicks: select key 1, select key 2, Make a combo, pick Esc, Apply. Oryx takes 8 plus typing a name, and keymap-editor takes 12.

- **On the board.** With "Show combos" on, each combo shows as a line between its keys, with its output as a small label. Combos are also listed in the library. Hovering either highlights the keys, which is the best part of Oryx's list.
- **Editing.** Clicking a combo's line or its list row opens its panel. The panel edits the output, the keys (by clicking on the board), the layers and the timeout.
- **Positions.** keyloom's model stores combos by key position, which is what both firmwares need. Vial's combos match keycodes and take at most four inputs. keyloom has no limit beyond the firmware's own.

### Layers are managed in their tabs

The layer tabs gain the actions that [09](09-web-editor.md#interactions) promised and v0.10.1 doesn't have (D-090):

- **Add.** A "+" adds a transparent layer named "Layer N", with its name ready to edit.
- **Rename.** Click the active tab's name to rename it inline. Enter saves and Escape cancels. This fixes Oryx's "Layer 0" names and the Glove80's `one_shot` names on caps ([18](18-visual-design.md#legends-stay-readable-at-every-size)).
- **Duplicate.** The copy keeps the layer's contents.
- **Reorder.** Drag a tab, or use Move left and Move right in its menu. Reordering is safe because references use layer IDs ([02](02-layout-model.md#conventions)).
- **Delete.** Before deleting, keyloom lists every key that switches to the layer. The validator refuses the delete while any of those keys would then reach nothing. keymap-editor deletes by index splice, which breaks other layers' references.
- **Short label and colour.**
  - Each layer has a short label of up to four characters, defaulting to the first letters of its name. Layer keys show it on the cap.
  - Each layer has a colour, which shows on its tab and on the keys that reach it.
- **Bulk convert.** The tab menu turns every transparent key into none, or the reverse, as keymap-editor's layer menu does. Each conversion is one change set, so it undoes as one.

### Moving and copying keys

- **Swap.** Choose "Swap" in the panel, then click the destination, on this layer or another. The two keys exchange bindings in one change set (D-091). Oryx takes three clicks for this; keyloom takes two from an open panel.
- **Drag.** Dragging a key onto another swaps them. Holding Option while dropping copies instead.
- **Copy and paste.** Copy in the panel, then Paste onto each selected key, or use Cmd-C and Cmd-V with keys selected. One paste is one change set.
- **Quick assign.** With keys selected, typed keystrokes are assigned to them in order. [09](09-web-editor.md#interactions) promised this and it's still missing. It's kept, and each run is one change set.

### Replacing a key whose function exists nowhere else asks in plain words

The audit found that changing F16 to F17 is refused. F16 would become unreachable, and the web app can't add a `dropFunction` op (`src/validation/rules.ts:230`). This blocks most single-key edits, so it's the first thing this chapter fixes (D-092).

When a change would drop a function, the panel says so before Apply:

```
F16 won't be on your keyboard any more.
[ Drop F16 ]   [ Put F16 somewhere first ]
```

- "Drop F16" adds the `dropFunction` op to the change set, and Apply goes through as normal.
- "Put F16 somewhere first" opens the picker in "place" mode: the next key clicked gets F16, in the same change set.
- The validator's internal text, with its layer IDs and 0-based positions, never reaches the screen. Each rule gets a sentence written for people (D-101). The raw text stays in the log and the CLI's JSON.

### The library lists what keys share and is never a required step

A panel beside the layer tabs lists the layout's macros, tap dances, combos and timing profiles.

- Each row shows where the item is used, and highlights those keys on hover.
- Every item can be edited or deleted there, but nothing has to be created there. Each one is made on a key or from a selection (D-085).
- The library is for reuse. Picking a library macro or tap dance in the picker puts the same one on another key.

## Settings and lighting

- **Settings page.** Firmware-wide options are on one page with a filter box: tapping term, combo term, one-shot timeout, Caps Word, auto shift and mouse keys.
  - Each option shows its default, a slider or switch, and a paragraph on when to change it, as Oryx's page does (D-103).
  - Options keyloom doesn't model yet are listed read-only, from passthrough, so nothing is hidden.
- **Built as:** a Settings button in the toolbar opens the page in the side column ([D-191](14-decision-log.md#d-191-the-settings-page-offers-options-whose-defaults-were-read-from-the-pinned-firmware-writes-feature-switches-to-rulesmk-and-keeps-hold-tap-profiles-that-copied-an-option-in-step-with-it-claude-building-rung-18-d-103)). Edits stage and are applied as one change set.
- **Lighting.** On boards with per-key RGB (the Moonlander), each layer can set a colour for the whole layer or for individual keys. The colour shows on the caps in the editor, like Oryx's "Individual keys" and "Layer" tabs. It's the last rung of this chapter, because neither of BK's two problems (D-025) needs it (D-104).

## What keyloom doesn't take, and why

| Feature | Seen in | Why not now |
|---|---|---|
| Accounts, cloud layouts, search, tags, tours, embeds, layer templates | Oryx | keyloom is local, with no accounts (D-007, D-028). Deferred, not rejected (D-105) |
| GitHub OAuth app and commit-to-branch | keymap-editor | It needs a hosted OAuth server. keyloom writes local files and builds the firmware itself (D-028) |
| Key overrides, alt repeat, MIDI, stenography, audio keys | Vial, Oryx | No validated need. They're reachable through Any as `native` bindings (D-105) |
| Matrix tester | Vial | It needs a firmware-side matrix report that keyloom doesn't build. A hardware fault is rare enough to use Vial or QMK's console (D-105) |
| `.vil` import and export | Vial | Only useful if keyloom adopts Vial firmware, which it doesn't (D-097). Revisit with that |
| Smart Layers, Keymapp overlay, live training | Oryx and Keymapp | They need a running companion app that watches the keyboard. Out of scope (D-105) |
| A macro recorder | Vial (Linux and Windows only) | Typing text and picking keys covers it. Recording needs OS key capture (D-105) |

## Parity matrix

What each tool does, and the keyloom rung that brings it ([13](13-roadmap.md)). "—" means the tool doesn't have it.

| Feature | keymap-editor | Oryx | Vial | keyloom v0.10.1 | keyloom plan |
|---|---|---|---|---|---|
| Change any key in the editor | Yes | Yes | Yes | Only if the old function survives elsewhere | Rung 9 |
| Plain-words problems | Partly | Yes | — | Validator text | Rung 9 |
| Key panel with tap and hold | Dialog with Apply (8 clicks for a mod-tap) | Popover (5) | Masked keycodes (5) | Binding editor (4) | Rung 11 (3 from an existing A, 4 from empty) |
| One picker with categories and search | Yes | Yes | Tabs, no search | Search only | Rung 11 |
| Any expression | — | — | Yes | — | Rung 11 |
| Hands-free flash | — | Oryx in Chrome needs a reset press | Vial bootloader jump after unlock | Moonlander only | Rung 12 (ZMK) |
| Apply puts it on the keyboard | — | — | Yes, live | Separate Build and flash | Rung 13 |
| Tap dance | Separate behaviour | On the key | Separate tab | — | Rung 14 |
| Macros | Separate tab | In the picker | Separate tab with unlock | CLI or chat | Rung 14 |
| Combos | Tab, 12 clicks | Wizard, 8 | Tab, 7 | CLI or chat | Rung 15 (5 clicks) |
| Layer add, rename, duplicate, reorder, delete | Yes (index delete bug) | No duplicate | No (fixed count) | Switch only | Rung 15 |
| Swap, drag, copy and paste keys | — | Swap mode, copy and paste | — | — | Rung 15 |
| Revision history with any-step undo | — | Revisions (account) | — | One-step undo | Rung 16 |
| Dark mode toggle, glyph sets | Yes | — | Themes | OS setting only | Rung 16 |
| Phone layout | — | View only | — | Board scrolls sideways | Rung 16 |
| Live writes with no flash | — | — | Yes | — | Rung 17 (after S15 and S14) |
| Settings page with prose | Settings dialog | Yes | QMK settings tabs | — | Rung 18 |
| Per-key and per-layer RGB | — | Yes | VialRGB | — | Rung 18 |
| Conditional layers | Yes | — | — | Layer menu: "Also on when … and … are held" (D-389) | After rung 18 |
| Choice of AI provider | — | — | — | Anthropic API only | Rung 10 ([19](19-model-providers.md)) |
| Agent proposals and decision memory | — | — | — | Yes | Kept |
