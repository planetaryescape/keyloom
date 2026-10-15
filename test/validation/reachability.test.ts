import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { bindingFunctions } from "../../src/layout/functions.ts";
import { type Binding, type Layer, type Layout, LayoutSchema } from "../../src/layout/schema.ts";
import { functionHomes, layerGraph, reachableLayers, resolveBinding, trappedLayers } from "../../src/validation/reachability.ts";
import { evaluate, validate } from "../../src/validation/validate.ts";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";
import { dropFunctions } from "../helpers/ops.ts";
import { T, key, tiny, tinyBoard } from "../helpers/tiny.ts";

const at = (layerId: string, position: number) => ({ layerId, position });
const set = (layerId: string, position: number, binding: Binding): ChangeOp => ({ op: "setBinding", at: at(layerId, position), binding });
const layer = (action: "momentary" | "toggle" | "to" | "oneShot", layerId: string): Binding => ({ kind: "layer", action, layerId });
const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);
const doc = (layers: Array<[string, Binding[]]>, over: Partial<Layout> = {}): Layout =>
  tiny({ layers: layers.map(([id, bindings]): Layer => ({ id, name: id, bindings })), combos: [], macros: [], ...over });
const four = (...bs: Binding[]): Binding[] => [...bs, ...Array.from({ length: 4 - bs.length }, () => T)];

describe("layer graph and reachable layers", () => {
  test("every kind of layer key is an edge, and so is a layer-tap hold", () => {
    const l = doc([
      ["base", four(layer("momentary", "a"), layer("toggle", "b"), layer("to", "c"), layer("oneShot", "d"))],
      ["a", four()], ["b", four()], ["c", four()], ["d", four()],
    ]);
    expect(layerGraph(l).map((e) => [e.to, e.action])).toEqual([["a", "momentary"], ["b", "toggle"], ["c", "to"], ["d", "oneShot"]]);
    expect([...reachableLayers(l)].sort()).toEqual(["a", "b", "base", "c", "d"]);
    const lt = doc([["base", four({ kind: "holdTap", tap: { code: "A" }, hold: { layerId: "a" }, profileId: "p" })], ["a", four()]]);
    expect(layerGraph(lt)).toMatchObject([{ from: "base", to: "a", action: "momentary" }]);
  });

  test("an edge only counts from a layer that is itself reachable", () => {
    const l = doc([["base", four(layer("momentary", "a"))], ["a", four(layer("momentary", "b"))], ["b", four()], ["island", four(layer("momentary", "b"), layer("momentary", "base"))]]);
    expect([...reachableLayers(l)].sort()).toEqual(["a", "b", "base"]);
  });

  test("a combo whose output is a layer key reaches the layer from the layers it is scoped to", () => {
    const output = layer("momentary", "a");
    const combo = (layerIds: "all" | string[]) => ({ id: "c", name: "C", positions: [0, 1], layerIds, output });
    const layers: Array<[string, Binding[]]> = [["base", four()], ["a", four()], ["b", four()]];
    expect(reachableLayers(doc(layers, { combos: [combo("all")] })).has("a")).toBe(true);
    expect(reachableLayers(doc(layers, { combos: [combo(["base"])] })).has("a")).toBe(true);
    // Scoped to a layer nothing reaches, the combo is never live.
    expect(reachableLayers(doc(layers, { combos: [combo(["b"])] })).has("a")).toBe(false);
  });

  test("references to layers that don't exist are ignored, not followed", () => {
    expect([...reachableLayers(doc([["base", four(layer("to", "ghost"))]]))]).toEqual(["base"]);
  });
});

describe("transparent fall-through", () => {
  const stack = doc([["base", four(key("A"), T, T)], ["l1", four(T, key("B"), T)], ["l2", four(T, T, T)], ["l3", four(key("C"), T, T)]]);

  test("a chain of transparent keys falls to the base layer's binding", () => {
    expect(resolveBinding(stack, 2, 0)).toEqual(key("A"));
    expect(resolveBinding(stack, 2, 0, () => true)).toEqual(key("A"));
  });

  test("only active layers are looked through, and the base always is", () => {
    expect(resolveBinding(stack, 2, 1)).toBeUndefined();
    expect(resolveBinding(stack, 2, 1, (id) => id === "l1")).toEqual(key("B"));
    expect(resolveBinding(stack, 3, 0)).toEqual(key("C"));
    expect(resolveBinding(stack, 3, 1, (id) => id === "l1")).toEqual(key("B"));
  });

  test("transparent on the base layer is nothing", () => {
    expect(resolveBinding(stack, 0, 2)).toBeUndefined();
    expect(resolveBinding(stack, 3, 2, () => true)).toBeUndefined();
  });

  test("transparent adds no function of its own", () => {
    // All four layers counted as reachable: the set is the physical bindings, nothing from fall-through.
    expect([...functionHomes(stack, new Set(["base", "l1", "l2", "l3"])).keys()].sort()).toEqual(["key:A", "key:B", "key:C"]);
  });
});

