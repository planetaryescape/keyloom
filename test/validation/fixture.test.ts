import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { deepEqual } from "../../src/layout/equal.ts";
import { applyOps } from "../../src/layout/apply-ops.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { KEYCODES, isKeyCode } from "../../src/layout/keycodes.ts";
import { bindingFunctions } from "../../src/layout/functions.ts";
import { type Binding, LayoutSchema, ModSchema } from "../../src/layout/schema.ts";
import { evaluate, validate } from "../../src/validation/validate.ts";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";
import { addReachableLayer, dropFunctions } from "../helpers/ops.ts";

const board = (await moonlander()).definition;
const { layout } = await importOryxSource(FIXTURE_DIR, board);
const at = (layerId: string, position: number) => ({ layerId, position });
const set = (layerId: string, position: number, binding: Binding): ChangeOp => ({ op: "setBinding", at: at(layerId, position), binding });
const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);

describe("validate on BK's Moonlander import", () => {
  test("the import itself raises nothing, so any edit starts from a clean layout", () => {
    const r = validate(board, layout, [set("layer-0", 6, { kind: "key", code: "F16" })]);
    expect(r).toMatchObject({ ok: true, errors: [], warnings: [] });
    expect(validate(board, layout, [])).toMatchObject({ ok: true, errors: [], warnings: [] });
    expect(r.diff.changed).toEqual([]);
  });

  test("F16 to F17 on layer 0 position 6 changes that slot only", () => {
    const r = validate(board, layout, [...dropFunctions(["key:F16"]), set("layer-0", 6, { kind: "key", code: "F17" })]);
    expect(r.ok).toBe(true);
    expect(r.diff.changed).toEqual([at("layer-0", 6)]);
  });

  test("an Oryx tap-dance key is a tap dance whose slots are functions, found elsewhere on layer 1", () => {
    const td = layout.layers[0]?.bindings[34];
    expect(td).toEqual({ kind: "tapDance", tapDanceId: "dance-0" });
    expect(bindingFunctions(td as Binding, layout.tapDances)).toEqual(["key:SPACE+LCTL+LSFT+LALT+LGUI", "key:LEFT_BRACKET"]);
    // Hyper+Space and [ are also on layer 1, so nothing is lost by replacing the dance.
    expect(validate(board, layout, [set("layer-0", 34, { kind: "key", code: "A" })]).ok).toBe(true);
    // Without those copies the dance's slots would be the only ones: take them away and the loss shows.
    const stripped = [set("layer-1", 34, { kind: "none" }), set("layer-1", 46, { kind: "none" })];
    const lost = validate(board, layout, [...stripped, set("layer-0", 34, { kind: "key", code: "A" })]);
    expect(codes(lost.errors)).toContain("function_lost");
  });

  test("a native key can be replaced by a plain key, but not by other source", () => {
    expect(layout.layers[0]?.bindings[7]).toMatchObject({ kind: "native", source: "DUAL_FUNC_0" });
    const mouse = layout.layers[3]?.bindings[30];
    expect(mouse).toMatchObject({ kind: "native", source: "KC_MS_BTN2" });
    const drop = dropFunctions(["native:qmk:KC_MS_BTN2"]);
    expect(validate(board, layout, [...drop, set("layer-3", 30, { kind: "key", code: "A" })]).ok).toBe(true);
    const r = validate(board, layout, [...drop, set("layer-3", 30, { kind: "native", firmware: "qmk", source: "KC_MS_BTN9", label: "Btn9" })]);
    expect(codes(r.errors)).toEqual(["native_edit"]);
  });

  test("the importer reads which numbers in kept code are layers, and the 8-bit layer state caps the count", () => {
    expect(codes(validate(board, layout, [{ op: "removeLayer", layerId: "layer-5" }]).errors)).toContain("passthrough_layer_index");
    const add = addReachableLayer;
    expect(validate(board, layout, [...add("layer-6", "layer-5"), ...add("layer-7", "layer-6")]).ok).toBe(true); // 8 layers
    const nine = validate(board, layout, [...add("layer-6", "layer-5"), ...add("layer-7", "layer-6"), ...add("layer-8", "layer-7")]);
    expect(codes(nine.errors)).toEqual(["layer_limit"]);
    // Inserting shifts every layer number after it, but the kept code follows its layers (D-360): the native LT(5, KC_4)
    // is renumbered with layer-5, which the key still reaches.
    expect(validate(board, layout, add("layer-6", "layer-0")).errors).toEqual([]);
  });

  test("a mod-tap with a modified tap is refused", () => {
    const bad: Binding = { kind: "holdTap", tap: { code: "A", mods: ["LSFT"] }, hold: { mods: ["LGUI"] }, profileId: "mod-tap" };
    expect(codes(validate(board, layout, [...dropFunctions(["key:F16"]), set("layer-0", 6, bad)]).errors)).toEqual(["qmk_modtap_basic"]);
  });
});

