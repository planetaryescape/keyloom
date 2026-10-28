# The stage cuts off the board's shadow along a straight line

Status: fixed on branch `fix/stage-shadow-and-flaky-limits`. In windows wider than 900 px, the well only scrolls when the board is wider or taller than the stage (`fitUnit`'s `overflowing` now checks both sides). A board that fits gets `overflow: visible`, so nothing clips its shadows. Narrow windows keep the scroll box, because they scroll the edited key above the sheet.

The board's shadow on the stage stops at a hard horizontal edge a little below the board, instead of fading out. It is faint in the light theme with the board following the theme. It shows clearly under a dark case on the light stage, such as a Glove80 pinned to Grey or a Moonlander pinned to Black (D-395). There the light stage reads as a pale band, with the shadow above it.

## What clips it

The board sits in `.keyboard-well`, which scrolls a board wider or taller than the stage: `overflow: auto` (`src/web/shell/shell.css`, the `.keyboard-well` rule). Two shadows reach past the well's padding box, and the overflow clips them both:

- `.keyboard-contact`, a radial `--case-shadow` under the board with `filter: blur(24px)` and `inset: 34% 4% 0 4%`;
- `.keyboard-case`'s `filter: drop-shadow(0 10px 18px var(--case-shadow))`.

Measured on the Glove80 at 1440×900 in the light theme with the Grey pin, on `ui/colourway-pin` while the pin was being built (its first shadow, `rgb(30 34 48 / 0.5)`): `.keyboard-well` spans y 184 to 750. The band's top edge in the screenshot sits at y ≈ 750, and `document.elementsFromPoint(300, 745)` and `(300, 760)` fall on either side of it: the well, then the stage. `evidence/light-build/shots/cw-glove80-follow-1440-light.png` in the orchestration folder shows the faint edge with the board following the theme. The Grey screenshot that showed it clearly was replaced when the pin's shadow was softened.

The pin hides most of it for now: a dark case on the light stage casts a softer shadow (`--case-shadow: rgb(30 34 48 / 0.32)` in `src/web/keyboard/colourway.css`), so the edge is faint again. The clip is still there.

## What would fix it

Give the shadow room inside the well instead of clipping it. One way is to pad the well's bottom by the shadow's reach. Another is to draw the contact shadow on the stage behind the well, outside the scrolling box. Either has to keep a board that is wider than the stage scrollable from its left edge (the `margin: auto` rule beside it), and keep the phone's one-half view (`.keyboard-well[data-half]`) working.

Not fixed: the coordinator asked for this to be left alone for now, 2026-10-18.

## A padded well trades the clip for an overflow

Tried on 2026-10-23 (branch `fix/stage-shadow-clip`, not merged): pad the well's bottom by 72 px for the shadow, leave the board's fit size unchanged, and translate the board down by half that so it stays centred. In the dev editor at 1440×900 (Moonlander fixture) the board kept its place to 1 px, but the well's `scrollHeight` grew from 569 to 572 against a `clientHeight` of 569, a 3 px vertical overflow and so a scrollbar wherever scrollbars always show. In the default light and dark themes the shadow edge wasn't visible before or after.

The choice left: make the board 72 px shorter, so the shadow fits inside the well, or draw the contact shadow outside the scrolling box, positioned from the board's measured size. That needs a ResizeObserver and scroll tracking.

## Fixed by dropping the scroll box when the board fits

On 2026-10-28 the dev editor ran at 1440×900 in the light theme with the Moonlander fixture. The case was given a longer test shadow, `drop-shadow(0 40px 30px rgb(0 0 0 / 0.95))`. On main `45c67e9` the shadow stops in a hard line at the well's bottom edge, y 750, with the well at `overflow: auto`. On the fix it fades out past that line with the well at `overflow: visible`, and `scrollHeight` equals `clientHeight` at 569. With the shipped shadow, both builds give the same pixels from y 700 to 768. The Moonlander's shadow has faded by about y 740, so on that board the clip was never visible. Opening a key's card still parts the board with no scrollbar (`scrollWidth` 1440 = `clientWidth`). At 800 px wide the well stays `overflow: auto`.
