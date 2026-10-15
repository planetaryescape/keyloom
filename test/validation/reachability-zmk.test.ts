import { describe, expect, test } from "bun:test";
import { importZmkSource } from "../../src/firmware/zmk/import.ts";
import { layerGraph, reachableLayers } from "../../src/validation/reachability.ts";
import { TEMPLATE_FIXTURE, glove80 } from "../helpers/zmk.ts";

describe("reachability through ZMK behaviours kept as written", () => {
  test("the Glove80 template reaches Lower through its tap-dance and Magic through its hold-tap", async () => {
    const board = await glove80();
    const { layout } = await importZmkSource(TEMPLATE_FIXTURE, board.definition);
    const edges = layerGraph(layout);
    const lower = layout.layers[1]?.id as string;
    const magic = layout.layers[2]?.id as string;
    expect(edges.some((e) => e.to === lower && e.action === "momentary")).toBe(true);
    expect(edges.some((e) => e.to === magic && e.action === "momentary")).toBe(true);
    const reachable = reachableLayers(layout, edges);
    expect(reachable.has(lower)).toBe(true);
    expect(reachable.has(magic)).toBe(true);
  });
});