const keyNames = KEYCODES.map((k) => k.name);
const layerIds = [...layout.layers.map((l) => l.id), "ghost"];
const mods = fc.uniqueArray(fc.constantFrom(...ModSchema.options), { minLength: 1, maxLength: 4 });
const code = fc.oneof({ weight: 9, arbitrary: fc.constantFrom(...keyNames) }, { weight: 1, arbitrary: fc.string({ minLength: 1, maxLength: 8 }) });
const binding: fc.Arbitrary<Binding> = fc.oneof(
  fc.record({ kind: fc.constant("key" as const), code, mods: fc.option(mods, { nil: undefined }) }),
  fc.record({ kind: fc.constant("modifier" as const), mods }),
  fc.record({
    kind: fc.constant("holdTap" as const),
    tap: fc.record({ code, mods: fc.option(mods, { nil: undefined }) }),
    hold: fc.oneof(fc.record({ mods }), fc.record({ layerId: fc.constantFrom(...layerIds) })),
    profileId: fc.constantFrom("home-row-mods", "mod-tap", "layer-tap", "ghost"),
  }),
  fc.record({ kind: fc.constant("layer" as const), action: fc.constantFrom("momentary", "toggle", "to", "oneShot" as const), layerId: fc.constantFrom(...layerIds) }),
  fc.record({ kind: fc.constant("macro" as const), macroId: fc.constantFrom("ST_MACRO_0", "ghost") }),
  fc.constant({ kind: "transparent" as const }),
  fc.constant({ kind: "none" as const }),
  fc.record({ kind: fc.constant("native" as const), firmware: fc.constantFrom("qmk", "zmk" as const), source: fc.string({ minLength: 1, maxLength: 6 }), label: fc.string({ minLength: 1, maxLength: 3 }) }),
);
const slot = fc.record({ layerId: fc.constantFrom(...layerIds), position: fc.integer({ min: 0, max: 74 }) });
const op: fc.Arbitrary<ChangeOp> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ op: fc.constant("setBinding" as const), at: slot, binding }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("moveBinding" as const), from: slot, to: slot }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("swapBindings" as const), a: slot, b: slot }) },
);

describe("property: validate and apply agree on real layouts", () => {
  test("random setBinding, move and swap ops: either validate fails, or the saved document is sound", () => {
    let valid = 0;
    fc.assert(
      fc.property(fc.array(op, { minLength: 1, maxLength: 4 }), (ops) => {
        const snapshot = JSON.stringify(layout);
        const { result, after } = evaluate(board, layout, ops);
        expect(JSON.stringify(layout)).toBe(snapshot);
        valid += result.ok ? 1 : 0;
        if (!result.ok) return;
        // The two ways to get the document agree, and it parses.
        const applied = applyOps(layout, ops);
        expect(applied.ok).toBe(true);
        expect(after).not.toBeNull();
        expect(LayoutSchema.safeParse(applied.ok ? applied.layout : null).success).toBe(true);
        for (const l of (after ?? layout).layers) {
          expect(l.bindings).toHaveLength(board.keyCount);
          for (const b of l.bindings) {
            if (b.kind === "key") expect(isKeyCode(b.code)).toBe(true);
            if (b.kind === "holdTap" && "mods" in b.hold) expect(b.tap.mods ?? []).toEqual([]);
            if (b.kind === "native") expect(b.firmware).toBe("qmk");
          }
        }
        // Every changed slot really differs, and nothing else does.
        const changed = new Set(result.diff.changed.map((s) => `${s.layerId}:${s.position}`));
        for (const l of (after ?? layout).layers) {
          const was = layout.layers.find((x) => x.id === l.id);
          l.bindings.forEach((b, p) => {
            expect(changed.has(`${l.id}:${p}`)).toBe(!deepEqual(b, was?.bindings[p]));
          });
        }
      }),
      { numRuns: 400 },
    );
    // The property is vacuous if nothing ever passes validation.
    expect(valid).toBeGreaterThan(50);
  });
});
