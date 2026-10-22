import { describe, expect, test } from "bun:test";
import { applyOps } from "../../src/layout/apply-ops.ts";
import type { BoardDefinition } from "../../src/boards/schema.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import type { Binding, Layer, Layout } from "../../src/layout/schema.ts";
import { ValidationResultSchema } from "../../src/validation/result.ts";
import { evaluate, validate } from "../../src/validation/validate.ts";
import { addReachableLayer, dropFunctions } from "../helpers/ops.ts";
import { T, key, tiny, tinyBoard } from "../helpers/tiny.ts";

const at = (layerId: string, position: number) => ({ layerId, position });
const set = (layerId: string, position: number, binding: Binding): ChangeOp => ({ op: "setBinding", at: at(layerId, position), binding });
const holdTap = (over: Partial<Extract<Binding, { kind: "holdTap" }>> = {}): Binding => ({
  kind: "holdTap", tap: { code: "F" }, hold: { mods: ["LGUI"] }, profileId: "p", ...over,
});
const native = (source: string): Binding => ({ kind: "native", firmware: "qmk", source, label: source });

const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);
const errorsOf = (ops: ChangeOp[], before = tiny(), board: BoardDefinition = tinyBoard) => validate(board, before, ops).errors;

/** A layout with `n` layers of 4 keys, for the layer limit. */
const withLayers = (n: number, over: Partial<Layout> = {}): Layout =>
  tiny({
    layers: Array.from({ length: n }, (_, i): Layer => ({ id: `l${i}`, name: `L${i}`, bindings: [T, T, T, T] })),
    macros: [],
    ...over,
  });

describe("validate: result shape and the diff", () => {
  test("a valid change is ok, with the changed slot and where A went (nav repeats it)", () => {
    const r = validate(tinyBoard, tiny(), [set("base", 0, key("Q"))]);
    expect(r).toEqual({
      ok: true, errors: [], warnings: [],
      diff: { changed: [at("base", 0)], displaced: [{ function: "key:A", from: at("base", 0), to: at("nav", 0) }], dropped: [], relearnCount: 1, retuned: [], reminders: [] },
    });
    expect(ValidationResultSchema.safeParse(r).success).toBe(true);
  });

  test("changed lists exactly the slots whose binding differs, by deep equality", () => {
    expect(validate(tinyBoard, tiny(), [set("base", 0, key("A"))]).diff.changed).toEqual([]);
    const r = validate(tinyBoard, tiny(), [{ op: "swapBindings", a: at("base", 0), b: at("num", 3) }]);
    expect(r.diff.changed).toEqual([at("base", 0), at("num", 3)]);
    const moved = validate(tinyBoard, tiny(), [{ op: "moveBinding", from: at("num", 0), to: at("num", 1) }]);
    expect(moved.diff.changed).toEqual([at("num", 0), at("num", 1)]);
    // Undoing a change within one op list leaves no trace.
    expect(validate(tinyBoard, tiny(), [set("base", 0, key("Q")), set("base", 0, key("A"))]).diff.changed).toEqual([]);
  });

  test("a binding whose optional mods are written differently is still the same binding", () => {
    const before = tiny({ layers: [{ id: "base", name: "B", bindings: [{ kind: "key", code: "A" }, T, T, T] }] });
    expect(validate(tinyBoard, before, [set("base", 0, { kind: "key", code: "A", mods: undefined })]).diff.changed).toEqual([]);
  });

  test("renaming or adding layers changes no slot", () => {
    expect(validate(tinyBoard, tiny(), [{ op: "renameLayer", layerId: "num", name: "X" }]).diff.changed).toEqual([]);
    const added = validate(tinyBoard, tiny(), addReachableLayer("fn", "nav"));
    expect(added.ok).toBe(true);
    expect(added.diff.changed).toEqual([]);
  });

  test("a failing change has an empty diff and does not mutate the layout", () => {
    const before = tiny();
    const snapshot = structuredClone(before);
    const r = validate(tinyBoard, before, [set("base", 0, key("NOPE"))]);
    expect(r.ok).toBe(false);
    expect(before).toEqual(snapshot);
  });

  test("evaluate hands back the document apply should save, parsed", () => {
    const e = evaluate(tinyBoard, tiny(), [set("base", 0, { ...key("Q"), extra: 1 } as unknown as Binding)]);
    expect(e.after?.layers[0]?.bindings[0]).toEqual(key("Q"));
    expect(evaluate(tinyBoard, tiny(), [set("ghost", 0, key("Q"))]).after).toBeNull();
  });
});

