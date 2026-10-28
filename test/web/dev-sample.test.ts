import { describe, expect, test } from "bun:test";
import { LayoutDetailSchema } from "../../src/api/http.ts";
import { showBoard } from "../../src/app/boards.ts";
import { devSample } from "../helpers/dev-sample.ts";

// The dev servers must draw the board the app draws. A copied board would pass the schema and still
// lose the case outline and thumb clusters, which is how the dev sample went stale.
describe("dev sample", () => {
  test("uses the live Moonlander board and geometry, not a copy", async () => {
    const sample = await devSample();
    const live = showBoard("zsa/moonlander");
    expect(sample.board).toEqual(live.definition);
    expect(sample.geometry).toEqual(live.geometry);
    expect(sample.board.display).toBeDefined();
  });

  test("carries the synchronized Oryx layout, read by the importer, not made-up bindings", async () => {
    const sample = await devSample();
    expect(LayoutDetailSchema.parse(sample).document.layers.length).toBeGreaterThan(1);
    const base = sample.document.layers[0];
    expect(base?.bindings[0]).toEqual({ kind: "key", code: "ESCAPE" });
    expect(base?.bindings.length).toBe(sample.board.keyCount);
  });
});
