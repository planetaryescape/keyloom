import { describe, expect, test } from "bun:test";
import { bindingLabel, renderCells, renderLayout, rowsOf, shortKeyLabel } from "../../src/layout/render-grid.ts";
import type { Layer, Layout } from "../../src/layout/schema.ts";
import { moonlander } from "../helpers/board.ts";

const ctx = {
  layers: [{ id: "base", name: "Base" }, { id: "nav", name: "Nav" }],
  macros: [{ id: "m-one" }],
};

describe("labels", () => {
  test("every binding kind has a short label", () => {
    expect(bindingLabel({ kind: "key", code: "A" }, ctx)).toBe("A");
    expect(bindingLabel({ kind: "key", code: "N4", mods: ["LGUI", "LSFT"] }, ctx)).toBe("⌘⇧4");
    expect(bindingLabel({ kind: "modifier", mods: ["RALT"] }, ctx)).toBe("r⌥");
    expect(bindingLabel({ kind: "modifier", mods: ["LCTL", "LSFT", "LALT", "LGUI"] }, ctx)).toBe("Hyp");
    expect(bindingLabel({ kind: "modifier", mods: ["LCTL", "LSFT", "LALT"] }, ctx)).toBe("Meh");
    expect(bindingLabel({ kind: "holdTap", tap: { code: "F" }, hold: { mods: ["LGUI"] }, profileId: "p" }, ctx)).toBe("F/⌘");
    expect(bindingLabel({ kind: "holdTap", tap: { code: "SPACE" }, hold: { layerId: "nav" }, profileId: "p" }, ctx)).toBe("SPC/L1");
    expect(bindingLabel({ kind: "layer", action: "momentary", layerId: "nav" }, ctx)).toBe("MO1");
    expect(bindingLabel({ kind: "layer", action: "oneShot", layerId: "base" }, ctx)).toBe("OSL0");
    expect(bindingLabel({ kind: "macro", macroId: "m-one" }, ctx)).toBe("M0");
    expect(bindingLabel({ kind: "macro", macroId: "gone" }, ctx)).toBe("M?");
    expect(bindingLabel({ kind: "transparent" }, ctx)).toBe("▽");
    expect(bindingLabel({ kind: "none" }, ctx)).toBe("×");
    expect(bindingLabel({ kind: "native", firmware: "qmk", source: "TD(DANCE_0)", label: "TD0" }, ctx)).toBe("TD0");
  });

  test("a layer that doesn't exist is shown by its id, not hidden", () => {
    expect(bindingLabel({ kind: "layer", action: "to", layerId: "ghost" }, ctx)).toBe("TOghost");
  });

  test("a code outside the table is shown as written; prototype names don't resolve", () => {
    expect(shortKeyLabel("MYSTERY")).toBe("MYSTERY");
    expect(shortKeyLabel("constructor")).toBe("constructor");
    expect(shortKeyLabel("__proto__")).toBe("__proto__");
  });

  test("long names use the shortest alias", () => {
    expect(shortKeyLabel("BACKSPACE")).toBe("BSPC");
    expect(shortKeyLabel("ESCAPE")).toBe("Esc");
  });
});

describe("grid shape", () => {
  test("keys on the same staggered row land on one line, in x order", () => {
    const geometry = [
      { x: 1, y: 0.375, w: 1, h: 1 }, { x: 0, y: 0.25, w: 1, h: 1 }, { x: 2, y: 0, w: 1, h: 1 }, // one row, staggered
      { x: 0, y: 1.5, w: 1, h: 1 },
    ];
    expect(rowsOf(geometry)).toEqual([[1, 0, 2], [3]]);
  });

  test("a wide key takes its width and the gap between halves is kept", () => {
    const lines = renderCells([{ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 0, w: 2, h: 1 }], ["a", "b"], { cellWidth: 4 });
    expect(lines).toEqual([` a${" ".repeat(9)}b`]); // b is centred in a 7-wide cell that starts at column 8
  });

  test("labels longer than the cell are clipped with an ellipsis", () => {
    expect(renderCells([{ x: 0, y: 0, w: 1, h: 1 }], ["ABCDEFGHIJ"], { cellWidth: 5 })).toEqual(["ABC…"]);
  });

  test("the label and key counts must match", () => {
    expect(() => renderCells([{ x: 0, y: 0, w: 1, h: 1 }], [])).toThrow();
  });
});

describe("Moonlander", () => {
  const key = (code: string) => ({ kind: "key" as const, code });
  const layer = (id: string, fill: Layer["bindings"][number]): Layer => ({ id, name: id, bindings: Array.from({ length: 72 }, () => fill) });

  test("renders six physical rows per layer, with thumbs on their own row", async () => {
    const board = await moonlander();
    const layout: Pick<Layout, "layers" | "macros"> = { layers: [layer("base", key("A")), layer("nav", { kind: "transparent" })], macros: [] };
    const text = renderLayout(board.geometry.keys, layout);
    const [first, second] = text.split("\n\n");
    expect(first?.split("\n")).toHaveLength(7); // heading + 6 rows
    expect(second?.split("\n")[1]).toContain("▽");
    expect(first?.split("\n")[0]).toBe("Layer 0: base (base)");
    const rows = first?.split("\n").slice(1) ?? [];
    expect(rows[5]?.startsWith(" ".repeat(30))).toBe(true); // thumbs are indented under the inner columns
    expect(rows[0]?.match(/A/g)).toHaveLength(14);
    expect(rows[3]?.match(/A/g)).toHaveLength(12);
    expect(rows[5]?.match(/A/g)).toHaveLength(6);
  });

  test("a single layer can be chosen", async () => {
    const board = await moonlander();
    const layout = { layers: [layer("base", key("A")), layer("nav", key("B"))], macros: [] };
    const text = renderLayout(board.geometry.keys, layout, { onlyLayerId: "nav" });
    expect(text).toContain("Layer 1");
    expect(text).not.toContain("Layer 0");
  });

  test("a layer with the wrong number of bindings is an error, not a misdrawn grid", async () => {
    const board = await moonlander();
    const short: Layer = { id: "x", name: "x", bindings: [key("A")] };
    expect(() => renderLayout(board.geometry.keys, { layers: [short], macros: [] })).toThrow(/1 bindings/);
  });
});