describe("validate: schema", () => {
  test("a malformed op is a schema error that names the op", () => {
    const bad = { op: "setBinding", at: { layerId: "base", position: -1 }, binding: key("A") } as ChangeOp;
    const [e] = errorsOf([set("base", 0, key("Q")), bad]);
    expect(e?.code).toBe("schema");
    expect(e?.message).toContain("op 1");
  });

  test("an op that names a missing layer or position is unknown_ref", () => {
    expect(codes(errorsOf([set("ghost", 0, key("A"))]))).toEqual(["unknown_ref"]);
    expect(codes(errorsOf([set("base", 4, key("A"))]))).toEqual(["unknown_ref"]);
  });

  test("a duplicate layer id and an empty layout are schema errors", () => {
    expect(codes(errorsOf([{ op: "addLayer", layer: { id: "num", name: "Dup" }, afterLayerId: "base" }]))).toEqual(["schema"]);
    const gone: ChangeOp[] = [{ op: "removeLayer", layerId: "base" }, { op: "removeLayer", layerId: "num" }, { op: "removeLayer", layerId: "nav" }];
    expect(codes(errorsOf(gone))).toContain("schema");
  });
});

describe("validate: binding_count", () => {
  test("a layer added to a layout whose layers are the wrong length is the wrong length too", () => {
    const wide = tiny();
    wide.layers[0]?.bindings.push(T); // layer "base" has 5 keys on a 4-key board
    const errors = errorsOf(addReachableLayer("fn", "nav"), wide);
    expect(codes(errors)).toEqual(["binding_count"]);
    expect(errors[0]?.message).toContain('"fn"');
  });
});

describe("validate: unknown_ref", () => {
  test("removing a layer that bindings point at names the bindings", () => {
    const [e] = errorsOf([{ op: "removeLayer", layerId: "num" }]);
    expect(e).toMatchObject({ code: "unknown_ref", slots: [at("base", 2)] });
  });

  test("layer, macro, hold-tap layer and profile references", () => {
    expect(codes(errorsOf([set("base", 0, { kind: "layer", action: "toggle", layerId: "ghost" })]))).toEqual(["unknown_ref"]);
    expect(codes(errorsOf([set("base", 0, { kind: "macro", macroId: "ghost" })]))).toEqual(["unknown_ref"]);
    expect(codes(errorsOf([set("base", 0, holdTap({ hold: { layerId: "ghost" } }))]))).toEqual(["unknown_ref"]);
    expect(codes(errorsOf([set("base", 0, holdTap({ profileId: "ghost" }))]))).toEqual(["unknown_ref"]);
    expect(errorsOf([set("base", 0, { kind: "macro", macroId: "m1" }), set("base", 1, holdTap({ hold: { layerId: "nav" } }))])).toEqual([]);
  });

  test("removing a macro or a profile that is still used", () => {
    expect(codes(errorsOf([set("base", 0, { kind: "macro", macroId: "m1" }), { op: "removeMacro", macroId: "m1" }]))).toEqual(["unknown_ref"]);
    expect(codes(errorsOf([set("base", 0, holdTap()), { op: "upsertHoldTapProfile", profile: { id: "q", name: "Q", firmware: "qmk", options: {} } }]))).toEqual([]);
  });

  test("combo positions and layers", () => {
    const combo = { id: "c", name: "C", positions: [2, 3], layerIds: "all" as const, output: key("ESCAPE") };
    expect(errorsOf([{ op: "upsertCombo", combo }])).toEqual([]);
    expect(codes(errorsOf([{ op: "upsertCombo", combo: { ...combo, positions: [0, 4] } }]))).toEqual(["unknown_ref"]);
    expect(codes(errorsOf([{ op: "upsertCombo", combo: { ...combo, layerIds: ["ghost"] } }]))).toEqual(["unknown_ref"]);
    expect(codes(errorsOf([{ op: "upsertCombo", combo: { ...combo, output: { kind: "layer", action: "to", layerId: "ghost" } } }]))).toEqual(["unknown_ref"]);
  });
});

