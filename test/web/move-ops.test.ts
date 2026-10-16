import { describe, expect, test } from "bun:test";
import { applyOps } from "../../src/layout/apply-ops.ts";
import {
  copyOps, copySummary, pasteOps, pasteSummary, quickAssignOps, quickAssignSummary, sameSlot, swapOps, swapSummary,
} from "../../src/web/editor/move-ops.ts";
import { validate } from "../../src/validation/validate.ts";
import { key, tiny, tinyBoard } from "../helpers/tiny.ts";

const at = (layerId: string, position: number) => ({ layerId, position });

describe("swapping", () => {
  test("two keys on different layers are one swapBindings op, and it swaps both", () => {
    const ops = swapOps(at("base", 0), at("num", 3));
    expect(ops).toEqual([{ op: "swapBindings", a: at("base", 0), b: at("num", 3) }]);
    const out = applyOps(tiny(), ops ?? []);
    expect(out.ok && out.layout.layers[0]?.bindings[0]).toEqual(key("N4"));
    expect(out.ok && out.layout.layers[1]?.bindings[3]).toEqual(key("A"));
    expect(validate(tinyBoard, tiny(), ops ?? []).diff.changed).toEqual([at("base", 0), at("num", 3)]);
  });

  test("a key swapped with itself is nothing", () => {
    expect(swapOps(at("base", 1), at("base", 1))).toBeNull();
    expect(sameSlot(at("base", 1), at("base", 1))).toBe(true);
  });

  test("the history line names both keys and what they held", () => {
    expect(swapSummary(tiny(), at("base", 0), at("num", 3))).toBe("Swapped A on Base and 4 on Numbers");
  });
});

describe("copying and pasting", () => {
  test("a copy is a setBinding of a clone, so later edits to one don't reach the other", () => {
    const layout = tiny();
    const ops = copyOps(layout, at("base", 0), at("num", 0));
    expect(ops).toEqual([{ op: "setBinding", at: at("num", 0), binding: key("A") }]);
    const first = ops?.[0];
    expect(first?.op === "setBinding" && first.binding).not.toBe(layout.layers[0]?.bindings[0]);
  });

  test("copying onto itself or onto an identical key is nothing", () => {
    expect(copyOps(tiny(), at("base", 0), at("base", 0))).toBeNull();
    expect(copyOps(tiny(), at("base", 0), at("nav", 0))).toBeNull();
    expect(copyOps(tiny(), at("base", 9), at("nav", 0))).toBeNull();
  });

  test("a paste onto three keys is one op list that skips keys already holding it", () => {
    const targets = [at("base", 1), at("num", 2), at("nav", 0), at("nav", 3)];
    const ops = pasteOps(tiny(), key("ESCAPE"), targets);
    expect(ops?.map((op) => (op.op === "setBinding" ? `${op.at.layerId}:${op.at.position}` : ""))).toEqual(["base:1", "num:2", "nav:0", "nav:3"]);
    const out = applyOps(tiny(), ops ?? []);
    expect(out.ok && targets.every((t) => out.layout.layers.find((l) => l.id === t.layerId)?.bindings[t.position]?.kind === "key")).toBe(true);
    expect(pasteOps(tiny(), key("B"), [at("base", 1)])).toBeNull();
    expect(pasteOps(tiny(), key("B"), [])).toBeNull();
    expect(pasteOps(tiny(), key("B"), [at("base", 77)])).toBeNull();
  });

  test("pasting over the only copy of a function is refused by the validator, not silently applied", () => {
    const result = validate(tinyBoard, tiny(), pasteOps(tiny(), key("Z"), [at("num", 0)]) ?? []);
    expect(result.errors.map((e) => e.code)).toContain("function_lost");
  });

  test("summaries say what went where", () => {
    expect(copySummary(tiny(), at("base", 0), at("num", 0))).toBe("Copied A from Base onto the 1 key on Numbers");
    expect(pasteSummary(tiny(), key("ESCAPE"), [at("base", 0)])).toBe("Pasted Esc onto the A key on Base");
    expect(pasteSummary(tiny(), key("ESCAPE"), [at("base", 0), at("base", 1), at("num", 0)])).toBe("Pasted Esc onto 3 keys");
  });
});

describe("quick assign", () => {
  test("typed keys go to the selected keys in order, and extra keystrokes are dropped", () => {
    const targets = [at("base", 3), at("base", 1)];
    const ops = quickAssignOps(targets, ["Q", "W", "E"]);
    expect(ops).toEqual([
      { op: "setBinding", at: at("base", 3), binding: key("Q") },
      { op: "setBinding", at: at("base", 1), binding: key("W") },
    ]);
    expect(quickAssignSummary(tiny(), targets, ["Q", "W", "E"])).toBe("Typed 2 keys onto 2 selected keys");
  });

  test("no keystrokes or no selection is nothing", () => {
    expect(quickAssignOps([at("base", 0)], [])).toBeNull();
    expect(quickAssignOps([], ["Q"])).toBeNull();
  });
});
