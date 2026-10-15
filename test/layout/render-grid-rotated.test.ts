import { describe, expect, test } from "bun:test";
import { placedKey, renderCells } from "../../src/layout/render-grid.ts";

describe("rotated keys in the text grid", () => {
  test("a key turned 90 degrees clockwise about a point below it swings right, level with that point", () => {
    const p = placedKey({ x: 0, y: 0, w: 1, h: 1, r: 90, rx: 0.5, ry: 2.5 });
    expect(p.x).toBeCloseTo(2);
    expect(p.y).toBeCloseTo(2);
  });

  test("every Glove80 key appears, including thumbs that share an unrotated position", async () => {
    const geometry = await Bun.file(new URL("../../boards/moergo/glove80/geometry.json", import.meta.url)).json();
    const keys = (Array.isArray(geometry) ? geometry : geometry.keys) as Parameters<typeof renderCells>[0];
    const labels = keys.map((_, i) => `k${i}`);
    const text = renderCells(keys, labels, { cellWidth: 7 }).join("\n");
    for (const label of labels) expect(text).toMatch(new RegExp(`\\b${label}\\b`));
  });
});
