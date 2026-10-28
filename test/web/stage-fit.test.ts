import { describe, expect, test } from "bun:test";
import { isOnePiece } from "../../src/boards/one-piece.ts";
import { listBoards } from "../../src/boards/registry.ts";
import { canvasAround } from "../../src/web/keyboard/canvas.ts";
import { caseParts } from "../../src/web/keyboard/case-shape.ts";
import { applyDisplayRotation } from "../../src/web/keyboard/geometry.ts";
import { MIN_UNIT, fitUnit } from "../../src/web/keyboard/useFitUnit.ts";

// Every shipped board, sized the way the editor sizes it, in the room the editor's stage gives it. The stage sizes are the
// .keyboard-well's content box measured in the demo editor (test/helpers/demo-sync.ts) at each window size, with no panel open; a
// change to the shell's layout that moves them should update this table.
//
// The phone row uses the mouse's 34 px floor, as the screenshot gate's browser does. Under a fingertip the floor is 44 px, and a half
// wider than 8.3u (the Moonlander's, the Glove80's) then scrolls a little by design (18: caps are 44 px or more); a half that needs
// under 34 px, as the Unix60's right half did when the editor split it, overflows under either pointer.
const STAGES = [
  { window: "1440x900", width: 1376, height: 545, min: MIN_UNIT.mouse, phone: false },
  { window: "1280x577", width: 1216, height: 356, min: MIN_UNIT.mouse, phone: false },
  { window: "390x844", width: 366, height: 592, min: MIN_UNIT.mouse, phone: true },
] as const;

describe("every shipped board fits the editor's stage", () => {
  for (const { definition: d, geometry } of listBoards()) {
    const keys = applyDisplayRotation(geometry.keys, d.display);
    const onePiece = isOnePiece(d, keys);

    test(`${d.id}: boards check and the editor agree on whether it is one piece`, () => {
      expect(isOnePiece(d, geometry.keys)).toBe(onePiece);
    });

    for (const stage of STAGES) {
      // A phone shows a split board one hand at a time and a one-piece board whole, as the editor does (D-351).
      const views = stage.phone && !onePiece ? (["left", "right"] as const) : ([null] as const);
      for (const half of views) {
        test(`${d.id} at ${stage.window}${half === null ? "" : `, ${half} hand`}`, () => {
          const shown = half === null ? keys : keys.filter((_, p) => d.hands[half].includes(p));
          const canvas = canvasAround(shown, caseParts(keys, d.hands, d.display, half));
          const { unit, overflowing } = fitUnit(canvas, stage, stage.min);
          expect(canvas.height * unit).toBeLessThanOrEqual(stage.height + 1);
          // Only a one-piece board on a phone may be wider than the stage: it scrolls sideways as one piece rather than shrink its keys
          // under a fingertip or be cut between the hands.
          if (stage.phone && onePiece) {
            if (overflowing) expect(unit).toBe(stage.min);
          } else {
            expect(overflowing).toBe(false);
          }
        });
      }
    }
  }
});

// The stage drops its scroll box, and so stops clipping the board's shadow, only when this is false (docs/issues/stage-clips-board-shadow.md).
describe("a board overflows the stage on either side", () => {
  test("a board too tall for the stage at the smallest key overflows, though it fits sideways", () => {
    expect(fitUnit({ width: 10, height: 10 }, { width: 1000, height: 200 }, 34)).toEqual({ unit: 34, overflowing: true });
  });

  test("a board too wide for the stage at the smallest key overflows", () => {
    expect(fitUnit({ width: 40, height: 4 }, { width: 1000, height: 600 }, 34)).toEqual({ unit: 34, overflowing: true });
  });

  test("a board that fits both ways doesn't", () => {
    expect(fitUnit({ width: 20, height: 8 }, { width: 1000, height: 600 }, 34)).toEqual({ unit: 50, overflowing: false });
  });
});
