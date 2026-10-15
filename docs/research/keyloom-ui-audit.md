# keyloom web editor UI and UX audit

Audited on 2026-10-15 at origin/main 65cc12a (v0.10.1).

The binary was `release-0.10.1/bin/keyloom`, serving on port 4499 with a fake `PATH` (fake `zapp`) and no `ANTHROPIC_API_KEY`. The data was a read-only SQLite backup of BK's live `serve-data`, which holds the Moonlander layout "synchronized" and the Glove80 layout "Glove80 (42-key-map)". I added a Corne imported from `test/fixtures/zmk/corne/corne.keymap`. Screenshots are 1440x900 unless named otherwise, taken with `agent-browser`. Contrast ratios were computed from the tokens in `src/web/tokens.css` and checked against computed styles in the browser. All file:line references are at 65cc12a.

Nothing was built or flashed. The build and flash flow was followed up to the dialog, and the rest was read from `src/web/release/ReleaseDialog.tsx`.

## Screen inventory

| Screen | What it shows | Screenshot |
|---|---|---|
| No layouts | The only "home". An import command for Moonlander and a Check again button | [00](ui-audit/00-home-no-layouts.png) |
| Editor, Moonlander | Header, layer tabs, revision bar, selection bar, board, legend, idle inspector, chat | [01](ui-audit/01-moonlander-default-light.png) |
| Key selected | Inspector with tap, hold, profile, option chips and combos | [02](ui-audit/02-key-selected-inspector.png) |
| Hold-tap tuner | Timing profile fields and a scope choice, under the inspector | [03](ui-audit/03-holdtap-tuner-fullpage.png) |
| Binding editor | Kind list, key picker, modifier toggles, hold settings, timing profile | [04](ui-audit/04-binding-editor-holdtap.png), [05](ui-audit/05-editor-open-board-scrolled-away.png) |
| Draft checked | A mod-tap draft with "After this change" and Apply enabled | [06](ui-audit/06-modtap-draft-validated.png), [07](ui-audit/07-validation-ok-and-reason.png) |
| Key picker search | Typed search narrowed to one result | [15](ui-audit/15-key-picker-search.png) |
| Validation error | The validator refusing to drop F16 | [17](ui-audit/17-validation-error-dropfunction.png) |
| Applied | Success notice, the revision bar with Undo, Repeat last change | [08](ui-audit/08-applied-notice-undo.png) |
| Undone | Info notice and the Redo button | [19](ui-audit/19-undo-then-redo.png) |
| Another layer | Layer 2, mostly transparent keys | [09](ui-audit/09-layer-2.png) |
| Dark theme | Layer 2 under `prefers-color-scheme: dark` | [10](ui-audit/10-layer-2-dark.png) |
| Glove80 | 80 keys with fanned thumbs | [11](ui-audit/11-glove80-default.png) |
| Corne | 42 keys, 2 layers | [12](ui-audit/12-corne-default.png) |
| Chat without a key | The missing-key panel after a send | [13](ui-audit/13-chat-no-api-key.png) |
| Decisions | Empty, then one decision hovered with its key lit | [14](ui-audit/14-decisions-view.png), [16](ui-audit/16-decisions-populated.png) |
| History | The list of past chat conversations | [18](ui-audit/18-history-is-conversations.png) |
| Build and flash | Two-step dialog before any build | [20](ui-audit/20-build-and-flash-dialog.png) |
| Phone, 390px | Header, board with sideways scroll, sticky inspector, chat | [21](ui-audit/21-mobile-390-top.png), [23](ui-audit/23-mobile-390-board-under-inspector.png), [22](ui-audit/22-mobile-390-chat-and-editor-bottom.png) |
| Keyboard focus | Arrow-key focus on the board | [24](ui-audit/24-keyboard-focus-arrows.png) |
| Board dev | `serve --board-dev moergo/glove80`: position numbers and board.json coverage | [25](ui-audit/25-board-dev-glove80.png) |

There is no settings screen and no layout list. A layout is picked from a native `<select>` in the header (`src/web/App.tsx:92-106`). There is one theme per OS setting and no in-app toggle; `[data-theme]` exists in `tokens.css` but nothing in `src/web` sets it.

