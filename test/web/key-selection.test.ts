import { describe, expect, test } from "bun:test";
import { extendSelection } from "../../src/web/keyboard/selection.ts";
import { aroundCentre, labelPoint } from "../../src/web/keyboard/ComboLines.tsx";

describe("Shift-click selection", () => {
  test("the open key joins the first Shift-click, so click J then Shift-click K selects both", () => {
    expect(extendSelection(null, "base", 38, 37)).toEqual({ layerId: "base", positions: [37, 38] });
  });

  test("later Shift-clicks add and remove keys, kept in board order", () => {
    let selection = extendSelection(null, "base", 40, 10);
    selection = extendSelection(selection, "base", 5, 10);
    expect(selection?.positions).toEqual([5, 10, 40]);
    selection = extendSelection(selection, "base", 10, 10);
    expect(selection?.positions).toEqual([5, 40]);
  });

  test("the open key is not added again once a selection exists", () => {
    const first = extendSelection(null, "base", 2, 1);
    expect(extendSelection(first, "base", 3, 9)?.positions).toEqual([1, 2, 3]);
  });

  test("taking out the last key clears the selection, and shift-clicking the open key alone selects it", () => {
    expect(extendSelection({ layerId: "base", positions: [4] }, "base", 4, null)).toBeNull();
    expect(extendSelection(null, "base", 7, 7)).toEqual({ layerId: "base", positions: [7] });
  });

  test("a selection on another layer starts over", () => {
    expect(extendSelection({ layerId: "nav", positions: [1, 2] }, "base", 9, null)).toEqual({ layerId: "base", positions: [9] });
  });
});

describe("combo lines", () => {
  test("keys are joined in order around their middle, whatever order they are listed in", () => {
    const ring = aroundCentre([{ x: 2, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 2 }]);
    expect(ring).toHaveLength(3);
    // Each neighbour in the ring is a neighbour on the board: no side crosses the middle of the other two.
    expect(ring.map((p) => `${p.x},${p.y}`).sort()).toEqual(["0,0", "1,2", "2,0"]);
  });

  test("the label sits at the middle of the keys", () => {
    expect(labelPoint([{ x: 0, y: 0 }, { x: 2, y: 2 }])).toEqual({ x: 1, y: 1 });
    expect(labelPoint([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 3 }])).toEqual({ x: 1, y: 1 });
  });
});
