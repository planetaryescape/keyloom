import { describe, expect, test } from "bun:test";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { describeKey } from "../../src/layout/describe.ts";
import type { Layout } from "../../src/layout/schema.ts";
import type { GeometryKey } from "../../src/boards/schema.ts";
import { CAP_INSET, HOLD_SIZE, LEGEND_FLOOR_PX, TAP_SIZE, fitLegend, widestPieceEm } from "../../src/web/keyboard/fit.ts";
import { importZmkSource } from "../../src/firmware/zmk/import.ts";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";
import { TEMPLATE_FIXTURE, glove80 } from "../helpers/zmk.ts";
import { loadFixture } from "../server/fixture.ts";

// Every legend of every layer, checked the way the viewer draws it: at the size fitLegend
// picks, the estimated text must fit inside the cap, and the size must stay legible.
//
// `strict` is for real layouts: nothing may need wrapping. The hand-written sample uses key names
// outside the keycode table, which are shown as written and may be long; those only have to be
// flagged for wrapping, never clipped.
function checkAll(layout: Layout, keys: readonly GeometryKey[], strict: boolean, unit?: number): string[] {
  const failures: string[] = [];
  let checked = 0;
  layout.layers.forEach((layer, layerIndex) => {
    keys.forEach((key, index) => {
      const description = describeKey(layout, layerIndex, index);
      if (description === null) return;
      for (const [role, text, range] of [
        ["tap", description.legend.tap, TAP_SIZE],
        ["hold", description.legend.hold ?? "", HOLD_SIZE],
      ] as const) {
        if (text === "") continue;
        checked += 1;
        const where = `${layer.name} key ${index + 1} ${role} "${text}"`;
        if (/…|\.\.\./.test(text)) failures.push(`${where} contains an ellipsis`);
        const fit = fitLegend(text, key.w, range, unit === undefined ? undefined : { unit });
        if (!fit.fits && strict)
          failures.push(
            `${where} needs ${widestPieceEm(text).toFixed(2)}em but only ${(key.w - CAP_INSET).toFixed(2)}u is free`,
          );
        if (fit.size < range.min - 1e-9) failures.push(`${where} is below the legible minimum`);
        if (unit !== undefined && fit.size * unit < LEGEND_FLOOR_PX - 1e-9) failures.push(`${where} is drawn at ${(fit.size * unit).toFixed(1)} px, under the ${LEGEND_FLOOR_PX} px floor`);
        // The estimate itself must hold: text at this size is no wider than the cap's free width.
        if (fit.fits && fit.size * widestPieceEm(text) > key.w - CAP_INSET + 1e-9)
          failures.push(`${where} overflows at size ${fit.size}`);
      }
    });
  });
  expect(checked).toBeGreaterThan(100);
  return failures;
}

describe("legends fit their keycaps", () => {
  test("every legend on every layer of the imported Oryx fixture fits without truncation", async () => {
    const board = await moonlander();
    const { layout } = await importOryxSource(FIXTURE_DIR, board.definition);
    expect(checkAll(layout, board.geometry.keys, true)).toEqual([]);
  });

  test("the viewer's sample layout never clips a legend, even with key names outside the table", async () => {
    const { document, geometry } = await loadFixture();
    expect(checkAll(document, geometry.keys, false)).toEqual([]);
  });
});

describe("the 11 px legend floor", () => {
  // The laptop window (1440 x 900) draws the Glove80 at about 49 px per key unit, the Moonlander at about 53.
  test("no legend of the Moonlander or the Glove80 is drawn under the floor or needs wrapping at the laptop unit", async () => {
    const board = await moonlander();
    const { layout } = await importOryxSource(FIXTURE_DIR, board.definition);
    expect(checkAll(layout, board.geometry.keys, true, 49)).toEqual([]);
    const glove = await glove80();
    const imported = await importZmkSource(TEMPLATE_FIXTURE, glove.definition);
    expect(checkAll(imported.layout, glove.geometry.keys, true, 49)).toEqual([]);
  });

  test("the floor turns a would-be smaller legend into a wrapping one instead of a tiny one", () => {
    const fit = fitLegend("Navigation", 1, TAP_SIZE, { unit: 49 });
    expect(fit.fits).toBe(false);
    expect(fit.size * 49).toBeGreaterThanOrEqual(LEGEND_FLOOR_PX);
  });

  test("a bigger unit leaves the legend its own size range", () => {
    expect(fitLegend("A", 1, TAP_SIZE, { unit: 90 })).toEqual({ size: TAP_SIZE.max, fits: true });
  });
});

describe("fitLegend", () => {
  test("a short legend gets the full size and a long one is shrunk, not cut", () => {
    expect(fitLegend("A", 1, TAP_SIZE)).toEqual({ size: TAP_SIZE.max, fits: true });
    const long = fitLegend("MSBTN2", 1, TAP_SIZE);
    expect(long.fits).toBe(true);
    expect(long.size).toBeLessThan(TAP_SIZE.max);
    expect(long.size).toBeGreaterThanOrEqual(TAP_SIZE.min);
  });

  test("a legend too long for even the smallest size is flagged so the cap wraps it", () => {
    expect(fitLegend("Navigation", 1, TAP_SIZE)).toEqual({ size: TAP_SIZE.min, fits: false });
  });

  test("a wider cap gives the same legend more room", () => {
    expect(fitLegend("Navigation", 2, TAP_SIZE).fits).toBe(true);
  });

  test("a legend of only symbols is drawn larger, since symbols render small", () => {
    expect(fitLegend("⌫", 1, TAP_SIZE).size).toBeGreaterThan(TAP_SIZE.max);
  });
});
