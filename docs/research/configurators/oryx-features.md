# Oryx feature inventory and inline-creation UX

Reviewed on 2026-10-15 at configure.zsa.io (sources: live editor on an anonymous scratch Moonlander layout opened via "Modify layout"; BK's public layout https://configure.zsa.io/moonlander/layouts/QxKPz in read-only view; https://www.zsa.io/oryx, /help, /smart, /keymapp, /flash, /training; the ZSA blog Oryx tag https://blog.zsa.io/tags/oryx/ and the posts cited per row). "Observed" means I did it in the browser. "From docs" means I only read it. I never signed in, saved, named, compiled or flashed anything.

## Oryx puts the whole behaviour of a key in one popover

Every key opens the same popover, and every action slot in it opens the same picker. The picker has a Single character tab and a Macro tab. There is no separate place to create a thing and then assign it. Tap, hold, double-tap and tap-then-hold are four slots on the key. A macro is built inside the picker for that slot. A combo is a wizard that ends in the same picker. The only objects that live outside a key are layers, combos, layout-wide settings and colours.

## Feature table

| Area | Feature | How it works (UI steps) | Source |
|---|---|---|---|
| Key panel | Per-key popover | Click a key. A popover shows "When tapped: X", links to add "held", "double-tapped", "tapped and then held", a SET COLOR link, a 10-char label field, a copy icon and a link icon. Observed. | oryx/06-key-A-panel.png |
| Key panel | Action slots | Each of four slots has its own picker. Filled slots show CLEAR next to them. Observed. | oryx/12-tapdance-inline.png |
| Key panel | Picker search | The picker opens with a search box focused. Typing "caps" lists Caps lock. Observed. | oryx/07-held-picker.png |
| Key panel | Picker categories | BROWSE CATEGORIES lists English, Digits, Spacing, Modifiers, Unshifted and Shifted punctuation, Color control, Layer switch, Combos, Fn keys, Firmware, Language, Media, Mouse control, Navigation, Numpad, Int, Other, System control, Buzzer keys, plus International when a locale is enabled in settings. Observed. | oryx/08-picker-categories.png |
| Key panel | Modifier add-ons | After picking a key the picker shows "Add modifiers" with Left/Right Shift, Ctrl, Option, Cmd. Ticking them makes a one-key shortcut (for example Ctrl+Shift+A). Observed. | oryx/12-tapdance-inline.png |
| Key panel | Picker description field | A 30-char "Description" field sits under the modifier buttons. Observed, purpose not tested. | oryx/12-tapdance-inline.png |
| Key panel | Dual-function (tap + hold) | Click key, click "held", pick the hold key. A key with only tap and hold generates a QMK dual-function key since May 2025. Observed. | oryx/06-key-A-panel.png; https://blog.zsa.io/tap-hold-update/ |
| Key panel | Tap dance | Add "double-tapped" or "tapped and then held" to any key. That makes it a Tap Dance key. Advanced view marks these keys with D or +. Observed. | oryx/12-tapdance-inline.png; https://blog.zsa.io/2101-introducing-tap-dance/ |
| Key panel | Home-row mod hint | After assigning a modifier on hold, a blue banner says "It looks like you're trying out home row mods. Chordal Hold can make a big difference." with a DISMISS link. Observed. | https://blog.zsa.io/chordal-hold/ |
| Key panel | Hold actions | Hold accepts modifiers, layer keys (LM, MO, TO per the picker's hold list) and ordinary keys. Observed. | oryx/08-picker-categories.png |
| Key panel | One-shot modifier (OSM) | In the Modifiers category, OSM sits beside Hyper and Meh. Hyper is Alt+Shift+Ctrl+Cmd and Meh is Alt+Shift+Ctrl. Observed. | oryx/08-picker-categories.png |
| Key panel | Layer keys, tap slot | The Layer switch category offers OSL (tap/hold), TG (tap), TO (tap) and TT (tap/hold). Observed. | oryx/08-picker-categories.png |
| Key panel | Layer keys, hold slot | The hold picker offers LM (layer + modifier), MO and TO. Observed. | oryx/08-picker-categories.png |
| Key panel | Custom key label | Type up to 10 chars in "Label this key". Docs say it can also be an icon, and a toggle hides all labels. Typed label observed as a field only. | https://blog.zsa.io/2008-oryx-changes/ |
| Key panel | Per-key colour | SET COLOR in the popover. Some keys add a second control, "make Caps lock glow when it's on". Observed. | oryx/12-tapdance-inline.png |
| Key panel | Copy and paste key | The clipboard icon in the popover enters paste mode. Click target keys to paste one copied key onto many. From docs. | https://blog.zsa.io/copy-keys/ |
| Key panel | Link to key | The link icon copies a URL to that key at its layer and revision. From docs. | https://blog.zsa.io/copy-keys/ |
| Key panel | Macro (inline) | Picker, Macro tab. Steps are a key plus optional modifiers, each with a "Then wait: 100ms" link. Options: "Hold Alt pressed (send Unicode)" and "End macro with Enter". Up to 24 steps since April 2025. Observed (steps, wait link, options); 24-step cap from docs. | oryx/25-macro-3.png; https://blog.zsa.io/longer-oryx-macros/ |
| Key panel | Macro limits | A macro key takes tap only. The popover says "This key assignment is only for tapping, and does not support hold actions." Tap Dance cannot run macros. Observed; tap dance note from docs. | oryx/25-macro-3.png; https://blog.zsa.io/2101-introducing-tap-dance/ |
| Key panel | Macro warning | A blue banner says "Do not store any sensitive information in macros." Layouts are public by default. Observed. | oryx/25-macro-3.png |
| Key panel | Missing macro characters | Shifted and accented characters are hidden from macro search. Use the base key plus the Shift modifier. A "Missing Macro Characters" link sits in the picker. Observed link; reason from docs. | https://blog.zsa.io/missing-macro-characters/ |
| Key panel | Smart Layer keys | The Other category has "Toggle Smart Layer" and "Trigger Smart Layer". Observed key names; behaviour from docs. | https://www.zsa.io/smart |
| Key panel | Other special keys | Other has Caps WORD, Copy, Cut, Paste, Undo, Find, Pause (macOS variants separate), "Disable this key" and None. Also Mouse Jiggler and Double click under Mouse control. Observed. | oryx/08-picker-categories.png |
| Key panel | Firmware keys | EEPROM wipe, NKRO toggle, Reset, Tapping term up, down and print. Observed. | oryx/08-picker-categories.png |
| Key panel | Lighting keys | Animation speed, brightness, hue, saturation, set colour, stop and switch animation, toggle layer colours, toggle lighting, indicator toggle. Observed. | oryx/08-picker-categories.png |
| Key panel | Audio keys | Audio on, off, toggle and music mode keys. Observed. | oryx/08-picker-categories.png |
| Key panel | Key assignment by typing | While the popover was open and the picker closed, pressing the physical Escape key assigned Esc as the tap action of the selected key. Seen once, by accident, not repeated for other keys. Observed once. | no screenshot |
| Key panel | Unicode and international | Enable locales in Advanced settings, International. Settings lists about 14 locales. A Unicode macro with "Hold Alt pressed (send Unicode)" handles OS-specific symbol entry. Observed list; macro recipes from docs. | https://blog.zsa.io/2008-oryx-changes/; https://blog.zsa.io/layout-buffet-unicode/ |
| Key panel | Advanced view | Toggle at bottom left. Keys show the QMK name (MO 1, TG 1), and D or + marks on dual-function and tap dance keys. Observed. | no screenshot |
| Combos | Combo wizard | Combos link, "Add a combo", type a name (10 chars), NEXT, click 2 to 6 keys on the board, NEXT, pick a key or macro in the picker, CLOSE. Observed. | oryx/26-combos.png; oryx/28-combo-action.png |
| Combos | Combo list | A sidebar lists combos with EDIT and CLEAR. Hovering one highlights its keys. Observed. | oryx/26-combos.png |
| Combos | Combo limits | Min 2 keys, max 6 observed in the wizard. Combos are layout-wide, not per layer. Tap Dance keys can't be in combos. Combo term is in settings. Min and max observed; scope and tap dance rule from docs. | https://blog.zsa.io/2212-combos/ |
| Combos | Combo keycodes | Picker, Combos category: Combo off, on, toggle. Observed. | oryx/08-picker-categories.png |
| Layers | Layer tabs | Tabs along the top, each "Layer N". Observed. | oryx/16-layer-menu.png |
| Layers | Layer menu | Caret on a tab opens Name layer, Delete layer, Move left, Move right, Move to end. Observed. | oryx/16-layer-menu.png |
| Layers | Add layer | The "+" at the tab bar's right end. Clicking it in the anonymous scratch layout did not add a tab in my tests. Not confirmed; may need an account or a lower layer cap. | none |
| Layers | Layer templates | "+" then "browse templates", searchable, per OS. Community-submitted. From docs. | https://blog.zsa.io/2210-layer-templates/ |
| Layers | Restore deleted layers | "+" then "Restore Layers". From docs (blog post says the per-key history feature is disabled; restore wording not verified). | https://blog.zsa.io/history/ |
| Layers | Swap keys | "Swap keys" link, prompt "Click the key you would like to swap", then "Click where you'd like it to go. You can also put it in another layer". Observed: F1 and F2 exchanged places. | oryx/17-swap-keys.png |
| Layers | Layer limit | Up to 32 layers. From docs. | https://www.zsa.io/oryx |
| Layers | Layer Lock | Assign Lock Layer on tap on the destination layer. From docs. | https://blog.zsa.io/layer-lock/ |
| Lighting | Per-layer colours | "Click here to set colors for this layer" opens a picker with tabs Individual keys and Layer. Individual keys: pick a colour (swatches, hue bar, hex field), then click keys. Layer: one colour for the whole layer, with CLEAR. Observed. | oryx/30-layer-colors.png |
| Lighting | Animations | Advanced settings, RGB: hue step, brightness step, disable after inactivity, about 50 toggleable LED animations ("Disable any you don't use to make firmware smaller"). Observed. | oryx/15-settings-tapping.png |
| Settings | Settings page | Gear at the tab bar's right end. Title "Advanced Configuration Settings (Here be dragons)", a filter box, and a left nav. Observed. | oryx/15-settings-tapping.png |
| Settings | Sections | Auto Shift, Audio, Combo, Debounce, International, Misc, Mouse keys, RGB, Stenography, Tapping, Tapping (dual-functions), Oneshot, Holding. Observed. | oryx/15-settings-tapping.png |
| Settings | Tapping | Tapping term (ms), "Per-key tapping term" toggle (default OFF) that adds a per-key field in the popover, Tap Flow, "Prefer tap action in Tap-Hold tap dances". Observed; per-key field not enabled. | oryx/15-settings-tapping.png; https://blog.zsa.io/per-key-dynamic-tapping-terms/ |
| Settings | Tapping (dual-functions) | Retro tapping, Permissive hold, Hold On Other Key Press, Tapping force hold, "Enable Legacy Two-Function Tap Dances". Observed. | oryx/15-settings-tapping.png |
| Settings | Holding | Unblock TT/MO/LM in destination layer, Enable chordal hold, Exclude thumb keys from Chordal Hold. Observed. | https://blog.zsa.io/chordal-hold/ |
| Settings | Oneshot | One-shot tap toggle and one-shot timeout. Observed. | oryx/15-settings-tapping.png |
| Settings | Auto Shift | Master toggle plus timeout (50 to 350 ms, default 175), modifiers, special keys, numeric keys, letter keys, Tab. Observed. | oryx/15-settings-tapping.png |
| Settings | Misc | Caps lock status, USB startup check, wake-up delay, layer lock idle timeout, Oryx connection, N-Key rollover, USB polling rate, dynamic macros, space cadet. Observed. | oryx/15-settings-tapping.png |
| Settings | Other | Debounce delay (ms), combo term, mouse key speeds and delays, audio click and silent mode, stenography (GeminiPR). Observed. | oryx/15-settings-tapping.png |
| Settings | Every setting has a prose explanation | Each setting shows its default, a range slider where numeric, and a paragraph on when to change it. Observed. | oryx/15-settings-tapping.png |
| Layout | Anonymous editing | Read-only layouts show "Modify layout" or https://layout.new. It creates a new layout (here /layouts/xB4v5) editable without an account. The banner says Oryx "won't keep track of your layout for you". Observed. | oryx/16-layer-menu.png |
| Layout | Naming gates compile | The compile button reads "Name your layout above to compile it" and is disabled until the title is set. Not clicked. Observed. | oryx/16-layer-menu.png |
| Layout | Read-only toolbar | Play layout tour, Legend (key types), Print layout, Copy embed code, Advanced view, Combos, "Save to my keyboard", Download firmware, Download Source, Download flashing tool, Modify layout. Observed, not clicked. | oryx/33-more-layouts.png |
| Layout | Layout tours | "Play layout tour" walks through chosen keys with Markdown notes. Tour authorship is invite or application only. From docs. | https://blog.zsa.io/2004-layout-tours/ |
| Layout | Embeds | "Copy embed code" gives an interactive embed on desktop and a static image on phones. From docs. | https://blog.zsa.io/2005-layout-embeds/ |
| Layout | Key legend | "Legend: key types" explains key colours (blue dual-function, green modifier, orange custom, purple macro and others). Observed colours; legend panel not opened. | oryx/17-swap-keys.png |
| Sharing | Search and browse | More Layouts, per keyboard, with search by tag, "Include anonymous layouts" and "With tour" filters, paged results (190 with tour). Each card has title, author, date, tags and "Play tour". Observed. | oryx/33-more-layouts.png |
| Sharing | Clone | Cloning a layout as a starting point is advertised on /oryx. "Modify layout" is the observed path. Observed. | https://www.zsa.io/oryx |
| Sharing | Layout URL | URLs are /moonlander/layouts/<id>/<revision or latest>/<layer index>. Observed. | oryx/16-layer-menu.png |
| Revisions | History and revisions | Layouts keep revisions. Per-key history was disabled in October 2023. Needs an account to see. Not observed. From docs. | https://blog.zsa.io/history/ |
| Build | Compile and download | Name the layout, compile, then download firmware or source. Not observed (would require saving). From docs. | https://www.zsa.io/flash |
| Build | Flashing | Three routes: Chrome (WebHID/WebUSB from Oryx, no Firefox or Safari), Keymapp (4 steps: select file, press reset, flash, complete) and Zapp CLI. Windows needs Keymapp's driver, Linux needs a udev rule. From docs. | https://www.zsa.io/flash; https://www.zsa.io/keymapp |
| Build | Keymapp | Live layout display on screen, always-on-top overlay, heatmap, Smart Layers, shortcuts to flashing and training. From docs. | https://www.zsa.io/keymapp |
| Build | Smart Layers | Keymapp switches to a chosen layer when a linked app or game is focused. Windows and macOS only. From docs. | https://www.zsa.io/smart |
| Training | Live Training | "Train" opens typ.ing/oryx, a keyboard-only typing trainer. It shows your keymap and layer switches live over WebHID. Needs the layout stored in Oryx. Observed landing page; connection from docs. | https://typ.ing/oryx; https://www.zsa.io/training |
| Mobile | Phone view | The read-only layout is viewable on a 390 px wide screen with horizontal scroll. I saw no editing UI. Observed. | none |
| Onboarding | Sign-in nag | A blue bar says "You are not signed in. You can use Oryx, but it won't keep track of your layout for you." Observed. | oryx/16-layer-menu.png |
| Onboarding | Default layout and tour | /moonlander/layouts/default/latest/0 is the starting point, with a "Play layout tour" link. Observed. | oryx/33-more-layouts.png |
| Keyboard shortcuts | Editor shortcuts | Esc exits swap and combo modes. Layout tours use left/right arrows and Esc. Editor-wide shortcuts beyond that were not seen. Esc observed; tour keys from docs. | https://blog.zsa.io/2004-layout-tours/ |
| Account | Account features | 2FA, email change, account page. Not observed (no sign-in). From docs. | https://blog.zsa.io/2008-oryx-changes/ |

## Click counts

I counted clicks from a keyboard with the layout already open. Typing is not counted as a click. Each count assumes the key starts empty unless noted.

| Task | Clicks | Steps |
|---|---|---|
| (a) Mod-tap: tap A, hold Ctrl | 5 on an empty key, 3 if the key already sends A | Click key, "tapped", A, "held", Left Ctrl. On an existing A key: click key, "held", Left Ctrl. Observed. |
| (b) 3-key macro (A, B, C) | 12 | Click key, "tapped", Macro tab, "Add the first step", A, CLOSE, "Add another step", B, CLOSE, "Add another step", C, CLOSE. Each step needs a CLOSE to return to the list. The last CLOSE is what commits the summary ("sends these keys in sequence: A, B, C"). Observed. |
| (c) Tap dance: tap Esc, double-tap Caps Lock | 5 on an empty key, 3 if Esc is already on the key | Click key, "tapped", Esc, "double-tapped", Caps lock. Observed with Caps lock added as the double-tap on a key that already had tap and hold. |
| (d) Combo of two keys | 8 plus typing a name | Combos, "Add a combo", name field (typed), NEXT, key 1, key 2, NEXT, pick output, CLOSE. I did not test whether the name can be blank. Observed. |
| (e) Move a layer key | 3 for swapping, or 2 for moving a layer tab | Swap keys, source key, destination key. Switching to another layer tab between source and destination adds one click. To move a layer tab: caret on the tab, "Move right". Observed. |

## Limitations

- A macro key cannot have a hold action, and tap dance cannot run macros (observed warning; docs).
- Combos are layout-wide, capped at six keys, and exclude tap dance keys (docs).
- Layer templates do not carry combos (docs).
- There is no drag and drop. Moving a key is a mode ("Swap keys"), not a drag.
- A macro step needs a CLOSE per step, so a 3-key macro costs 12 clicks.
- Shifted and accented characters are hidden from macro search (docs).
- Enabling Per-key tapping term, Tap Flow and similar tuning means leaving the key panel for the settings page (observed).
- There was no undo button on the scratch layout. Per-key history is disabled (docs).
- Layout tours are invite or application only (docs).
- The editor is not usable on a phone (observed view only).

## What keyloom should take

- Make the key popover the single place to build behaviour: one popover per key with tap, hold, double-tap and tap-then-hold slots.
- Open one searchable picker for every slot, with a categories view, and reuse it for combos and macros.
- Put macro building in the picker as a second tab ("Single character" and "Macro"), not in a separate macro manager.
- Let a macro step carry modifiers and a delay, as Oryx does with "Then wait: 100ms".
- Cut the macro cost: add a step on pick without a CLOSE per step, so a 3-key macro takes about 8 clicks, not 12.
- Show a plain-language summary line in the popover for each slot, such as "sends these keys in sequence: A, B, C".
- Warn in the popover when a slot choice rules out another (macro means no hold).
- Add a "Swap keys" mode with two clicks, supporting another layer, and also support drag and drop on top.
- Add copy and paste of a key, and a link that points to one key at one revision.
- Make combos a three-step wizard (name, pick keys, pick output) with a hover-to-highlight list, but make the name optional.
- Show an inline hint when someone assigns a modifier on hold (home-row-mod tip linking to chordal-hold setting).
- Keep layout-wide timing in a settings page with filter, defaults and one paragraph of prose per setting; show per-key overrides in the key popover.
- Let anyone try keyloom with no account on a scratch layout, with a visible "this won't be saved" bar.
- Add per-layer and per-key colours as a panel with Individual keys and Layer tabs.
- Show tap-dance and dual-function marks on keycaps in an "advanced view" toggle.
- Support layer templates and a layout search with tag and tour filters only if the layout library exists; skip it for the first version.

## What I could not observe

- Saving, naming, compiling, revision history, tags, privacy toggles, forking of a saved layout, layer templates, tours as an author, and 2FA. All need an account or a save, which the brief ruled out. They are marked "from docs".
- Adding a layer. The "+" on the tab bar did nothing in the anonymous layout in two attempts.
- Duplicating a layer. The layer menu has no such item.
- Per-key tapping term field. The setting is off by default and I did not turn it on.
- Flashing. I have no keyboard connected, and Keymapp and Chrome WebHID flows are described only on zsa.io.
- Mobile editing. I saw only the read-only view at 390 px.
- Whether the combo name can be left blank, and whether the physical-key assignment is a real feature.
- Direct fetches of zsa.io through Exa failed (invalid API key), so docs were read with WebFetch and WebSearch summaries. Treat the "from docs" rows as summaries, not verbatim quotes.