describe("validate: firmware_unsupported", () => {
  test("a keycode that is not in the generated table", () => {
    expect(errorsOf([set("base", 0, key("NOPE"))])[0]).toMatchObject({ code: "firmware_unsupported", slots: [at("base", 0)] });
    expect(codes(errorsOf([set("base", 0, key("F16"))]))).toEqual([]);
    // Aliases are not accepted (D-044): the stored name is the canonical one.
    expect(codes(errorsOf([set("base", 0, key("KC_A"))]))).toEqual(["firmware_unsupported"]);
    expect(codes(errorsOf([set("base", 0, holdTap({ tap: { code: "NOPE" } }))]))).toEqual(["firmware_unsupported"]);
  });

  test("macro steps and combo outputs are checked too", () => {
    const macro = { id: "m1", name: "M", steps: [{ op: "tap" as const, code: "NOPE" }] };
    expect(codes(errorsOf([{ op: "upsertMacro", macro }]))).toEqual(["firmware_unsupported"]);
    const combo = { id: "c", name: "C", positions: [2, 3], layerIds: "all" as const, output: key("NOPE") };
    expect(codes(errorsOf([{ op: "upsertCombo", combo }]))).toEqual(["firmware_unsupported"]);
  });

  test("the other firmware's native bindings, profiles and settings", () => {
    const zmkNative: Binding = { kind: "native", firmware: "zmk", source: "&bt BT_CLR", label: "BT" };
    expect(codes(errorsOf([set("base", 0, zmkNative)]))).toContain("firmware_unsupported");
    expect(codes(errorsOf([{ op: "upsertHoldTapProfile", profile: { id: "z", name: "Z", firmware: "zmk", options: {} } }]))).toEqual(["firmware_unsupported"]);
    expect(codes(errorsOf([{ op: "setFirmwareSetting", setting: { firmware: "zmk", key: "X", value: 1 } }]))).toEqual(["firmware_unsupported"]);
  });

  test("a layout for one firmware on a board for the other", () => {
    const zmkBoard: BoardDefinition = { ...tinyBoard, firmware: "zmk" };
    expect(codes(errorsOf([set("base", 0, key("A"))], tiny(), zmkBoard))).toEqual([]); // already so: a warning, not a new error
    const r = validate(zmkBoard, tiny(), [set("base", 0, key("A"))]);
    expect(codes(r.warnings)).toEqual(["firmware_unsupported"]);
  });
});

describe("validate: QMK hold-taps", () => {
  test("qmk_modtap_basic: the tap side can't carry modifiers", () => {
    const [e] = errorsOf([set("base", 0, holdTap({ tap: { code: "N1", mods: ["LSFT"] } }))]);
    expect(e).toMatchObject({ code: "qmk_modtap_basic", slots: [at("base", 0)] });
    expect(codes(errorsOf([set("base", 0, holdTap({ tap: { code: "N1", mods: ["LSFT"] }, hold: { layerId: "nav" } }))]))).toEqual(["qmk_modtap_basic"]);
    expect(errorsOf([set("base", 0, holdTap({ tap: { code: "N1" } }))])).toEqual([]);
  });

  test("qmk_modtap_mixed_hands: all left or all right", () => {
    const hold = (...mods: Array<"LCTL" | "LSFT" | "LALT" | "LGUI" | "RCTL" | "RSFT" | "RALT" | "RGUI">) => [set("base", 0, holdTap({ hold: { mods } }))];
    expect(codes(errorsOf(hold("LSFT", "RALT")))).toEqual(["qmk_modtap_mixed_hands"]);
    expect(codes(errorsOf(hold("RGUI", "LCTL", "RSFT")))).toEqual(["qmk_modtap_mixed_hands"]);
    expect(errorsOf(hold("LCTL", "LSFT", "LALT", "LGUI"))).toEqual([]); // Hyper
    expect(errorsOf(hold("RCTL", "RSFT"))).toEqual([]);
    expect(errorsOf(hold("RALT"))).toEqual([]);
  });

  test("neither rule applies to a ZMK layout", () => {
    const zmkBoard: BoardDefinition = { ...tinyBoard, firmware: "zmk" };
    const zmk = tiny({ firmware: "zmk", holdTapProfiles: [{ id: "p", name: "P", firmware: "zmk", options: {} }] });
    const ops = [set("base", 0, holdTap({ tap: { code: "N1", mods: ["LSFT"] }, hold: { mods: ["LSFT", "RALT"] } }))];
    expect(errorsOf(ops, zmk, zmkBoard)).toEqual([]);
  });
});