describe("layer_unreachable", () => {
  test("removing the only key that reaches a layer is an error naming the layer", () => {
    const r = validate(tinyBoard, tiny(), [...dropFunctions(["layer:momentary:num", "key:N1", "key:N2", "key:N4"]), set("base", 2, key("Q"))]);
    expect(codes(r.errors)).toEqual(["layer_unreachable"]);
    expect(r.errors[0]?.message).toContain('"num"');
  });

  test("a layer that was already unreachable is a warning, and a second one is an error", () => {
    const before = doc([["base", four(key("A"), layer("momentary", "a"))], ["a", four(key("B"))], ["lost", four(key("C"))], ["lost2", four(key("D"))]]);
    const r = validate(tinyBoard, before, [...dropFunctions(["layer:momentary:a", "key:B"]), set("base", 1, key("Q"))]);
    expect(r.errors.map((e) => e.message)).toEqual([expect.stringContaining('"a"')]);
    expect(r.warnings.map((w) => w.message).sort()).toEqual([expect.stringContaining('"lost"'), expect.stringContaining('"lost2"')]);
    expect(validate(tinyBoard, before, [set("base", 2, key("Q"))]).ok).toBe(true);
  });

  test("a new layer is unreachable until something switches to it", () => {
    const add: ChangeOp = { op: "addLayer", layer: { id: "fn", name: "Fn" }, afterLayerId: "nav" };
    expect(codes(validate(tinyBoard, tiny(), [add]).errors)).toEqual(["layer_unreachable"]);
    expect(validate(tinyBoard, tiny(), [add, set("nav", 2, layer("momentary", "fn"))]).ok).toBe(true);
  });
});

describe("layer_trap", () => {
  const withNav = (navKeys: Binding[], baseKeys: Binding[] = four(key("A"), key("B"), layer("toggle", "nav"))): Layout => doc([["base", baseKeys], ["nav", navKeys]]);

  test("a toggled layer with no way back is a trap, and names the key that enters it", () => {
    const r = trappedLayers(withNav(four(key("X"), key("Y"), key("Z"))));
    expect(r).toMatchObject([{ layerId: "nav", entered: [{ slot: at("base", 2), action: "toggle" }] }]);
  });

  test("the toggle key left transparent on the layer is the way back, via the base layer's key", () => {
    expect(trappedLayers(withNav(four(key("X"), key("Y"), T)))).toEqual([]);
  });

  test("to base, toggling itself off, and to another layer that can be left are ways back", () => {
    expect(trappedLayers(withNav(four(key("X"), key("Y"), layer("to", "base"))))).toEqual([]);
    expect(trappedLayers(withNav(four(key("X"), key("Y"), layer("toggle", "nav"))))).toEqual([]);
    const two = doc([["base", four(layer("to", "a"))], ["a", four(layer("to", "b"))], ["b", four(layer("to", "base"))]]);
    expect(trappedLayers(two)).toEqual([]);
    const loop = doc([["base", four(layer("to", "a"))], ["a", four(layer("to", "b"))], ["b", four(layer("to", "a"))]]);
    expect(trappedLayers(loop).map((t) => t.layerId)).toEqual(["a", "b"]);
  });

  test("a momentary hold on the layer is not a way back, and momentary layers never trap", () => {
    expect(trappedLayers(withNav(four(key("X"), key("Y"), layer("momentary", "base"))))).toHaveLength(1);
    expect(trappedLayers(withNav(four(key("X")), four(layer("momentary", "nav"))))).toEqual([]);
    expect(trappedLayers(withNav(four(key("X")), four({ kind: "holdTap", tap: { code: "A" }, hold: { layerId: "nav" }, profileId: "p" })))).toEqual([]);
  });

  test("a combo on the layer can be the way back", () => {
    const combo = { id: "c", name: "C", positions: [0, 1], layerIds: ["nav"], output: layer("to", "base") };
    expect(trappedLayers({ ...withNav(four(key("X"), key("Y"), key("Z"))), combos: [combo] })).toEqual([]);
  });

  test("the rule rejects a change that traps, and passes a pre-existing trap as a warning", () => {
    const ok = withNav(four(key("X"), key("Y"), T));
    const r = validate(tinyBoard, ok, [...dropFunctions(["key:X"]), set("nav", 2, key("Z"))]);
    expect(codes(r.errors)).toEqual(["layer_trap"]);
    const trapped = withNav(four(key("X"), key("Y"), key("Z")));
    const after = validate(tinyBoard, trapped, [...dropFunctions(["key:X"]), set("nav", 0, key("Q"))]);
    expect(after.ok).toBe(true);
    expect(codes(after.warnings)).toEqual(["layer_trap"]);
  });
});