## Editing capability

### The editor cannot replace a key whose function exists nowhere else (high)

Changing F16 to F17 on the Moonlander was refused with: `key:F16 is reachable before this change and not after (was at layer "layer-0", position 6); keep it somewhere or add a dropFunction op`. Apply stays disabled ([17](ui-audit/17-validation-error-dropfunction.png)). The web app has no way to add a `dropFunction` op: `grep dropFunction src/web` finds nothing. So the editor can only change a key when the old function survives elsewhere. Most keys on a real layout are unique, so most plain edits dead-end here.

The message is the validator's internal text, shown as-is (`src/validation/rules.ts:230`, rendered by `src/web/editor/Validation.tsx:35`). It names a layer ID, a 0-based position and an op type, none of which the editor shows.

A blueprint needs a "drop F16" confirmation in the editor, and a plain-words message such as "F16 won't be on your keyboard any more. Drop it, or put it on another key first."

### Macros, combos, tap dances and layers can't be created in the web app (high)

The binding editor's kinds are Key, Modifier, Hold-tap, Layer, Macro, Transparent and None (`src/web/editor/BindingEditor.tsx:47-55`). Macro only picks an existing macro, and says "Macros are created from the CLI for now" when there are none (`src/web/editor/KindForms.tsx:179-181`). There is no combo editor anywhere in `src/web`. Tap dance is not a binding kind in the model (`src/layout/schema.ts:30-52`). Imported tap dances show as opaque native keys such as TD0, TD1 and DF0 ([01](ui-audit/01-moonlander-default-light.png)). The layer tabs only switch layers; they have no add, rename, duplicate, reorder or remove (`src/web/keyboard/LayerTabs.tsx:36-63`), though the blueprint lists all five (`docs/blueprint/09-web-editor.md`, Interactions table). The same table promises drag-select and Quick assign; neither exists.

The change model already has `upsertMacro`, `upsertCombo`, `addLayer` and `renameLayer` (`src/layout/change.ts:21-30`), so this is missing UI, not missing model.

### History shows conversations, and undo goes back one step (medium)

The History button in the chat header lists past chat conversations ([18](ui-audit/18-history-is-conversations.png), `src/web/chat/ChatPanel.tsx:139-142`). There is no list of layout revisions. The revision bar offers one Undo; after it the button becomes Redo, so the change before can't be undone from the UI ([19](ui-audit/19-undo-then-redo.png), `src/web/history/RevisionBar.tsx:23-47`). The blueprint's header History with "flash this revision" doesn't exist. "History" meaning chats next to a revision bar with a history icon will confuse.

### Layer names from Oryx can't be fixed (medium)

The Moonlander's layers are "Layer 0" to "Layer 5" ([01](ui-audit/01-moonlander-default-light.png)), and the Glove80's include `one_shot` and `factory_test_layer` ([11](ui-audit/11-glove80-default.png)). Layer keys print these names as legends, so "navigate go to" and "one_shot one-shot" end up on caps. With no rename in the UI, these stay.

## Layout and hierarchy

### Opening the editor scrolls the board away (high)

At 1440x900, double-clicking a key scrolls the page 552px so the editor fits (`src/web/Viewer.tsx:132-137`). The board then sits above the fold, so the draft key, which the board draws with a dashed ring and dot, is out of sight ([05](ui-audit/05-editor-open-board-scrolled-away.png), [06](ui-audit/06-modtap-draft-validated.png)). The editor is stacked under the board and legend (`src/web/Viewer.tsx:346-367`). The blueprint's reason for the board is to see a change before it happens, and the edit flow breaks that on a laptop screen. The validation result also sits below the form and needed another scroll ([07](ui-audit/07-validation-ok-and-reason.png)).

A blueprint should put the editor beside the board, or in a panel that replaces the chat column while editing.

### The header spends its space on metadata (medium)

The header carries the import date and a revision hash ("Revision VFK7WP") at equal weight with the board name, then the layout picker and Build and flash ([01](ui-audit/01-moonlander-default-light.png), `src/web/shell/Header.tsx:28-49`). The layout name is a 16px `h1` competing with three grey lines. The layout switcher is an unstyled native `<select>` with no way to see boards or create a layout. On a phone the header takes about 220px before the board starts ([21](ui-audit/21-mobile-390-top.png)).

