# 18: Visual and interaction design

Status: built where [23](23-design-concept.md) didn't replace it: the legend floor, the words, the states, keyboard use and the 1440 and 390 screenshot gate (rungs 14 to P5, 2026-10-16). Proposed 2026-10-15 against origin/main at `65cc12a` (v0.10.1).

**Partly replaced on 2026-10-16 by [23](23-design-concept.md) (D-260).** These rules no longer hold: kind shown by fill and shape at rest (D-264), one blue accent (D-263), no gradients or glow (D-263), Inter (D-261), trays (D-266), the toolbar row, the permanent side panel and the bottom chat bar (D-260). The rest of this chapter (legend floor, words, states, keyboard use, the 1440 and 390 screenshot gate) still holds.

BK: "please do a visual assessment of keyloom, right now it's built for functionality. to make sure it works without much regard for looking pretty. I want you to do a UI/UX blueprint." Earlier, while it was being built: "dont' build an ugly ui, check your work and make sure the UI you build looks good" and "and follows good design principles". The taste he named: "In terms of great UX I think i love most oryx and vial".

The assessment is [../research/keyloom-ui-audit.md](../research/keyloom-ui-audit.md): 26 screenshots of v0.10.1 on BK's own layouts, each finding tied to the file and line that causes it. This chapter is what we do about it. The key panel's content is in [16](16-key-editor.md), and the sync state is in [17](17-keyboard-sync.md).

## What the assessment found

keyloom v0.10.1 is accurate and accessible, but it reads like a tool for checking a layout, not for changing one.

- **Keep.** Faithful geometry, with rotated thumbs and upright legends. Real keyboard navigation. Text contrast of 6.6:1 to 9:1, guarded by `test/web/contrast.test.ts`. An honest Now → After flow. lucide icons with no emoji. Reduced-motion support.
- **The board isn't the centre.**
  - At 1440×900 the board uses about 920 px of width and 400 px of height.
  - A permanent 400 px chat column, a header of metadata, an instruction row, a legend strip and a 130 px instruction card take the rest.
  - Opening the editor scrolls the board 552 px out of view, so the draft key can't be seen (`src/web/Viewer.tsx:132-137`).
- **One click does two jobs.** It inspects a key and adds it to the chat selection (`src/web/keyboard/Keyboard.tsx:176-180`).
- **Kinds don't read.** A plain key against a modifier is 1.31:1 in light and 1.17:1 in dark. Empty keys' borders are 1.53:1, under the 3:1 minimum for non-text elements (`src/web/tokens.css:29-32, 68-71`).
- **Legends shrink instead of shortening.** 17 Glove80 legends render at 8.1 to 9.5 px, because layer keys print whole layer names such as "navigate" and "one_shot" (`src/web/keyboard/fit.ts:10-11`).
- **Firmware names leak.** `CHORDAL_HOLD true`, `KC_A`, `ST_MACRO_2`, TD0, and validator text with 0-based positions all reach the screen.
- **History means chats,** and undo goes back only one step.
- **A phone gets a board that scrolls sideways,** with the inspector covering the thumbs.

## Principles

1. **The keyboard is the page.** Everything else is a panel that serves it. Oryx gives the board the whole width and opens a popover on the key, which is why it feels direct (D-098).
2. **One click, one job.** Clicking a key edits it. Asking the chat about keys is a separate, explicit action (D-099).
3. **Show the change where it lands.** A draft is drawn on the cap it changes, and the cap stays visible while it's being edited (D-098).
4. **Plain words first, firmware names on request.** Every label uses words a keyboard user knows. An "Advanced view" toggle shows firmware names on caps and in panels, as Oryx's does (D-101).
5. **Kind is carried by shape and text as well as colour,** so it reads in both themes and for colour-blind users (D-100).
6. **Calm surfaces.** Neutral panels and one accent colour. Other colour is used only for kinds and states. No gradients, glow or decorative motion (D-100).
7. **The keyboard's state is always visible.** One line in the header says whether the keyboard has the latest change ([17](17-keyboard-sync.md#apply-sync-and-the-keyboards-state)).

## The board stays in view while a key is edited