describe("validate: passthrough_layer_index", () => {
  const pinned = (refersToLayerIndices: boolean) => tiny({ passthrough: [{ firmware: "qmk", file: "keymap.c", anchor: "rgb", source: "x", refersToLayerIndices }] });
  const add = (after: string, id = "fn"): ChangeOp[] => addReachableLayer(id, after);

  test("adding at the end is allowed; inserting before an existing layer is not", () => {
    expect(errorsOf(add("nav"), pinned(true))).toEqual([]);
    expect(codes(errorsOf(add("base"), pinned(true)))).toEqual(["passthrough_layer_index"]);
  });

  const removeNav: ChangeOp[] = [...dropFunctions(["layer:momentary:nav"]), { op: "removeLayer", layerId: "nav" }, { op: "removeCombo", comboId: "go-nav" }];
  const withSource = (source: string) => tiny({ passthrough: [{ firmware: "qmk", file: "keymap.c", anchor: "rgb", source, refersToLayerIndices: true }] });

  test("removing the last layer is allowed while no pinned block names its number", () => {
    expect(errorsOf(removeNav, pinned(true))).toEqual([]);
    expect(errorsOf(removeNav, withSource("case 1: set_layer_color(1); break; // colours 2 and 20"))).toEqual([]);
  });

  test("removing the last layer is refused when a pinned block names its number", () => {
    for (const source of ["case 2:", "ledmap[2]", "layer_move(2)", "if (layer == 2)", "x = LT(2, KC_A)", "&mo 2", "#define NAV 2"]) {
      expect(codes(errorsOf(removeNav, withSource(source)))).toEqual(["passthrough_layer_index"]);
    }
  });

  test("removing a layer that is not last, or replacing the last one, is refused", () => {
    expect(codes(errorsOf([...dropFunctions(["layer:momentary:num"]), { op: "removeLayer", layerId: "num" }], pinned(true)))).toContain("passthrough_layer_index");
    const replace: ChangeOp[] = [...removeNav, { op: "addLayer", layer: { id: "other", name: "Other" }, afterLayerId: "num" }];
    expect(codes(errorsOf(replace, withSource("x")))).toEqual(["passthrough_layer_index"]);
  });

  test("a layer added in one change can be removed in the next even though the block names other layers", () => {
    const added = validate(tinyBoard, withSource("case 1:"), add("nav"));
    expect(added.ok).toBe(true);
    const next = applyOps(withSource("case 1:"), add("nav"));
    if (!next.ok) throw new Error("add failed");
    expect(errorsOf([...dropFunctions(["layer:momentary:fn"]), { op: "removeLayer", layerId: "fn" }, { op: "removeCombo", comboId: "go-fn" }], next.layout)).toEqual([]);
  });

  test("moving a layer by removing and re-adding it is caught by the result, not the op names", () => {
    const ops: ChangeOp[] = [...dropFunctions(["key:N1", "key:N2", "key:N4"]), { op: "removeLayer", layerId: "num" }, { op: "addLayer", layer: { id: "num", name: "Numbers" }, afterLayerId: "nav" }];
    expect(codes(errorsOf(ops, pinned(true)))).toEqual(["passthrough_layer_index"]);
    // Added then removed again leaves the order alone.
    expect(errorsOf([...add("nav"), { op: "removeLayer", layerId: "fn" }, { op: "removeCombo", comboId: "go-fn" }], pinned(true))).toEqual([]);
  });

  test("a layout whose passthrough doesn't use layer numbers may reorder", () => {
    expect(errorsOf(add("base"), pinned(false))).toEqual([]);
    expect(errorsOf(add("base"), tiny())).toEqual([]);
  });

  test("renaming a layer is not reordering", () => {
    expect(errorsOf([{ op: "renameLayer", layerId: "num", name: "Digits" }], pinned(true))).toEqual([]);
  });
});