### Applying a change pushes the board down (low)

Each apply or undo inserts a full-width notice above the stage. The layer tabs move from y=97 to y=159 ([01](ui-audit/01-moonlander-default-light.png) against [08](ui-audit/08-applied-notice-undo.png)). The notice stays until dismissed (`src/web/Viewer.tsx:294`). The revision bar already says "Latest: Edited ...", so the notice repeats it and shifts the target the person is looking at.

### Persistent instruction rows take vertical space (low)

"Click keys to select them. The selection goes with your next chat message." holds a full row under the tabs ([01](ui-audit/01-moonlander-default-light.png), `src/web/keyboard/SelectionBar.tsx:19`). The idle inspector is a 130px card of instructions. The legend and glyph strip under the board take another 90px on every layer. At 1440x900 the hold-tap tuner starts below the fold once a hold-tap is selected ([03](ui-audit/03-holdtap-tuner-fullpage.png)).

## Keycaps and legends

### Glove80 legends fall to 8-9.5px (medium)

On the Glove80 at 1440 wide, 17 legends render below 10.5px, measured in the browser: "navigate" 8.6px, "one-shot" 8.1px, "Enter/OSL2" 8.5px, "magic/L5" 8.5px, and the hold glyphs "r⌘", "rHyp" 9.5px ([11](ui-audit/11-glove80-default.png)). The floor is `TAP_SIZE.min` 0.17u and `HOLD_SIZE.min` 0.15u (`src/web/keyboard/fit.ts:10-11`). The fitter shrinks long layer names instead of abbreviating them; a layer key should show a short layer label or icon and leave the name to the inspector.

### Kind colours barely differ, worst in dark mode (medium)

The fill contrast between a plain key and a modifier is 1.31:1 in light and 1.17:1 in dark. A dark modifier against its tray is 1.15:1 (`src/web/tokens.css:29-32, 68-71`). In [10](ui-audit/10-layer-2-dark.png) the ⌥ and ⌘ modifier caps read as darker plain keys. Kind is also carried by the hold line, so this isn't colour-only, but the colour code the legend teaches doesn't hold up. "None" keys have a dotted border at 1.53:1 light and 1.32:1 dark, under the 3:1 non-text minimum, so empty positions on the Glove80 almost vanish ([11](ui-audit/11-glove80-default.png)).

### The chat-selection tint hides the key's kind (medium)

A selected key is tinted 30% accent over its fill (`src/web/keyboard/keyboard.css:134-137`). A selected hold-tap loses its amber and looks like a selected plain key ([08](ui-audit/08-applied-notice-undo.png), key A). The selection tick and the "remembered" square both use `::before` (`keyboard.css:139` and `keyboard.css:187`), and both use `--cap-ring`. A remembered key that is also selected shows only one mark: in [16](ui-audit/16-decisions-populated.png) key 1 has the remembered ring and square but no tick.

### Transparent layers look like copies of the base (low)

Transparent keys print the base layer's legend in muted ink with a dashed edge (`keyboard.css:69-74`). On Layer 2, which is mostly transparent, the board reads almost the same as Layer 0 at a glance ([09](ui-audit/09-layer-2.png)). The blueprint asks for the underlying binding "faded"; muted ink at 6.6:1 isn't faded enough to make the layer's own keys stand out.

### Native keys are opaque (low)

TD0, TD1 and DF0 on the Moonlander and "Enter/OSL2" on the Glove80 show their firmware label and nothing else (`src/layout/legend.ts:78-79`). The person can't tell what a tap dance does without the original source.

### Combo marks are small (low)

The combo dot is 0.11u (`src/web/keyboard/Cap.tsx:48`), about 6px on a 52px cap. Partners only light up when a key is inspected. There is no way to see all combos at once.

## Words and labels

### Raw firmware identifiers leak into the UI (medium)

