# The stage cuts off the board's shadow along a straight line

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
