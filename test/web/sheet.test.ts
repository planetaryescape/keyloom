import { describe, expect, test } from "bun:test";
import { SHEET_SIZES, clampSheet, nearestSize, sheetHeight, shorter, taller } from "../../src/web/shell/sheet.ts";

// The bottom sheet on a phone (18#phones): three heights that a drag, two buttons and the arrow keys all land on.
describe("sheet heights", () => {
  test("peek is under half, half is under full, at any phone height", () => {
    for (const viewport of [568, 667, 844, 932, 1180]) {
      const [peek, half, full] = SHEET_SIZES.map((size) => sheetHeight(size, viewport));
      expect(peek).toBeLessThan(half as number);
      expect(half).toBeLessThan(full as number);
    }
  });

  test("half leaves the board visible: under half the window, and never more than 460px", () => {
    expect(sheetHeight("half", 844)).toBeLessThan(844 / 2);
    expect(sheetHeight("half", 2000)).toBe(460);
  });

  test("full leaves room for the header", () => {
    expect(sheetHeight("full", 844)).toBeLessThan(844 - 100);
  });
});

describe("dragging", () => {
  test("a drag is held between peek and full", () => {
    expect(clampSheet(10, 844)).toBe(sheetHeight("peek", 844));
    expect(clampSheet(5000, 844)).toBe(sheetHeight("full", 844));
    expect(clampSheet(300, 844)).toBe(300);
  });

  test("a drag ends on the nearest size", () => {
    expect(nearestSize(130, 844)).toBe("peek");
    expect(nearestSize(sheetHeight("half", 844) + 20, 844)).toBe("half");
    expect(nearestSize(700, 844)).toBe("full");
  });

  test("the buttons step one size and stop at the ends", () => {
    expect(taller("peek")).toBe("half");
    expect(taller("full")).toBe("full");
    expect(shorter("half")).toBe("peek");
    expect(shorter("peek")).toBe("peek");
  });
});