Each timing profile card's hint lists its option names and values (`src/web/editor/KindForms.tsx:126`). The Moonlander's three profiles all read "CHORDAL_HOLD true, PERMISSIVE_HOLD true", so the cards can't be told apart ([04](ui-audit/04-binding-editor-holdtap.png)). The inspector shows `CHORDAL_HOLD: true` chips, while the tuner below it calls the same option "Permissive hold" in plain words ([03](ui-audit/03-holdtap-tuner-fullpage.png)). Every key picker cell prints its QMK code (`KC_A`) under the label. Combos read "Runs macro ST_MACRO_2" ([23](ui-audit/23-mobile-390-board-under-inspector.png)). Decisions are titled with the change summary "Layer 0, key 1: F17" under a "Choice" label ([16](ui-audit/16-decisions-populated.png)).

### Key numbers are 1-based in the editor and 0-based in board dev (low)

The editor says "Edit key 31" (`src/web/editor/BindingEditor.tsx:188`, `src/web/inspector/Inspector.tsx:50`). Board dev says "Position numbers start at 0" (`src/web/boarddev/BoardDevApp.tsx:89`). The validator message uses 0-based "position 6" for the key the editor calls key 7 ([17](ui-audit/17-validation-error-dropfunction.png)).

### The empty state only knows Moonlander (medium)

"No layouts yet" offers only `keyloom import --board zsa/moonlander <oryx.zip>` (`src/web/shell/States.tsx:4`, [00](ui-audit/00-home-no-layouts.png)). Glove80 and Corne are supported boards; a Glove80 owner gets the wrong command.

### The legend is the same for every layout (low)

The legend lists Macro, Native and Combo on the Corne, which has none of them ([12](ui-audit/12-corne-default.png), `src/web/inspector/Legend.tsx:13-29`).

## States

### Chat says it needs a key only after the first send (medium)

The empty chat invites a message with three example prompts. The missing-key panel appears only after sending ([13](ui-audit/13-chat-no-api-key.png)). The chat panel shows `EmptyChat` whenever the transcript is empty (`src/web/chat/ChatPanel.tsx:205-211`), and the server reports the missing key only as a chat error (`src/cli/chat-backend.ts:15`). The panel itself is good: it explains why a restart is needed and gives a copyable command.

### Build and flash doesn't say there are unbuilt changes (medium)

The header button reads "Build and flash" both before any build and after a new change makes the last build stale (`src/web/release/status.ts:20`). There is no sign on the board or header that the keyboard is behind keyloom. The dialog's subtitle uses the revision summary, which after an undo reads "From the latest layout: Undo: Layer 0, key 1: F17" ([20](ui-audit/20-build-and-flash-dialog.png)).

### Disabled reasons live in tooltips (low)

Undo while a draft is open, and Repeat last change while editing, explain themselves only through `title` (`src/web/history/RevisionBar.tsx:40`, `src/web/keyboard/SelectionBar.tsx:24`). Touch users and most screen reader setups never see them.

### One click does two jobs (medium)

A click on a key both inspects it and toggles it in the chat selection (`src/web/keyboard/Keyboard.tsx:176-180`). Someone exploring keys to read them builds up a chat selection they didn't mean to make. Double-click to edit goes through the same handler. In my run, keys I opened for editing were left in the chat selection ("2 keys selected on Layer 0" in [16](ui-audit/16-decisions-populated.png)); `agent-browser`'s double-click sends one click, so a real double-click toggles twice and may net out, but the state still flickers.

## Responsiveness

### On a phone the board needs sideways scrolling and the inspector covers it (medium)

At 390px the keyboard well is 364px wide and its content is 842px, so the right half is off-screen behind a "Scroll sideways" hint ([21](ui-audit/21-mobile-390-top.png)). The selected-key inspector is sticky at the bottom, up to 45vh, and covers the thumb cluster ([23](ui-audit/23-mobile-390-board-under-inspector.png), `src/web/inspector/inspector.css:239-249`). Caps are 41.9px, under the 44px touch minimum. The page is 1941px tall, with chat at the bottom ([22](ui-audit/22-mobile-390-chat-and-editor-bottom.png)). Showing one half at a time, with a half switcher, would fit a phone.

## Visual system

### The type scale has three sizes within 2px (low)