```
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▣ keyloom   Moonlander · "synchronized" ▾        ● On your Moonlander        ☾   ⋯           │
├───────────────────────────────────────────────────────────────────────────────────────────────┤
│ [Base] [Nav] [Sym] [Num] [Media] [Fn] [+]        Combos  Library  History ↶ ↷   Advanced view │
├───────────────────────────────────────────────────────────────┬───────────────────────────────┤
│                                                               │ Key 31 · Base             ✕   │
│    ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐     ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐  │ When tapped     A         ⋯   │
│    │Esc││1 ││2 ││3 ││4 ││5 ││F16│    │  ││6 ││7 ││8 ││9 ││0 │  │ When held       Left Ctrl ⋯   │
│    └──┘└──┘└──┘└──┘└──┘└──┘└──┘     └──┘└──┘└──┘└──┘└──┘└──┘  │ + double-tapped               │
│    ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐        ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐  │ + tapped, then held           │
│    │⌫ ││A⌃││S⌥││D ││F⌘││G │  …     │  ││H ││J⌘││K ││L⌥││; │  │                               │
│    └──┘└╌╌┘└──┘└──┘└──┘└──┘        └──┘└──┘└──┘└──┘└──┘└──┘  │ Feels like: home-row mod …    │
│               ╲ thumbs ╱                  ╲ thumbs ╱         │                               │
│                                                               │ [ Apply ]                     │
├───────────────────────────────────────────────────────────────┴───────────────────────────────┤
│ Chat ▸ Ask keyloom about your layout                                                (⌘K)      │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **The board fills the stage.** The board's unit size is computed from the available width and height, so the Moonlander and the Glove80 fill the stage at any window size. Caps are at least 44 px on a laptop.
- **The side panel shows one thing at a time.** With nothing open, it shows a quiet layout summary. Clicking a key shows the key panel, a combo shows the combo panel, and the chat shows the conversation. Each replaces whatever was there before. The board never moves when a panel opens (D-098).
- **Chat is a drawer.** A one-line bar at the bottom (Cmd-K) opens the chat in the side panel. While chat is open, clicking keys adds them to "Asking about" chips in the composer, and a key's panel opens only from its chip. That keeps "one click, one job" true in both modes (D-099).
- **The header carries identity and state.**
  - It shows the board, the layout, the sync state and a theme toggle. The layout picker is a styled menu listing layouts grouped by board, with Import.
  - Build, Flash and Doctor move into a menu.
  - The import date, revision hash and key count move to the layout summary.
- **The toolbar under the header** carries the layer tabs, Combos, Library, History with undo and redo, and the Advanced view toggle. There's no instruction row. First-run hints show once, as a tip on the board that can be dismissed (see [states](#states-say-what-to-do-next)).
- **Notices don't push the board.** Apply, undo and errors use a toast at the bottom of the stage that disappears after 4 s, and undo stays in the toolbar. Today's full-width notice moves the layer tabs down 62 px.

## A keycap shows every slot it has

```
┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌╌╌╌╌╌╌╌╌╌┐   ┌─────────┐
│    A    │   │    A    │   │   Esc   │   │   NAV   │   ╎    a    ╎   │  Copy   │
│         │   │   ⌃     │   │ ⇈ Caps  │   │  hold   │   ╎         ╎   │ ▸ macro │
└─────────┘   └─────────┘   └─────────┘   └─────────┘   └╌╌╌╌╌╌╌╌╌┘   └─────────┘
  key           tap + hold    tap dance     layer key     transparent   macro
