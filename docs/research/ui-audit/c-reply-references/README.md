# A reply takes you to what it names

Checked source: `d82fe94a2b5144854b27733f20a70f4bca2a73e2`, tree `cd68f1cf1d858a1a64ad4b6403141a2e0bc02017`, on `6454cc4` (v0.64.0 plus a docs-only commit) — the last commit of this stage that changes code: the marker contract, its tests and the link styling review asked for. The documentation commit that follows changes no code, so the code under test is byte-identical to that tree. The app ran from `C-shots.ts`, kept beside this run's ledger rather than in the repository: the real server routes and SQLite in a scratch data directory, with a scripted Anthropic client behind the real SDK, and routes that refuse builds and flashes. No model was called, no network was used, no keyboard was touched. The config is the checked-in Oryx Moonlander fixture (`test/fixtures/oryx/synchronized`); the second config the reply names is a plain copy of it with a long name.

The reply was written by that scripted model in a real chat turn, so the conversation, its proposal and its stored text are what `keyloom chat` and the page would see:

> I saved it as Glove80 (42-key-map) moved onto the Moonlander, second attempt on this board. Option sits on S hold ⌥ in the base layer, so on Layer 2 I made that key a plain Option: Plain Option on layer 2 is waiting on the board. Two on one line: Layer 2 and S hold ⌥.

Underlined here is a reference on screen: the four markers are `{config:lay_…}`, `{key:layer-0:30}`, `{layer:layer-2}` and `{proposal:cs_…}`, and each one drew the name the page resolved. No marker text reaches the page.

## A reference reads as a link inside the sentence

A name the page resolved is not a box. At rest it has no border, no fill and no padding, it takes the paragraph's own colour and font, and it carries a 1px underline set 2px below the text — so a sentence that names a config, a layer, a key and a proposal still reads as a sentence, and a long config name is a long underlined name rather than a grey block. Hover and focus give it the quiet fill (`--color-accent-bg`) and the underline takes the text colour; focus keeps the visible ring the rest of the app uses (`2px` `--color-focus`, offset `2px`). The element stays a `<button>`, so Tab reaches it and Enter activates it with no code of its own, and it keeps its `title`.

A `<button>` is computed as an atomic inline by Chrome even with `display: inline` (a bare page with the same declarations reports `inline-block` on Chrome 156, which is the HTML rendering model for the element, not a cascade failure). The gate therefore checks what has to be true rather than the keyword: the name is an inline-level box with no box of its own, exactly one line tall for a short name, underlined, in the sentence's colour — and a long one wraps inside the paragraph.

## Both themes fit desktop and phone viewports

| Viewport in CSS pixels | Theme | Evidence |
|---|---|---|
| 1440 × 900 | Light | [The reply and its references](reply-light-1440x900.png), [after Enter on the key reference](key-pulse-light-1440x900.png), [after Enter on the config reference](config-opened-light-1440x900.png) |
| 1440 × 900 | Dark | [The reply and its references](reply-dark-1440x900.png) |
| 390 × 844 | Light | [The reply and its references](reply-light-390x844.png), [after Enter on the key reference](key-pulse-light-390x844.png), [after Enter on the config reference](config-opened-light-390x844.png) |
| 390 × 844 | Dark | [The reply and its references](reply-dark-390x844.png), [after Enter on the key reference](key-pulse-dark-390x844.png), [after Enter on the config reference](config-opened-dark-390x844.png) |

Captures are page captures from headless Chrome at device pixel ratio 1, with no browser chrome and no resizing. The phone shot is the chat bottom sheet rested on the reply rather than on the proposal card below it, because the reply is what this gate is about.

Measured facts (`capture-notes.txt`, identical at both widths and themes): the page does not scroll sideways (`scrollWidth == clientWidth`); the prose column is 428 pixels on the desktop and 358 on the phone against a 24-pixel line; all six references are inline-level with `0` padding, `0` border, a transparent fill and the paragraph's own colour; a short name is 24 pixels tall, exactly the line, so a reference never adds a line of its own; the 62-character config name is 428 (358) pixels wide and 48 pixels tall, two lines, with its right edge exactly at the paragraph's; and four names share a line on the desktop, two on the phone ("Two on one line: Layer 2 and S hold ⌥").

The card below the reply is the existing proposal card, unchanged; the reply's own reference to it is in the sentence above. This gate is [the design concept](../../../blueprint/23-design-concept.md) plus [the screenshot gate](../../../blueprint/18-visual-design.md#how-a-rung-proves-it-looks-good); no new visual system was added — the link borrows the app's existing underline, fill and focus ring.

## Tab reaches every reference, and Enter does what it says

From the conversation log, Tab walks the references in reading order and each takes the focus fill and ring visible in the captures: config, key, layer, proposal (the second pair of layer and key references repeats). With the reference focused, Enter activated it, in all four viewport and theme combinations:

| Reference | Before Enter | After Enter |
|---|---|---|
| `{layer:layer-2}` | the layer strip on Layer 0 | the strip on Layer 2 |
| `{key:layer-0:30}` | the strip on Layer 2 | the strip on Layer 0, and the S key ringed on the board (1400 ms) |
| `{proposal:cs_…}` | the card unpinned (`Not this` pressed) | the card pinned again, its rows on the board |
| `{config:lay_…}` | Editing Moonlander · Moonlander daily | Editing Moonlander · Glove80 (42-key-map) moved onto the Moonlander, second attempt |

Chrome's DevTools protocol only activates a button when the Enter keystroke carries its character; without it the keydown arrives and no click follows, which is a property of the harness, not of the page (the same finding the copy card's gate recorded for `<summary>`).

The config shot is the last one taken, because the page moves: the reply travels with the thread and is shown read-only under "Earlier, about Moonlander daily on your Moonlander". There the config reference is still live and the layer, key and proposal references read as words ("that layer", "that key", "that proposal"), because those belong to a layout that is not on screen; the reference to the other config is the one worth keeping live in a carried thread.

## What the run fails on

Every capture run checks thirteen things in each of the four combinations and exits non-zero if any fails: six names drawn; an inline-level box with no padding, border or fill; the paragraph's colour; one line tall for a short name; a 1px underline; the long name wrapping inside the paragraph; two names sharing a line; no sideways scroll; Tab reaching all four kinds; and each of the four activations above.

## What this does not prove

The web activation is proven here; the resolution of names, the two route lines, the fallback to words for ids that answer to nothing and the verbatim JSON text are proven through the CLI journey on the same source (`C-journey.ts`: a loopback provider, one turn, one proposal, no paid model). Comfort, a published binary and a real keyboard are outside this check.

## Repeating it

```sh
bun C-shots.ts     # the captures above, from a scratch data directory and its own Chrome profile
bun C-journey.ts   # the scripted journey: names inline, routes, words fallback, verbatim JSON
```

Both are kept beside this run's ledger (`~/code/planetaryescape/.orchestrate/agent-opens-config/`) rather than in the repository, and both start their own server on an ephemeral port with a fresh scratch data directory; each capture starts from a page load, so every run is independent.