`--text-xs` 12px, `--text-sm` 13px and `--text-md` 14px (`src/web/tokens.css:136-138`) are closer than the 25% step the principles ask for, so secondary text sits at three nearly equal sizes. Headings top out at 20px. The page relies on weight and grey for hierarchy, which is why the header and cards feel flat.

### Small off-scale nudges (low)

Spacing and colour are tokenised, and the token file says nothing uses a value outside them. A few 2px, 3px, 6px and 28px values remain in `chat/compare.css:51,133,138,146`, `editor/editor.css:196,371` and `decisions/decisions.css:261`. None is visible as a problem.

## Click counts

Counted as distinct pointer actions in the running app, with typing counted once per field. Rows marked "code" were counted from source because the step would build, flash or call the model.

| Task | Steps in keyloom's web app | Where the person must go first |
|---|---|---|
| (a) Make A a mod-tap: hold Ctrl, tap A | 4: double-click A, choose Hold-tap, click Ctrl, Apply. The tap key and timing profile carry over | Nowhere. Works when the new binding keeps A reachable, as here |
| (b) A 3-key macro | Not possible in the editor. Macro only picks an existing macro (`KindForms.tsx:178-199`) | CLI: write `upsertMacro` and `setBinding` ops as JSON, then `keyloom change propose --ops` and `change apply`. Or chat, which needs an API key with credit (untested here) |
| (c) Tap dance Esc/Caps | Not possible anywhere in keyloom. Tap dance isn't a binding kind (`schema.ts:30-52`); imported ones survive only as native passthrough | Oryx or hand-written firmware source |
| (d) Combo of two keys | Not possible in the editor. Combos are read-only in the inspector | CLI `upsertCombo` op as JSON, or chat |
| (e) Change a key and get it onto the keyboard | 4 to edit (double-click, type in picker, Enter, Apply), then 5 to flash: Build and flash, Build firmware, wait, Flash to keyboard, Start flashing (code: `ReleaseDialog.tsx:76-95, 152-201`). Plus Rev A/Rev B on a Moonlander whose revision isn't known, and a reset press if keyloom can't reboot the board. About 9 actions | Nowhere, if the old function survives elsewhere. Otherwise blocked by the dropFunction finding |

Only (a) and (e) can be finished in the web app. (b) to (d) send the person to a terminal or to the chat.

## Strengths to keep

- Board geometry is faithful. Moonlander and Glove80 thumb clusters rotate correctly, and steep Glove80 thumbs turn their legends upright ([11](ui-audit/11-glove80-default.png)).
- Keyboard access is real. Five Tab presses reach the board, it is one tab stop, and arrow keys move by geometry ([24](ui-audit/24-keyboard-focus-arrows.png), `Keyboard.tsx:113-132`). Layer tabs follow the ARIA tablist pattern. Every key has a spoken name with finger, combo and draft state.
- Text contrast passes everywhere I measured: muted text 6.6:1 on panels and 8.0:1 on cards, cap inks 8.6:1 to 9.0:1. A contrast test guards it (`test/web/contrast.test.ts`).
- The edit flow is honest. "Now → After this change", "Nothing is saved until you apply", a validation check before Apply, and a draft drawn on the board ([06](ui-audit/06-modtap-draft-validated.png)).
- Switching kind keeps parameters: Key A to Hold-tap kept A as the tap.
- The key picker is fast and keyboard-first: "f17" then Enter ([15](ui-audit/15-key-picker-search.png)).
- Undo and redo say what they will do, and Apply never builds or flashes.
- Flashing asks for confirmation and tells the person to have another keyboard to hand ([20](ui-audit/20-build-and-flash-dialog.png)).
- States are written in plain words with one next action each: no layouts, no key, decisions empty.
- Icons are lucide throughout, with no emoji in the UI. Motion is limited to short colour changes, a one-off ring on apply and spinners, and `prefers-reduced-motion` turns them off.
- The hold-tap tuner explains each option in a sentence and lets the person choose this key or every key on the profile ([03](ui-audit/03-holdtap-tuner-fullpage.png)).
- Decisions light up their keys on hover ([16](ui-audit/16-decisions-populated.png)).
