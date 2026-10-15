# 09: Web editor

The browser side of `keyloom serve` (D-028). It puts the keyboard picture and the chat side by side, both editing one layout (D-003, D-013). The aim is that BK sees a proposed change on the keyboard before he flashes anything, because the picture is the fastest way to catch a misunderstanding (D-015).

BK pointed to `nickcoutsos/keymap-editor` as "a pretty good editor" to learn from (D-044). Its public source is a 2023 snapshot under MIT. The polished app it's known for is closed, and its author has stopped publishing source. The full reading, with an adopt, adapt or skip verdict for each idea, is in [../research/keymap-editor.md](../research/keymap-editor.md) (`main` at `e7946792`). This document says where each adopted idea lands.

## Screen

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ keyloom   Moonlander ▾  "Daily driver" ▾        rev_01J… (applied 2m ago)   Build  Flash  │
├───────────────────────────────────────────────────────────────┬─────────────────────────┤
│ Layers: [Base] [Numbers] [Symbols] [Nav] [+]   ⧉ dup  ⇅ drag  │ Chat                    │
│                                                               │                         │
│   ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐        ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐  │ You: Some apps want     │
│   │= ││1 ││2 ││3 ││4 ││5 ││  │        │  ││6 ││7 ││8 ││9 ││0 │  │ Option–Option and I…   │
│   └──┘└──┘└──┘└──┘└──┘└──┘└──┘        └──┘└──┘└──┘└──┘└──┘└──┘  │  [Selected: S on Base]  │
│   ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐            ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐  │                         │
│   │A ││S⌥││D⌃││F⌘││G ││  │   …        │  ││H ││J⌘││K⌃││L⌥││; │  │ keyloom: Which layer do │
│   └──┘└──┘└──┘└──┘└──┘└──┘            └──┘└──┘└──┘└──┘└──┘└──┘  │ you hold with the right │
│        …                  ╲ thumbs ╱            …              │ hand?                   │
│                                                               │                         │
│ ── Proposal A: Plain Option on Symbols ─────────────── Apply ─ │ ┌ Proposal A ─────────┐ │
│ changed: Symbols/S   displaced: none   relearn: 0             │ │ gains: Option–Option │ │
│ ⚠ none                                                        │ │ costs: hold Symbols  │ │
│ ── Proposal B: Option–Option macro on combo J+K ────── Apply ─ │ └──────────────────────┘ │
│                                                               │ Remembered: keep BSPC ✕  │
│                                                               │ [ message …        ] ⏎  │
└───────────────────────────────────────────────────────────────┴─────────────────────────┘
```

- **Left: the keyboard.** One layer at a time, with tabs. A key shows its tap label and, for a hold-tap, its hold as a small glyph. `native` bindings show their `label` with a firmware badge (D-024). `transparent` keys show the binding underneath, faded.
- **Right: the chat.** Streaming replies, proposal cards and priority chips (D-021).
- **Header:** board and layout pickers, the head revision, Build and Flash with progress from `/api/events`, and History (revisions, with undo and "flash this revision").

## Rendering keys

Geometry comes from the board's generated `geometry.json` ([04](04-boards-and-contributions.md#geometryjson-is-generated-from-the-firmware-tree)). Each key is an absolutely positioned element. Its box is `x`, `y`, `w`, `h` times a unit size. Rotation is `rotate(r)` around `(rx, ry)` relative to the key's own origin, through `transform-origin`. The canvas size comes from the bounding polygon of all rotated keys.

This is keymap-editor's model, about 40 lines in `app/src/key-units.js` and `keymap-layout-tools/lib/geometry.js` (MIT). keyloom reimplements it in TypeScript as `src/web/keyboard/geometry.ts`, with an `Adapted from` header. Thumb clusters need no special case, because they're just rotated keys. The same function gives the agent's text grid its rows and columns ([03](03-agent.md#tools)), so the generated `.keymap` and `get_layout` read like the keyboard (keymap-editor's text-table idea, adapted to take rows from geometry).

## Interactions

| Interaction | Behaviour | Source |
|---|---|---|
| Click a key | Toggles it in the selection. The selection is sent with the next chat message (D-012) | keyloom |
| Drag across keys | Selects every key the marquee touches. Also used to choose combo positions and `hold-trigger-key-positions` | keymap-editor's drag-select, adopted |
| Double-click a key, or press Enter with one key selected | Opens the binding editor for that key | Adapted: keymap-editor edits on a single click, but in keyloom a single click selects for chat |
| Binding editor | Kind tabs (Key, Modifier, Hold-tap, Layer, Macro, None, Transparent). The key picker for codes. Modifier toggles beside it, so `Shift+1` is a key with mods, not a macro. For a hold-tap: tap, hold and profile | Modifier toggles, adopted |
| Key picker | Keyboard-first fuzzy search over names, aliases, labels and categories from the generated keycode table ([02](02-layout-model.md#keycode-is-keylooms-own-name-set)). Arrow keys, Enter, Escape, autofocus. A real ARIA listbox | keymap-editor's picker, adopted |
| Why this change | After a binding is chosen, an optional one-line "Why this change?" is sent with the apply. If BK types one, applying writes a decision with it (08, D-052) | keyloom (rung 6) |
| Tune a hold-tap | Selecting a hold-tap key shows its timing profile: tapping term, quick tap, and the firmware's other per-profile options. A scope choice edits the shared profile or gives this key a profile of its own. It goes through the same check and apply as every other change (D-017, D-057) | keyloom (rung 6) |
| Change kind, keep parameters | Switching a hold-tap's profile, or between hold-tap and plain key, keeps the tap and hold values where the kinds match | Adopted (keymap-editor issue #225) |
| Quick assign | With keys selected, "Quick assign" takes typed keystrokes and assigns them to the selected keys in order. The result is one change set, so it undoes as one | Adopted, with undo added |
| Selection bar | A row under the layer tabs says how many keys are selected and on which layer, with Clear selection and Repeat last change. A selected key shows an accent ring, a tint and a tick, so it differs from the current key (outline), a draft (dashed, dot) and a move's landing (dotted) without relying on colour. It works on rotated thumb keys | keyloom (rung 7) |
| Repeat on selection | Applies the last editor change to each selected key as one change set: the same hold with the key's own letter, taking the hold off, or the same binding (D-061). The panel lists every key before and after and the validator's result, and Apply is one change that undoes as one | keyloom (rung 7) |
| Layers | Add, rename, duplicate, drag to reorder, remove. Reorder is safe because references use layer IDs, not indices ([02](02-layout-model.md#conventions)) | Adopted. keymap-editor's index-splice delete is the bug to avoid |

Every editor change goes through the same path as the agent's. The UI builds `ChangeOp[]`, runs `validate` in the browser for instant feedback (`validation` is pure and bundled into the web app, [01](01-architecture.md#modules)), then posts the change set to the server, which validates again and applies. An editor change applies directly when it's valid and has no warnings. If it has warnings, the preview strip shows them and asks for confirmation.

## Proposals

Each proposal from the agent ([03](03-agent.md#the-loop-for-one-message)) shows twice. A card in the chat carries the title, explanation, gains and costs. A strip under the keyboard carries the changed, displaced and dropped functions, the relearn count, warnings and reminders ([07](07-change-validation.md)).

- Hovering a proposal highlights its changed keys on the keyboard, and shows displaced functions with an arrow to their new home.
- "Preview" switches the keyboard to the proposed document, with a banner showing it isn't applied. Comparing alternatives is a toggle between them.
- "Apply" applies it. The new revision appears, and the proposal's siblings are marked superseded. Apply never builds or flashes. Build and Flash stay separate buttons, so nothing touches the keyboard without a deliberate click.

## Decisions view

The decisions view lists the layout's decisions, as described in [08](08-decision-memory.md#inspecting-and-correcting). It sits in the chat panel beside History (D-059). Active decisions come first, with replaced ones folded away. Hovering a decision highlights the keys it covers and shows their layer. Each can be edited, retired, or opened at the conversation it came from. A previewed proposal that touches a remembered key shows the stored reason in the card, in a strip under the board, and as a mark on the keys.

## What keymap-editor does that keyloom doesn't

From the research verdicts:

- **Hosting.** It uses a GitHub App and keeps the user's OAuth token on a hosted backend. keyloom is local (D-028).
- **Builds.** It leaves builds to GitHub Actions. keyloom builds and flashes locally ([05](05-firmware-qmk.md), [06](06-firmware-zmk.md)).
- **Source files.** It edits the user's file in place and reformats it, and its issues show it dropping and reordering includes. keyloom generates deterministic files and keeps what it doesn't model as passthrough.
- **Unsaved-changes warning.** It warns before closing with unsaved edits. Every keyloom edit is already a saved revision.
- **Undo.** It has none.
- **Warnings.** Its warnings check names and syntax. keyloom's validator checks that nothing becomes unreachable. Two of its checks become validator warnings: identifiers that clash with ZMK names, and macros that look like typed passwords, which macro text shouldn't contain ([07](07-change-validation.md#warnings)).

## Stack

React with plain CSS modules, served through Bun's HTML imports, and no component library. The interface is one canvas, one chat and a few dialogs. Icons come from `lucide-react`. There are no emoji in the UI, per BK's rule. Server state is fetched with `fetch` and kept fresh by the SSE `layout.updated` event, with no client-side cache library in v1. The chat stream is rendered as it arrives.
