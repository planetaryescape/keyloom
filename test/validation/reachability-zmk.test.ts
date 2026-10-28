import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { importZmkSource } from "../../src/firmware/zmk/import.ts";
import { layerGraph, reachableLayers } from "../../src/validation/reachability.ts";
import { TEMPLATE_FIXTURE, glove80 } from "../helpers/zmk.ts";
import { tempDir } from "../helpers/tmp.ts";

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

  test("a hold-tap's layer written in hex, decimal or with an upper-case prefix is read as that layer", async () => {
    const board = await glove80();
    const template = readFileSync(`${TEMPLATE_FIXTURE}/glove80.keymap`, "utf8");
    for (const literal of ["0x2", "0X2", "2"]) {
      const dir = tempDir("keyloom-reach-");
      writeFileSync(`${dir}/glove80.keymap`, template.replace("#define MAGIC 2", `#define MAGIC ${literal}`));
      copyFileSync(`${TEMPLATE_FIXTURE}/glove80.conf`, `${dir}/glove80.conf`);
      const { layout } = await importZmkSource(dir, board.definition);
      const magic = layout.layers[2]?.id ?? "";
      expect(reachableLayers(layout).has(magic)).toBe(true);
    }
  });
});
