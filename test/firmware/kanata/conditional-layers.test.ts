// kanata can't express "when two layers are both held" (D-388): it keeps one active layer, and `(layer x)` in a `switch` asks only about the
// top one. The generator says so in the file, and the validator warns instead of dropping the condition silently.
import { describe, expect, test } from "bun:test";
import { KBD_FILE, generateKanataSource } from "../../../src/firmware/kanata/generate.ts";
import { evaluate, standingIssues } from "../../../src/validation/validate.ts";
import { kanataBinary, kanataCheck } from "../../helpers/kanata-bin.ts";
import { macbook, richLayout } from "../../helpers/macbook.ts";
import { tempDir } from "../../helpers/tmp.ts";

const rich = richLayout();
const condition = { id: "tri", ifLayerIds: ["nav", "num"], thenLayerId: "base" };
const withCondition = { ...rich, layers: [...rich.layers, { id: "adj", name: "Adjust", bindings: rich.layers[1]!.bindings }], conditionalLayers: [{ ...condition, thenLayerId: "adj" }] };

describe("a conditional layer on the MacBook", () => {
  test("is left out of the config with a comment that names it", () => {
    const text = generateKanataSource({ layout: withCondition, board: macbook(), layoutId: "lay_T", revisionId: "rev_T" }).files.find((f) => f.path === KBD_FILE)!.content;
    expect(text).toContain(";; keyloom: these conditional layers are not written, because kanata has one active layer at a time:\n;;   nav + num -> adj");
    expect(text).toContain("(deflayer adj");
  });

  test("a layout without one has no such comment", () => {
    const text = generateKanataSource({ layout: rich, board: macbook(), layoutId: "lay_T", revisionId: "rev_T" }).files.find((f) => f.path === KBD_FILE)!.content;
    expect(text).not.toContain("conditional layers");
  });

  test("adding one is valid but warned about, and the warning is a standing finding too", () => {
    const board = macbook();
    const result = evaluate(board, { ...withCondition, conditionalLayers: [] }, [{ op: "upsertConditionalLayer", conditionalLayer: withCondition.conditionalLayers[0]! }]).result;
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain("conditional_layer_unsupported");
    expect(result.warnings.find((w) => w.code === "conditional_layer_unsupported")?.plain).toContain("only has one layer active at a time");
    expect(standingIssues(board, withCondition).map((i) => i.code)).toContain("conditional_layer_unsupported");
  });

  test("the config with the comment is one kanata accepts", async () => {
    const bin = kanataBinary();
    if (bin === undefined) return;
    const text = generateKanataSource({ layout: withCondition, board: macbook(), layoutId: "lay_T", revisionId: "rev_T" }).files.find((f) => f.path === KBD_FILE)!.content;
    const checked = await kanataCheck(bin, text, tempDir());
    expect(checked.ok).toBe(true);
  });
});