describe("validate: passthrough_layer_index with the layer numbers read (D-360)", () => {
  const code = "layer_move(1);\nif (get_highest_layer(s) == 2) {}\nlayer_state_set(1UL << 2);";
  const kept = (over: Partial<Layout["passthrough"][number]> = {}): Layout =>
    tiny({
      passthrough: [{
        firmware: "qmk", file: "keymap.c", anchor: "rgb", source: code, refersToLayerIndices: true,
        layerRefs: [{ start: 11, end: 12, layerId: "num" }, { start: 43, end: 44, layerId: "nav" }], ...over,
      }],
    });
  const move: ChangeOp[] = [{ op: "moveLayer", layerId: "nav", afterLayerId: "base" }];
  const removeNav: ChangeOp[] = [...dropFunctions(["layer:momentary:nav"]), { op: "removeLayer", layerId: "nav" }, { op: "removeCombo", comboId: "go-nav" }];
  const removeNum: ChangeOp[] = [...dropFunctions(["layer:momentary:num", "key:N1", "key:N2", "key:N4"]), set("base", 2, { kind: "none" }), { op: "removeLayer", layerId: "num" }];

  test("reordering and inserting pass, because the numbers follow the layers", () => {
    expect(errorsOf(move, kept())).toEqual([]);
    expect(errorsOf(addReachableLayer("fn", "base"), kept())).toEqual([]);
  });

  test("a layer nothing names can be removed from the middle", () => {
    expect(errorsOf(removeNum, kept({ layerRefs: [{ start: 43, end: 44, layerId: "nav" }] }))).toEqual([]);
  });

  test("removing a layer the code names is refused, naming the line", () => {
    const [e, ...rest] = errorsOf(removeNav, kept());
    expect(rest).toEqual([]);
    expect(e?.code).toBe("passthrough_layer_index");
    expect(e?.message).toContain("keymap.c rgb line 2 (if (get_highest_layer(s) == 2) {})");
    expect(e?.plain).toContain("Nav can't be removed");
  });

  test("a native key that names a layer blocks its removal, and the issue carries the key", () => {
    const key9: Binding = { kind: "native", firmware: "zmk", source: "&magic 2 0", label: "Magic", layerRefs: [{ start: 7, end: 8, layerId: "nav" }] };
    const layout = tiny({ layers: tiny().layers.map((l) => (l.id === "base" ? { ...l, bindings: [key("A"), key("B"), l.bindings[2] as Binding, key9] } : l)) });
    const [e] = errorsOf(removeNav, layout);
    expect(e?.code).toBe("passthrough_layer_index");
    expect(e?.slots).toEqual([at("base", 3)]);
    expect(e?.message).toContain('layer "base", position 3');
  });

  const stuck = { unprovable: [{ line: 3, text: "layer_state_set(1UL << 2);" }] };
  test("a line that uses a layer number in a way that can't be rewritten refuses a reorder, naming the line", () => {
    const [e] = errorsOf(move, kept(stuck));
    expect(e?.code).toBe("passthrough_layer_index");
    expect(e?.message).toContain("keymap.c rgb line 3 (layer_state_set(1UL << 2);)");
    expect(codes(errorsOf(removeNum, kept({ ...stuck, layerRefs: [{ start: 43, end: 44, layerId: "nav" }] })))).toEqual(["passthrough_layer_index"]);
  });

  test("adding at the end still passes beside such a line, since no layer's number changes", () => {
    expect(errorsOf(addReachableLayer("fn", "nav"), kept(stuck))).toEqual([]);
  });

  test("a layout stored before the numbers were read keeps the old refusal", () => {
    expect(codes(errorsOf(move, kept({ layerRefs: undefined })))).toEqual(["passthrough_layer_index"]);
  });

  test("a kept key written without the numbers is not the kept key that was imported", () => {
    const withRefs: Binding = { kind: "native", firmware: "qmk", source: "X(1)", label: "X", layerRefs: [{ start: 2, end: 3, layerId: "num" }] };
    const layout = tiny({ layers: tiny().layers.map((l) => (l.id === "num" ? { ...l, bindings: [withRefs, ...l.bindings.slice(1)] } : l)) });
    const copy: Binding = { kind: "native", firmware: "qmk", source: "X(1)", label: "X" };
    expect(codes(errorsOf([set("nav", 0, copy)], layout))).toContain("native_edit");
    expect(codes(errorsOf([set("nav", 0, withRefs)], layout))).not.toContain("native_edit");
  });
});

