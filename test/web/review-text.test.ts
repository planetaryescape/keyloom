// A review's words draw keys as caps, but a key with no legend reads as where it is (D-340): a cap that says "empty" says nothing.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { ReviewText } from "../../src/web/review/ReviewPanel.tsx";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";

const board = await moonlander();
const { layout } = await importOryxSource(FIXTURE_DIR, board.definition);
const base = layout.layers[0]!;
const blank = { ...layout, layers: [{ ...base, bindings: base.bindings.map((b, i) => (i === 1 ? { kind: "none" as const } : b)) }, ...layout.layers.slice(1)] };
const rows = board.definition.rows;
const rowOf = (p: number) => Object.entries(rows).find(([, ps]) => ps.includes(p))?.[0];

describe("ReviewText", () => {
  test("a key with a legend is a cap; one without is its place in words", () => {
    const html = renderToStaticMarkup(createElement(ReviewText, { text: `{key:${base.id}:0} and {key:${base.id}:1}`, layout: blank, rows }));
    expect(html).toContain("mini-cap");
    expect(html).not.toMatch(/>empty</);
    expect(rowOf(1)).toBe("number");
    expect(html).toContain("an empty key on the number row");
  });
});