describe("function_lost", () => {
  test("overwriting the only copy of a function is an error naming where it was", () => {
    const r = validate(tinyBoard, tiny(), [set("num", 0, key("Q"))]);
    expect(r.errors).toMatchObject([{ code: "function_lost", slots: [at("num", 0)] }]);
    expect(r.errors[0]?.message).toContain("key:N1");
  });

  test("a copy elsewhere on a reachable layer keeps it", () => {
    expect(validate(tinyBoard, tiny(), [set("base", 0, key("Q"))]).ok).toBe(true); // nav repeats A
  });

  test("a dropFunction op licenses the loss and is reported in the diff with its reason", () => {
    const drop: ChangeOp = { op: "dropFunction", function: "key:N1", reason: "never use it" };
    const r = validate(tinyBoard, tiny(), [drop, set("num", 0, key("Q"))]);
    expect(r.ok).toBe(true);
    expect(r.diff.dropped).toEqual([{ function: "key:N1", reason: "never use it" }]);
    // Naming a function does not license losing a different one.
    expect(codes(validate(tinyBoard, tiny(), [drop, set("num", 1, key("Q"))]).errors)).toEqual(["function_lost"]);
  });

  test("functions on a layer that stops being reachable are lost with it", () => {
    const r = validate(tinyBoard, tiny(), [set("base", 2, key("Q"))]);
    expect(codes(r.errors).sort()).toEqual(["function_lost", "function_lost", "function_lost", "function_lost", "layer_unreachable"]);
  });

  test("a function on a layer that was unreachable before was never reachable, so it can go", () => {
    const before = doc([["base", four(key("A"))], ["orphan", four(key("Z"))]]);
    const r = validate(tinyBoard, before, [set("orphan", 0, key("Q"))]);
    expect(r.errors).toEqual([]);
  });

  test("a combo output is a function too", () => {
    const combo = { id: "c", name: "C", positions: [0, 1], layerIds: "all" as const, output: key("ESCAPE") };
    const before = tiny({ combos: [...tiny().combos, combo] });
    expect(codes(validate(tinyBoard, before, [{ op: "removeCombo", comboId: "c" }]).errors)).toEqual(["function_lost"]);
    const r = validate(tinyBoard, before, [set("base", 0, key("ESCAPE")), { op: "removeCombo", comboId: "c" }]);
    expect(r.ok).toBe(true);
  });

  test("both halves of a hold-tap count", () => {
    const before = doc([["base", four({ kind: "holdTap", tap: { code: "S" }, hold: { mods: ["LALT"] }, profileId: "p" }, key("S"))]]);
    const r = validate(tinyBoard, before, [set("base", 0, key("S"))]);
    expect(r.errors.map((e) => e.message).join()).toContain("mod:LALT");
    expect(r.errors).toHaveLength(1);
  });
});

describe("diff.displaced and relearnCount", () => {
  test("a swap moves two functions, each to the other's slot", () => {
    const r = validate(tinyBoard, tiny(), [{ op: "swapBindings", a: at("num", 0), b: at("num", 1) }]);
    expect(r.diff.displaced).toEqual([
      { function: "key:N1", from: at("num", 0), to: at("num", 1) },
      { function: "key:N2", from: at("num", 1), to: at("num", 0) },
    ]);
    expect(r.diff.relearnCount).toBe(2);
  });

  test("a function with nowhere to go is displaced to null, and counts as dropped, not relearned", () => {
    const r = validate(tinyBoard, tiny(), [...dropFunctions(["key:N1"]), set("num", 0, key("Q"))]);
    expect(r.diff.displaced).toEqual([{ function: "key:N1", from: at("num", 0), to: null }]);
    expect(r.diff.relearnCount).toBe(0);
  });

  test("moving a key to a free slot is one function relearned", () => {
    const r = validate(tinyBoard, tiny(), [{ op: "moveBinding", from: at("num", 0), to: at("num", 2) }]);
    expect(r.diff.displaced).toEqual([{ function: "key:N1", from: at("num", 0), to: at("num", 2) }]);
    expect(r.diff.relearnCount).toBe(1);
  });

  test("a change that moves nothing relearns nothing", () => {
    const r = validate(tinyBoard, tiny(), [{ op: "renameLayer", layerId: "num", name: "X" }]);
    expect(r.diff).toMatchObject({ displaced: [], relearnCount: 0 });
  });
});