describe("validate: risky_native (warning, D-451)", () => {
  const risky = (ops: ChangeOp[], before = tiny()) => validate(tinyBoard, before, ops).warnings.filter((w) => w.code === "risky_native");

  test("a new bootloader key warns in words that follow its place, and does not block the change", () => {
    const r = validate(tinyBoard, tiny(), [set("base", 0, native("QK_BOOT"))]);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter((x) => x.code === "risky_native")).toEqual([{
      code: "risky_native",
      message: 'layer "base", position 0: QK_BOOT would put the keyboard into its bootloader when pressed',
      plain: "Left pinky, number row would put the keyboard into its bootloader when pressed",
      slots: [at("base", 0)],
    }]);
  });

  test("a new reset key and a new unpair-all key warn with their own effect", () => {
    expect(risky([set("base", 0, native("QK_REBOOT"))]).map((w) => w.plain)).toEqual([expect.stringContaining("would restart the keyboard when pressed")]);
    expect(risky([set("base", 0, { kind: "native", firmware: "zmk", source: "&bt BT_CLR_ALL", label: "CLR_ALL" })]).map((w) => w.plain)).toEqual([expect.stringContaining("would forget every paired Bluetooth device")]);
    expect(risky([set("base", 0, { kind: "native", firmware: "zmk", source: "&bt BT_CLR", label: "CLR" })]).map((w) => w.plain)).toEqual([expect.stringContaining("would forget the Bluetooth device paired on the current profile")]);
  });

  test("a key already in the layout does not warn again when another key is edited", () => {
    const before = tiny({ layers: tiny().layers.map((l) => (l.id === "base" ? { ...l, bindings: [native("QK_BOOT"), ...l.bindings.slice(1)] } : l)) });
    expect(risky([set("base", 1, key("B"))], before)).toEqual([]);
    expect(risky([{ op: "swapBindings", a: at("base", 0), b: at("base", 2) }], before)).toEqual([]);
  });

  test("one-shots, caps word and lighting keys never warn", () => {
    expect(risky([set("base", 0, native("OSM(MOD_LSFT)"))])).toEqual([]);
    expect(risky([set("base", 0, native("CW_TOGG"))])).toEqual([]);
    expect(risky([set("base", 0, native("RGB_TOG"))])).toEqual([]);
    expect(risky([set("base", 0, native("RGB_MODE_REVERSE"))])).toEqual([]);
    expect(risky([set("base", 0, { kind: "native", firmware: "zmk", source: "&sk LSHFT", label: "OS" })])).toEqual([]);
  });

  test("a Bluetooth select or next key does not warn, since it forgets nothing", () => {
    expect(risky([set("base", 0, { kind: "native", firmware: "zmk", source: "&bt BT_SEL 2", label: "BT2" })])).toEqual([]);
  });
});

describe("validate: layer_limit", () => {
  test("32 layers on QMK", () => {
    expect(errorsOf([{ op: "renameLayer", layerId: "l0", name: "x" }], withLayers(32))).toEqual([]);
    const [e] = errorsOf([{ op: "addLayer", layer: { id: "extra", name: "E" }, afterLayerId: "l31" }], withLayers(32));
    expect(e?.code).toBe("layer_limit");
    expect(e?.message).toContain("33");
  });

  test("8 when LAYER_STATE_8BIT is set, however the importer wrote the value", () => {
    const add = (after: string): ChangeOp[] => addReachableLayer("extra", after);
    const eight = (value: boolean | number | string) => withLayers(8, { settings: [{ firmware: "qmk", key: "LAYER_STATE_8BIT", value }] });
    expect(codes(errorsOf(add("l7"), eight(true)))).toEqual(["layer_limit"]);
    expect(codes(errorsOf(add("l7"), eight(1)))).toEqual(["layer_limit"]);
    expect(errorsOf(add("l6"), withLayers(7, { settings: [{ firmware: "qmk", key: "LAYER_STATE_8BIT", value: true }] }))).toEqual([]);
    // Written out as off, it caps nothing.
    expect(errorsOf(add("l7"), eight(false))).toEqual([]);
  });

  test("setting LAYER_STATE_8BIT on a layout that already has more than 8 layers is the change that breaks it", () => {
    const [e] = errorsOf([{ op: "setFirmwareSetting", setting: { firmware: "qmk", key: "LAYER_STATE_8BIT", value: true } }], withLayers(9));
    expect(e?.code).toBe("layer_limit");
  });

  test("ZMK has no layer limit in rung 2", () => {
    const zmkBoard: BoardDefinition = { ...tinyBoard, firmware: "zmk" };
    const zmk = withLayers(40, { firmware: "zmk", holdTapProfiles: [] });
    expect(errorsOf([{ op: "renameLayer", layerId: "l0", name: "x" }], zmk, zmkBoard)).toEqual([]);
  });
});