```

- **The tap legend** is centred, at 0.36u at full size.
- **The other slots are marked in the corners.**
  - The hold goes bottom-left, with a short glyph (`⌃`, `NAV`).
  - A tap dance shows its double-tap bottom-right, as `⇈ Caps`.
  - A tap-then-hold shows a small cluster of dots.
  - So the cap carries every slot, as Oryx's caps carry "hold" and a layer icon.
- **Layer keys** show the layer's short label ([16](16-key-editor.md#layers-are-managed-in-their-tabs)) and what the key does, in one word: "hold", "toggle", "go to" or "once". They never show a full layer name.
- **Kind is a shape and a fill** (D-100).
  - Hold-taps have a bottom band in the kind colour.
  - Layer keys have a left edge in the layer's colour.
  - Macros have the `▸` mark, and tap dances the `⇈` mark.
  - Transparent keys have a dashed edge and ink at 40%.
  - None keys have a solid border at 3:1 and a diagonal hatch.
  - Fill colours stay, but no kind depends on them alone.
- **Selection, draft and "remembered" marks never share an element.**
  - Selection is a 2 px accent outline plus a tick badge top-right.
  - A draft is a dashed accent outline plus a dot top-left.
  - A remembered reason is a small bookmark glyph top-left, inside the cap.
  - Each has its own element, so all three can show at once. Selection no longer tints the fill, so a selected hold-tap keeps its colour.
- **Combos** are drawn as a thin line between their keys, with a label at the midpoint, when Combos is on. This replaces the 6 px dot.

## Legends stay readable at every size

- **The floor is 11 px** for any legend on a laptop, and 10 px on a phone. A legend that doesn't fit is shortened, never shrunk below the floor.
- **Short labels come from tables.**
  - Each `KeyCode` in the generated table gets a short label of three characters or fewer ([02](02-layout-model.md#keycode-is-keylooms-own-name-set)).
  - Layer names get their short label.
  - Unicode glyphs come from one glyph set, with a setting for "macOS", "Windows" or "words", as keymap-editor's glyph setting does.
- **Text on rotated thumb keys stays upright,** as it is now.
- **Full names are one hover away,** in the cap's tooltip and in the panel.

## Visual system

| Token group | v0.10.1 | Change |
|---|---|---|
| Type scale | 12, 13, 14, 16, 20 px | 12, 14, 16, 20, 28 px (about 1.25 steps). Body 14, panel titles 16, page title 20, empty-state titles 28 |
| Weights | 400, 500, 600 | 400 and 600 only. Hierarchy comes from size and weight, not from grey on grey |
| Font | System UI | Inter from Google Fonts, with the system font as fallback, and tabular numbers for timings. Caps use the same family at 600 |
| Spacing | 4-based tokens, plus a few stray 2, 3, 6 and 28 px values | 4-based tokens only (4, 8, 12, 16, 24, 32, 48). A lint check forbids raw px in `src/web/**/*.css` outside `tokens.css` |
| Radius | Mixed | Caps 6 px, panels 12 px, controls 8 px |
| Colour | Neutral greys plus kind pastels | Neutral surfaces for the stage, panels and caps. One accent (blue) for selection, focus and primary actions. Kind fills tuned so neighbouring kinds differ by at least 1.5:1 in both themes, with shape cues carrying the rest. Green, amber and red only for sync states and validation |
| Elevation | Caps have a 3D bottom shadow | Caps keep a 2 px bottom edge. Panels are flat with a 1 px border. Only toasts and menus cast a shadow |
| Dark theme | Follows the OS only | A toggle in the header (light, dark, auto), stored per browser. `[data-theme]` already exists in `tokens.css`, but nothing sets it |
| Icons | lucide-react | Kept. No emoji (BK's rule) |
| Motion | Short colour changes and a ring on apply | Kept, plus a 150 ms panel slide. `prefers-reduced-motion` turns both off |

`test/web/contrast.test.ts` grows to cover non-text contrast too: cap borders against the stage at 3:1, kind fills against each other, and focus rings. Kind colours that fail the test fail CI.

## Words

- **Each validator rule has a sentence for people,** such as "F16 won't be on your keyboard any more". It's written beside the rule in `src/validation/`. The raw text stays in logs and the CLI's JSON (D-101).
- **Key numbers are 1-based wherever a person reads them,** including board dev and validator sentences. Positions stay 0-based in files and the CLI's JSON.
- **Timing options use plain names everywhere.** Cards, chips and the settings page use the names the tuner already uses ("Permissive hold").
  - Profiles are named for what they're for: "Home-row mods", "Thumb layers".
  - Imported profiles get a name generated from their options, which BK can change.
- **Keycodes show their label,** such as "A" or "Volume up". `KC_A` appears only in Advanced view.
- **Macros and tap dances show their summary,** such as "Copy, switch, paste", never `ST_MACRO_2` or TD0.
- **History means revisions.** The History panel lists revisions with their summaries, and lets BK undo to any of them or flash any of them. Chats live under Chat and are called "Conversations" (D-102).

## States say what to do next

| State | v0.10.1 | Change |
|---|---|---|
| No layouts | One Moonlander import command | An import screen with a card per supported board (Moonlander, Glove80, Corne). Each card says which file to export and has a drop zone for it, so no terminal is needed. The CLI command is shown underneath |
| First open | An instruction row and card on every visit | One tip on the board that can be dismissed: "Click a key to change it. Press ⌘K to ask keyloom." It shows until dismissed |
| No API key | Revealed only after the first send | The chat drawer says so before anything is typed, with the existing copyable command |
| Board behind | "Build and flash", with no sign the board is out of date | The sync state in the header ([17](17-keyboard-sync.md)) |
| Disabled actions | The reason is only in a `title` tooltip | The reason as visible helper text under the control |
| Loading | Spinners | Skeleton caps in the board's shape on first load. Spinners only inside buttons |

## Phones and narrow windows

- **At 900 px or less,** the side panel becomes a bottom sheet with three heights: peek, half and full. The board scales to the width.
- **At 600 px or less,** a split board shows one half at a time, with a Left and Right switcher and a swipe.
  - Caps stay at 44 px or more.
  - The key panel opens as a sheet covering less than half the screen, and scrolls the key into view above it.
- The header collapses to the layout menu and the sync state. Layer tabs scroll sideways.

## Keyboard use

Kept: one tab stop for the board, arrow keys moving by geometry, the ARIA tablist and spoken key names. Added:

| Key | Does |
|---|---|
| Enter | Open the focused key's panel, or apply the panel's change |
| Escape | Close the picker, then the panel |
| 1 to 9 | Switch to layer 1 to 9 |
| ⌘Z, ⇧⌘Z | Undo and redo revisions |
| ⌘K | Open the chat |
| ⌘C, ⌘V | Copy and paste keys |
| ⌥S | Swap mode on the open key (D-317: a plain S would type S into the tap slot, below) |
| ? | Show the shortcut list |

Typing a character while a key's panel is open and its picker is closed fills the tap slot. Oryx does this by accident; keyloom does it on purpose, because it makes "click the key, press A" a complete edit.

## How a rung proves it looks good

A visual change is done only when these have been checked against the released binary on BK's layouts (D-100):

1. Screenshots at 1440×900 and 390×844, in light and dark, of every screen the rung touched, saved under `docs/research/ui-audit/<rung>/`.
2. A review of those screenshots against this chapter's principles and `~/.dotfiles/.skills/design-review/references/uiux-design-principles.md`. Each failure is fixed or filed in `docs/issues/`.
3. The contrast test passing, including non-text contrast.
4. The rung's flow completed with the keyboard alone.

That's how BK's "check your work and make sure the UI you build looks good" becomes a gate instead of a hope.