describe("doubled_letter_tapdance", () => {
  const dance = (letter: string) => `void dance_0_finished(tap_dance_state_t *state, void *user_data) {\n  switch (dance_state[0].step) {\n    case SINGLE_TAP: register_code16(KC_${letter}); break;\n    case DOUBLE_TAP: register_code16(KC_LALT); break;\n  }\n}\nvoid dance_0_reset(tap_dance_state_t *state, void *user_data) {}`;
  const withDance = (letter: string): Layout => {
    const l = tiny({ passthrough: [{ firmware: "qmk", file: "keymap.c", anchor: "tap-dance", source: `void dance_0_finished(tap_dance_state_t *state, void *user_data);\n${dance(letter)}`, refersToLayerIndices: false }] });
    (l.layers[0] as Layer).bindings[3] = { kind: "native", firmware: "qmk", source: "TD(DANCE_0)", label: "TD0" };
    return l;
  };
  const move: ChangeOp[] = [{ op: "swapBindings", a: at("base", 3), b: at("base", 1) }];

  test("a tap dance whose single tap is a doubling letter warns when the change puts it somewhere", () => {
    const r = validate(tinyBoard, withDance("S"), move);
    expect(r.ok).toBe(true);
    expect(r.warnings).toMatchObject([{ code: "doubled_letter_tapdance", slots: [at("base", 1)] }]);
    expect(r.warnings[0]?.message).toContain("class");
  });

  test("a letter that doesn't double, or a dance already there, is quiet", () => {
    expect(validate(tinyBoard, withDance("Q"), move).warnings).toEqual([]);
    expect(validate(tinyBoard, withDance("S"), [{ op: "renameLayer", layerId: "num", name: "X" }]).warnings).toEqual([]);
  });
});

describe("BK's Moonlander import", async () => {
  const board = (await moonlander()).definition;
  const { layout } = await importOryxSource(FIXTURE_DIR, board);

  test("every layer is reachable, none traps, and the unchanged layout raises nothing", () => {
    expect([...reachableLayers(layout)].sort()).toEqual(layout.layers.map((l) => l.id).sort());
    expect(trappedLayers(layout)).toEqual([]);
    expect(validate(board, layout, [])).toMatchObject({ ok: true, errors: [], warnings: [] });
  });

  test("layer-5 is reached only by a native layer-tap defined in a #define, and the analysis sees it", () => {
    const into = layerGraph(layout).filter((e) => e.to === "layer-5");
    expect(into).toMatchObject([{ from: "layer-0", action: "momentary", slot: at("layer-0", 7) }]);
    expect(layout.layers[0]?.bindings[7]).toMatchObject({ kind: "native", source: "DUAL_FUNC_0" });
  });

  test("layer-4 is entered by one toggle key, and removing it is layer_unreachable", () => {
    const into = layerGraph(layout).filter((e) => e.to === "layer-4");
    expect(into).toMatchObject([{ from: "layer-0", action: "toggle", slot: at("layer-0", 65) }]);
    const r = validate(board, layout, [set("layer-0", 65, { kind: "none" })]);
    expect(r.ok).toBe(false);
    expect(codes(r.errors)).toContain("layer_unreachable");
  });

  test("stripping every route to the number layer is layer_unreachable", () => {
    const routes = layerGraph(layout).filter((e) => e.to === "layer-1" && e.slot);
    expect(routes.length).toBeGreaterThan(1);
    const ops = routes.map((e): ChangeOp => set(e.slot?.layerId ?? "", e.slot?.position ?? 0, { kind: "none" }));
    expect(codes(validate(board, layout, ops).errors)).toContain("layer_unreachable");
    // One route fewer is not enough to strand it.
    const left = validate(board, layout, ops.slice(1));
    expect(codes(left.errors)).not.toContain("layer_unreachable");
  });

  test("moving a key keeps every function", () => {
    const r = validate(board, layout, [{ op: "swapBindings", a: at("layer-0", 6), b: at("layer-0", 8) }]);
    expect(r).toMatchObject({ ok: true, errors: [], warnings: [], diff: { relearnCount: 2 } });
  });
});

