import { describe, expect, test } from "bun:test";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { importZmkSource } from "../../src/firmware/zmk/import.ts";
import { KEYCODES } from "../../src/layout/keycodes.ts";
import { functionHomes } from "../../src/validation/reachability.ts";
import type { BoardDefinition } from "../../src/boards/schema.ts";
import type { Slot } from "../../src/layout/change.ts";
import { bindingFunctions } from "../../src/layout/functions.ts";
import type { Binding, Layout } from "../../src/layout/schema.ts";
import { validate } from "../../src/validation/validate.ts";
import { type Placement, canDrop, dropReason, editorOps, lostFunctionsIn, placeableBinding, splitLost } from "../../src/web/editor/lost-functions.ts";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";
import { TEMPLATE_FIXTURE, glove80 } from "../helpers/zmk.ts";

const moon = await moonlander();
const glove = await glove80();
const layouts = [
  { name: "BK's Moonlander", board: moon.definition, layout: (await importOryxSource(FIXTURE_DIR, moon.definition)).layout },
  { name: "the Glove80 template", board: glove.definition, layout: (await importZmkSource(TEMPLATE_FIXTURE, glove.definition)).layout },
];

/** A key nobody uses yet, so the edit can only ever lose the function that was there. */
function unusedKey(layout: Layout): Binding {
  const used = new Set(functionHomes(layout).keys());
  const free = KEYCODES.find((k) => (k.category === "function" || k.category === "media") && !used.has(`key:${k.name}`));
  if (free === undefined) throw new Error("no unused key");
  return { kind: "key", code: free.name } as Binding;
}

/** A key the person could put a kept function on: one that holds nothing, else the first plain key. */
function somewhereElse(layout: Layout, slot: Slot): Slot {
  const layer = layout.layers[0];
  const empty = layer?.bindings.findIndex((b, i) => i !== slot.position && bindingFunctions(b, layout.tapDances).length === 0) ?? -1;
  const plain = layer?.bindings.findIndex((b, i) => i !== slot.position && b.kind === "key") ?? -1;
  return { layerId: slot.layerId, position: empty >= 0 ? empty : plain };
}

/** What the editor does: ask the validator, drop what can be dropped, and place a layer key it can't. */
function throughTheEditor(board: BoardDefinition, layout: Layout, slot: Slot, to: Binding) {
  const placements: Placement[] = [];
  const drops = new Map<string, string>();
  for (let round = 0; round < 6; round++) {
    const result = validate(board, layout, editorOps(slot, to, placements, drops));
    if (result.ok) return { result, placements, drops };
    const touched = [slot, ...placements.map((p) => p.slot)];
    for (const lost of splitLost(lostFunctionsIn(result), touched).direct) {
      const binding = placeableBinding(layout, lost);
      if (!canDrop(lost, layout, result) && binding !== null) placements.push({ function: lost.function, slot: somewhereElse(layout, slot), binding });
      else drops.set(lost.function, dropReason("a new key", layout, slot));
    }
  }
  return { result: validate(board, layout, editorOps(slot, to, placements, drops)), placements, drops };
}

describe.each(layouts)("every base-layer key on $name can be changed through the editor", ({ board, layout }) => {
  const base = layout.layers[0];
  test("with the drop and place choices the editor offers", () => {
    const to = unusedKey(layout);
    const failures: string[] = [];
    for (const position of base?.bindings.keys() ?? []) {
      const { result } = throughTheEditor(board, layout, { layerId: base?.id ?? "", position }, to);
      if (!result.ok) failures.push(`key ${position + 1}: ${result.errors.map((e) => e.message).join(" | ")}`);
    }
    expect(failures).toEqual([]);
  });
});

describe("the F16 to F17 walk-through on BK's Moonlander", () => {
  const { board, layout } = layouts[0] as (typeof layouts)[number];
  const slot = { layerId: "layer-0", position: 6 };
  const f17: Binding = { kind: "key", code: "F17" };

  test("is refused until F16 is dropped, and the refusal carries the sentence and the function", () => {
    const refused = validate(board, layout, editorOps(slot, f17, [], new Map()));
    expect(refused.ok).toBe(false);
    const lost = lostFunctionsIn(refused);
    expect(lost.map((l) => l.function)).toEqual(["key:F16"]);
    const issue = refused.errors.find((e) => e.code === "function_lost");
    // The raw text keeps the CLI contract; the people text is a separate field.
    expect(issue?.message).toContain('layer "layer-0", position 6');
    expect(issue?.plain).toBeDefined();
    expect(issue?.plain).not.toMatch(/layer-\d|position \d/);
  });

  test("goes through with the drop op and names the drop in the diff", () => {
    const drops = new Map([["key:F16", dropReason("F17", layout, slot)]]);
    const result = validate(board, layout, editorOps(slot, f17, [], drops));
    expect(result.ok).toBe(true);
    expect(result.diff.dropped).toEqual([{ function: "key:F16", reason: "Replaced by F17 on key 7 of Layer 0" }]);
  });

  test("goes through when F16 is put on another key, which then has to be dropped or placed in turn", () => {
    const lost = lostFunctionsIn(validate(board, layout, editorOps(slot, f17, [], new Map())))[0];
    expect(lost).toBeDefined();
    const binding = placeableBinding(layout, lost as NonNullable<typeof lost>);
    expect(binding).toEqual({ kind: "key", code: "F16" });
    const target = { layerId: "layer-0", position: 20 };
    const displaced = layout.layers[0]?.bindings[20] as Binding;
    const placed: Placement[] = [{ function: "key:F16", slot: target, binding: binding as Binding }];
    const next = validate(board, layout, editorOps(slot, f17, placed, new Map()));
    // What was on the target is now the lost function, so the same question comes round again.
    expect(lostFunctionsIn(next).map((l) => l.function)).toEqual(bindingFunctions(displaced, layout.tapDances));
    const drops = new Map(bindingFunctions(displaced, layout.tapDances).map((fn) => [fn, "Replaced by F16"]));
    expect(validate(board, layout, editorOps(slot, f17, placed, drops)).ok).toBe(true);
  });

  test("a combined change set is one change: the ops land in a single validate call, setBinding first and drops last", () => {
    const ops = editorOps(slot, f17, [{ function: "key:F16", slot: { layerId: "layer-0", position: 20 }, binding: { kind: "key", code: "F16" } }], new Map([["key:X", "r"]]));
    expect(ops.map((op) => op.op)).toEqual(["setBinding", "setBinding", "dropFunction"]);
  });
});

describe("every issue has a sentence for people", () => {
  test("none names a layer id or a zero-based position, across the errors and warnings these layouts raise", () => {
    for (const { board, layout } of layouts) {
      const base = layout.layers[0];
      const issues = [];
      for (const position of base?.bindings.keys() ?? []) {
        const slot = { layerId: base?.id ?? "", position };
        const r = validate(board, layout, editorOps(slot, unusedKey(layout), [], new Map()));
        issues.push(...r.errors, ...r.warnings);
      }
      expect(issues.length).toBeGreaterThan(0);
      const ids = layout.layers.map((l) => l.id);
      for (const issue of issues) {
        expect(issue.plain, issue.message).toBeDefined();
        for (const id of ids) expect(issue.plain, issue.message).not.toContain(id);
        expect(issue.plain, issue.message).not.toMatch(/position \d/);
      }
    }
  });
});