describe("validate: native_edit", () => {
  const withNative = () => {
    const l = tiny();
    (l.layers[0] as Layer).bindings[3] = native("TD(DANCE_0)");
    return l;
  };

  // Replacing the native key drops its function, which function_lost wants said out loud.
  const LOSE_TD = dropFunctions(["native:qmk:TD(DANCE_0)"]);

  test("a native key can be replaced whole by a modelled binding", () => {
    expect(errorsOf([...LOSE_TD, set("base", 3, key("F17"))], withNative())).toEqual([]);
    expect(errorsOf([...LOSE_TD, set("base", 3, T)], withNative())).toEqual([]);
  });

  test("it can't be replaced by native source keyloom never imported, even at the same slot", () => {
    const [e] = errorsOf([set("base", 3, native("TD(DANCE_9)"))], withNative());
    expect(e).toMatchObject({ code: "native_edit", slots: [at("base", 3)] });
    expect(codes(errorsOf([set("base", 0, native("DUAL_FUNC_9"))], withNative()))).toEqual(["native_edit"]);
  });

  test("a native keyloom reads on the layout's own firmware can be added, as a copy translates one (D-451)", () => {
    expect(errorsOf([set("base", 0, native("RGB_TOG"))], withNative())).toEqual([]);
    // Another firmware's native is still refused as an edit (and as an unsupported firmware).
    expect(codes(errorsOf([set("base", 0, { kind: "native", firmware: "zmk", source: "&caps_word", label: "CapsW" })], withNative()))).toContain("native_edit");
  });

  test("writing the same native binding back is not an edit", () => {
    expect(errorsOf([set("base", 3, native("TD(DANCE_0)"))], withNative())).toEqual([]);
  });

  test("native bindings can be moved, swapped and copied", () => {
    expect(errorsOf([...dropFunctions(["key:N1"]), { op: "moveBinding", from: at("base", 3), to: at("num", 0) }], withNative())).toEqual([]);
    expect(errorsOf([{ op: "swapBindings", a: at("base", 3), b: at("base", 0) }], withNative())).toEqual([]);
    expect(errorsOf([set("num", 2, native("TD(DANCE_0)"))], withNative())).toEqual([]);
  });

  test("a combo can't output new native source", () => {
    const combo = { id: "c", name: "C", positions: [2, 3], layerIds: "all" as const, output: native("DUAL_FUNC_9") };
    expect(codes(errorsOf([{ op: "upsertCombo", combo }]))).toEqual(["native_edit"]);
  });
});

describe("validate: problems that were already there", () => {
  test("do not block an unrelated edit, and are shown as warnings", () => {
    const broken = tiny();
    (broken.layers[0] as Layer).bindings[0] = { kind: "layer", action: "to", layerId: "ghost" };
    const r = validate(tinyBoard, broken, [...dropFunctions(["key:N1"]), set("num", 0, key("Q"))]);
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ code: "unknown_ref", slots: [at("base", 0)] });
    expect(r.warnings[0]?.message).toContain("already so before this change");
  });

  test("moving the broken binding makes a new error", () => {
    const broken = tiny();
    (broken.layers[0] as Layer).bindings[0] = { kind: "layer", action: "to", layerId: "ghost" };
    expect(codes(errorsOf([{ op: "swapBindings", a: at("base", 0), b: at("base", 1) }], broken))).toEqual(["unknown_ref"]);
  });
});