describe("property: a valid change set leaves every layer reachable and loses nothing unannounced", () => {
  const ids = ["l0", "l1", "l2", "l3"];
  const keys = ["A", "B", "C", "D", "E"];
  const plain = fc.oneof(fc.constantFrom(...keys).map(key), fc.constant(T), fc.constant<Binding>({ kind: "none" }));
  const switcher = (n: number) =>
    fc.record({ kind: fc.constant("layer" as const), action: fc.constantFrom("momentary", "toggle", "to", "oneShot" as const), layerId: fc.constantFrom(...ids.slice(0, n)) });
  const layout = fc.integer({ min: 2, max: 4 }).chain((n) =>
    fc.tuple(...Array.from({ length: n }, (_, i) => fc.array(fc.oneof({ weight: 3, arbitrary: plain }, { weight: 1, arbitrary: switcher(n) }), { minLength: 4, maxLength: 4 }).map((bs) => (i === 0 ? bs.map((b, p) => (p < n - 1 ? layer("momentary", ids[p + 1] as string) : b)) : bs)))).map((all) =>
      doc(all.map((bindings, i): [string, Binding[]] => [ids[i] as string, bindings])),
    ),
  );
  const slot = fc.record({ layerId: fc.constantFrom(...ids), position: fc.integer({ min: 0, max: 3 }) });
  const fn = fc.oneof(fc.constantFrom(...keys).map((k) => `key:${k}`), fc.constantFrom(...ids).map((id) => `layer:momentary:${id}`));
  const op: fc.Arbitrary<ChangeOp> = fc.oneof(
    { weight: 6, arbitrary: fc.record({ op: fc.constant("setBinding" as const), at: slot, binding: fc.oneof(plain, switcher(4)) }) },
    { weight: 2, arbitrary: fc.record({ op: fc.constant("moveBinding" as const), from: slot, to: slot }) },
    { weight: 2, arbitrary: fc.record({ op: fc.constant("swapBindings" as const), a: slot, b: slot }) },
    { weight: 1, arbitrary: fc.record({ op: fc.constant("removeLayer" as const), layerId: fc.constantFrom(...ids) }) },
    { weight: 1, arbitrary: fc.record({ op: fc.constant("addLayer" as const), layer: fc.record({ id: fc.constantFrom("l4", "l5"), name: fc.constant("N") }), afterLayerId: fc.constantFrom(...ids) }) },
    { weight: 3, arbitrary: fc.record({ op: fc.constant("dropFunction" as const), function: fn, reason: fc.constant("r") }) },
  );

  // Written separately from reachability.ts: grow the set of reached layers until nothing is added.
  const oracleReachable = (l: Layout): Set<string> => {
    const seen = new Set([l.layers[0]?.id as string]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const ly of l.layers.filter((x) => seen.has(x.id))) {
        for (const b of ly.bindings) {
          const target = b.kind === "layer" ? b.layerId : b.kind === "holdTap" && "layerId" in b.hold ? b.hold.layerId : undefined;
          if (target && l.layers.some((x) => x.id === target) && !seen.has(target)) {
            seen.add(target);
            grew = true;
          }
        }
      }
    }
    return seen;
  };

  test("random layouts and op lists", () => {
    let valid = 0;
    let started = 0;
    fc.assert(
      fc.property(layout, fc.array(op, { minLength: 1, maxLength: 4 }), (before, ops) => {
        // The property is about changes to a sound layout; a layout that starts with problems is out of scope.
        const start = validate(tinyBoard, before, []);
        fc.pre(start.ok && start.warnings.length === 0);
        started++;
        const { result, after } = evaluate(tinyBoard, before, ops);
        if (!result.ok) return;
        valid++;
        expect(after).not.toBeNull();
        const saved = after as Layout;
        expect(LayoutSchema.safeParse(saved).success).toBe(true);
        expect([...oracleReachable(saved)].sort()).toEqual(saved.layers.map((l) => l.id).sort());
        const dropped = new Set(ops.flatMap((o) => (o.op === "dropFunction" ? [o.function] : [])));
        const reachableAfter = functionHomes(saved);
        for (const f of functionHomes(before).keys()) expect(reachableAfter.has(f) || dropped.has(f)).toBe(true);
        for (const d of result.diff.dropped) expect(dropped.has(d.function)).toBe(true);
      }),
      { numRuns: 200 },
    );
    expect(started).toBeGreaterThan(20);
    expect(valid).toBeGreaterThan(5);
  });
});
