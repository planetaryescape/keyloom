# The copy's reply says what came across

Checked source: `554a306db2744ee22077c0bec068dbe69a5dd3d8`, tree `56c66bc3caa6e12225cb9bdaa34639588c960bda`, on 2026-10-30. This commit is code, tests and the capture script; the documentation and these captures are the commit that follows it, so the code under test is byte-identical to that tree. The app ran from `scripts/dev-copy-layout.ts`: the real server routes, SQLite in a scratch data directory, and a scripted Anthropic client. No model was called, no network was used, and the build, flash and "use this config" routes refuse. The source layout is the checked-in Oryx Moonlander fixture (`test/fixtures/oryx/synchronized`); the target is the checked-in Corne board definition.

The copy was asked in the chat ("Copy my Moonlander setup onto my Corne"). The app carried the reader into the new config's own conversation, where the copy's first reply carries the report card: `Moonlander → Corne`, 156 keys came across on 6 layers, 15 of them nearest-place guesses, then two closed disclosures — **Carried by layer** and **112 keys did not come across** — then 8 combos, 4 layer keys placed on free keys and 2 that could not be placed, and the notes for what was never about keys (LED colours, firmware settings, passthrough code). The card ends with those notes: it does not add a line pointing at this conversation, because the reader is already in it.

The card reuses the question card's quiet surface (`.ask-card`); it adds no new visual system. Its lead is what carried and what did not, because that decides whether the copy is usable; the per-layer split is detail and sits behind its own disclosure, so the drops are not pushed below the fold on the phone. **Carried by layer** holds the line-per-layer bullets (carried, guessed, left off, and "and N more layers"); the drops disclosure holds one row per key that did not come across, with the plan's own reason, bounded to 40 rows with the rest counted as "and N more". Neither disclosure appears when it has nothing to say: a one-layer copy has no layer disclosure, and a copy that lost no keys has no drops disclosure.

## Both themes fit desktop and phone viewports

| Viewport in CSS pixels | Theme | Evidence |
|---|---|---|
| 1440 × 900 | Dark | [The card](card-dark-1440x900.png), [its drops opened](card-open-dark-1440x900.png) |
| 1440 × 900 | Light | [The card](card-light-1440x900.png) |
| 390 × 844 | Dark | [Top of the card](card-dark-390x844.png), [middle](card-mid-dark-390x844.png), [end](card-end-dark-390x844.png) |
| 390 × 844 | Light | [Top of the card](card-light-390x844.png), [middle](card-mid-light-390x844.png), [end](card-end-light-390x844.png) |

Captures use device pixel ratio 2: desktop PNGs are 2880 × 1800 and phone PNGs are 780 × 1688. They are page captures from headless Chrome, with no browser chrome and no resizing.

On the phone the chat is the bottom sheet, which gives the thread 257 CSS pixels; the card is 529 pixels tall at that width, so three shots scroll through it rather than pretending it fits. The top shot shows the boards, the carried sentence and both disclosures, with the drops summary above the fold. The page does not scroll sideways (`scrollWidth == clientWidth`), and the card holds the 358-pixel column with keys and reasons wrapping. The desktop capture keeps the board beside the thread and the whole card reads in one screen (433 pixels tall). `capture-notes.txt` records each capture's measured facts and `card-text.txt` the dark desktop card's text.

## Both disclosures open from the keyboard

Each is a native `<details>`/`<summary>`, with the same visible focus ring. Focusing **Carried by layer** and pressing Enter opened it and kept the focus there, and a second Enter closed it again; focusing **112 keys did not come across** and pressing Enter opened the reasons, and `card-open-dark-1440x900.png` is that state. Chrome's DevTools protocol only activates a summary when the Enter keystroke carries its character, which is a property of the harness, not of the page.

## Repeating it

```sh
bun scripts/copy-report-shots.ts [outDir]
```

The script starts its own demo server on port 4495 with a fresh scratch data directory per capture, and its own Chrome profile on an ephemeral debugging port. It frames the card in the thread (whole when it fits, from its top in the phone sheet), and fails if a step before the card reports a failure, if the card renders banned wording ("unsupported", "successfully", "!"), if the page overflows, or if either disclosure does not open and close from the keyboard.

This is candidate evidence on a synthetic setup. It does not verify a published binary, a real keyboard, or how the copy feels to type on.
