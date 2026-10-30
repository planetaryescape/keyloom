# A reply takes you to what it names

Checked source: `e397c4b89b2a56a2bbf92bb2734cfbea26d055af`, tree `6fea9e9d8fae922a0b80f953e9f99869583b5e26`, on `86bd8f6` (v0.64.0), the C candidate. That commit is code and tests; this file and the captures are the documentation commit that follows it, which changes no code, so the code under test is byte-identical to that tree. The app ran from `C-shots.ts`, kept beside this run's ledger rather than in the repository: the real server routes and SQLite in a scratch data directory, with a scripted Anthropic client behind the real SDK, and routes that refuse builds and flashes. No model was called, no network was used, no keyboard was touched. The config is the checked-in Oryx Moonlander fixture (`test/fixtures/oryx/synchronized`); the second config the reply names is a plain copy of it with a long name.

The reply was written by that scripted model in a real chat turn, so the conversation, its proposal and its stored text are what `keyloom chat` and the page would see:

> I saved it as **Glove80 (42-key-map) moved onto the Moonlander, second attempt** on this board. Option sits on **S hold ⌥** in the base layer, so on **Layer 2** I made that key a plain Option: **Plain Option on layer 2** is waiting on the board. Two on one line: **Layer 2** and **S hold ⌥**.

Bold here is a chip on screen: the four markers are `{config:lay_…}`, `{key:layer-0:30}`, `{layer:layer-2}` and `{proposal:cs_…}`, and each one drew the name the page resolved. No marker text reaches the page.

## Both themes fit desktop and phone viewports

| Viewport in CSS pixels | Theme | Evidence |
|---|---|---|
| 1440 × 900 | Light | [The reply and its chips](reply-light-1440x900.png), [after Enter on the key chip](key-pulse-light-1440x900.png), [after Enter on the config chip](config-opened-light-1440x900.png) |
| 1440 × 900 | Dark | [The reply and its chips](reply-dark-1440x900.png) |
| 390 × 844 | Light | [The reply and its chips](reply-light-390x844.png), [after Enter on the key chip](key-pulse-light-390x844.png), [after Enter on the config chip](config-opened-light-390x844.png) |
| 390 × 844 | Dark | [The reply and its chips](reply-dark-390x844.png), [after Enter on the key chip](key-pulse-dark-390x844.png), [after Enter on the config chip](config-opened-dark-390x844.png) |

Captures are page captures from headless Chrome at device pixel ratio 1, with no browser chrome and no resizing. The phone shot is the chat bottom sheet rested on the reply rather than on the proposal card below it, because the reply is what this gate is about.

The chips sit inside the sentence as inline boxes, not as a row of buttons: they share the paragraph's 24-pixel line, they wrap with it, and they break a long name instead of widening the reply. Measured facts (`capture-notes.txt`): the page does not scroll sideways at either width (`scrollWidth == clientWidth`), the prose column is 428 pixels on the desktop and 358 on the phone, a one-line chip is 26 pixels tall against the 24-pixel line, and the 62-character config name is one chip 50 pixels tall wrapping over two lines. Two chips share a line at both widths ("Two on one line: Layer 2 and S hold ⌥").

The card below the reply is the existing proposal card, unchanged; the reply's own chip for it is in the sentence above. This gate is [the design concept](../../../blueprint/23-design-concept.md) plus [the screenshot gate](../../../blueprint/18-visual-design.md#how-a-rung-proves-it-looks-good); no new visual system was added — the chip borrows the card surface's panel and hairline.

## Tab reaches every chip, and Enter does what the chip says

From the conversation log, Tab walks the chips in reading order and each takes the focus ring visible in the captures: config, key, layer, proposal (the second pair of layer and key chips repeats). With the chip focused, Enter activated it, in all four viewport and theme combinations:

| Chip | Before Enter | After Enter |
|---|---|---|
| `{layer:layer-2}` | the layer strip on Layer 0 | the strip on Layer 2 |
| `{key:layer-0:30}` | the strip on Layer 2 | the strip on Layer 0, and the S key ringed on the board (1400 ms) |
| `{proposal:cs_…}` | the card unpinned (`Not this` pressed) | the card pinned again, its rows on the board |
| `{config:lay_…}` | Editing Moonlander · Moonlander daily | Editing Moonlander · Glove80 (42-key-map) moved onto the Moonlander, second attempt |

Chrome's DevTools protocol only activates a button when the Enter keystroke carries its character; without it the keydown arrives and no click follows, which is a property of the harness, not of the page (the same finding the copy card's gate recorded for `<summary>`).

The config shot is the last one taken, because the page moves: the reply travels with the thread and is shown read-only under "Earlier, about Moonlander daily on your Moonlander". There the config marker is still live and the layer, key and proposal markers read as words ("that layer", "that key", "that proposal"), because those belong to a layout that is not on screen; the chip for the other config is the one worth keeping live in a carried thread.

## What this does not prove

The web activation is proven here; the resolution of names, the two route lines, the fallback to words for ids that answer to nothing and the verbatim JSON text are proven through the CLI journey on the same source (`C-journey.ts`: a loopback provider, one turn, one proposal, no paid model). Comfort, a published binary and a real keyboard are outside this check.

## Repeating it

```sh
bun C-shots.ts     # the captures above, from a scratch data directory and its own Chrome profile
bun C-journey.ts   # the scripted journey: names inline, routes, words fallback, verbatim JSON
```

Both are kept beside this run's ledger (`~/code/planetaryescape/.orchestrate/agent-opens-config/`) rather than in the repository, and both start their own server on an ephemeral port with a fresh scratch data directory; each capture starts from a page load, so every run is independent.
