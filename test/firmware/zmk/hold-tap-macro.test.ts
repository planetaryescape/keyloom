import { describe, expect, test } from "bun:test";
import { generateZmkSource } from "../../../src/firmware/zmk/generate.ts";
import { importZmkSource } from "../../../src/firmware/zmk/import.ts";
import { type DtNode, parseDts } from "../../../src/firmware/zmk/dts.ts";
import { cellsOf } from "../../../src/firmware/zmk/props.ts";
import { parseCalls } from "../../../src/firmware/zmk/cells.ts";
import { bindingToDts } from "../../../src/firmware/zmk/emit-binding.ts";
import { type Binding, type Layout } from "../../../src/layout/schema.ts";
import { STYLE_FIXTURE, glove80 } from "../../helpers/zmk.ts";

const board = await glove80();
const { layout: imported } = await importZmkSource(STYLE_FIXTURE, board.definition);
const fixture = (): Layout => ({
  ...structuredClone(imported),
  macros: [{ id: "paste", name: "Paste", steps: [{ op: "tap", code: "V", mods: ["LCTL"] }] }],
  holdTapProfiles: [{ id: "custom", name: "Custom", firmware: "zmk", options: { bindings: "&kp &kp", flavor: "balanced", "tapping-term-ms": 173, "quick-tap-ms": 91, "hold-trigger-key-positions": [40, 41], "hold-trigger-on-release": true } }],
  layers: imported.layers.map((layer) => ({ ...layer, bindings: layer.bindings.map(() => ({ kind: "none" })) })),
});
const macroTap = (hold: Extract<Binding, { kind: "holdTap" }>["hold"], profileId = "custom"): Binding => ({ kind: "holdTap", tap: { code: "", macroId: "paste" }, hold, profileId });
const generate = (layout: Layout) => generateZmkSource({ layout, board: board.definition, revisionId: "rev_TEST" }).files[0]!.content;
async function nodes(text: string): Promise<DtNode[]> {
  const visit = (n: DtNode): DtNode[] => [n, ...n.children.flatMap(visit)];
  return (await parseDts(text)).flatMap((item) => item.kind === "node" ? visit(item.node) : []);
}

describe("ZMK macro tap hold-taps", () => {
  test("uses a distinct two-cell behavior per profile, macro and hold kind, with a zero tap argument", async () => {
    const layout = fixture();
    layout.layers[0]!.bindings[0] = macroTap({ mods: ["LCTL"] });
    layout.layers[0]!.bindings[1] = macroTap({ mods: ["LSFT"] });
    layout.layers[0]!.bindings[2] = macroTap({ layerId: layout.layers[1]!.id });
    layout.layers[0]!.bindings[3] = { kind: "holdTap", tap: { code: "A" }, hold: { mods: ["LCTL"] }, profileId: "custom" };
    const all = await nodes(generate(layout));
    // Find the keymap's layer rather than depending on generated helper names.
    const keymap = all.find((n) => n.name === "keymap")!;
    const calls = cellsOf(keymap.children[0]!, "bindings").flatMap((c) => parseCalls(c).calls);
    expect(calls.slice(0, 4).map((c) => c.params)).toEqual([["LCTRL", "0"], ["LSHFT", "0"], ["1", "0"], ["LCTRL", "A"]]);
    expect(calls[0]!.name).toBe(calls[1]!.name);
    expect(calls[0]!.name).not.toBe(calls[2]!.name);
    expect(calls[0]!.name).not.toBe("custom");
    expect(calls[3]!.name).toBe("custom");
    for (const [index, hold] of [[0, "&kp"], [2, "&mo"]] as const) {
      const behavior = all.find((n) => n.label === calls[index]!.name)!;
      expect(cellsOf(behavior, "#binding-cells")).toEqual(["2"]);
      expect(cellsOf(behavior, "bindings")).toEqual([hold, "&paste"]);
      expect(cellsOf(behavior, "tapping-term-ms")).toEqual(["173"]);
      expect(cellsOf(behavior, "quick-tap-ms")).toEqual(["91"]);
      expect(cellsOf(behavior, "hold-trigger-key-positions")).toEqual(["40 41"]);
      expect(behavior.props.some((p) => p.name === "hold-trigger-on-release")).toBe(true);
      expect(behavior.source).toContain('flavor = "balanced";');
    }
  });

  test("builtin defaults and per-profile overrides survive specialization", async () => {
    const layout = fixture();
    layout.holdTapProfiles = [{ id: "lt", name: "Layer tap", firmware: "zmk", options: { "quick-tap-ms": 80 } }];
    layout.layers[0]!.bindings[0] = macroTap({ layerId: layout.layers[1]!.id }, "lt");
    const all = await nodes(generate(layout));
    const behavior = all.find((n) => cellsOf(n, "bindings").join(",") === "&mo,&paste")!;
    expect(cellsOf(behavior, "tapping-term-ms")).toEqual(["200"]);
    expect(cellsOf(behavior, "quick-tap-ms")).toEqual(["80"]);
    expect(behavior.source).toContain('flavor = "tap-preferred";');
  });

  test("different macros and profiles do not accidentally share the same behavior", async () => {
    const layout = fixture();
    layout.macros.push({ id: "other", name: "Other", steps: [{ op: "tap", code: "B" }] });
    layout.holdTapProfiles.push({ id: "slower", name: "Slower", firmware: "zmk", options: { "tapping-term-ms": 300 } });
    layout.layers[0]!.bindings[0] = macroTap({ mods: ["LCTL"] });
    layout.layers[0]!.bindings[1] = macroTap({ mods: ["LCTL"] }, "slower");
    layout.layers[0]!.bindings[2] = { kind: "holdTap", tap: { code: "", macroId: "other" }, hold: { mods: ["LCTL"] }, profileId: "custom" };
    const all = await nodes(generate(layout));
    const keymap = all.find((n) => n.name === "keymap")!;
    const calls = cellsOf(keymap.children[0]!, "bindings").flatMap((c) => parseCalls(c).calls).slice(0, 3);
    expect(new Set(calls.map((c) => c.name)).size).toBe(3);
    expect(calls.map((c) => cellsOf(all.find((n) => n.label === c.name)!, "tapping-term-ms"))).toEqual([["173"], ["300"], ["173"]]);
    expect(calls.map((c) => cellsOf(all.find((n) => n.label === c.name)!, "bindings"))).toEqual([["&kp", "&paste"], ["&kp", "&paste"], ["&kp", "&other"]]);
  });

  test("helper labels avoid modeled and preserved source labels", async () => {
    const layout = fixture();
    layout.layers[0]!.bindings[0] = macroTap({ mods: ["LCTL"] });
    const original = (await nodes(generate(layout))).find((n) => cellsOf(n, "bindings").join(",") === "&kp,&paste")!.label!;
    layout.macros.push({ id: original, name: "Clash", steps: [{ op: "tap", code: "A" }] });
    layout.passthrough.push({ firmware: "zmk", file: "glove80.keymap", anchor: "behavior:preserved", source: `${original}_1: preserved { compatible = "zmk,behavior-key-press"; #binding-cells = <1>; };`, refersToLayerIndices: false });
    const all = await nodes(generate(layout));
    const labels = all.flatMap((n) => n.label ? [n.label] : []);
    expect(new Set(labels).size).toBe(labels.length);
    const helper = all.find((n) => cellsOf(n, "bindings").join(",") === "&kp,&paste")!;
    expect(helper.label).not.toBe(original);
    expect(helper.label).not.toBe(`${original}_1`);
  });

  test("missing macro/profile or an unprepared emitter context fails clearly, never emits a phandle parameter", () => {
    const layout = fixture();
    layout.layers[0]!.bindings[0] = macroTap({ mods: ["LCTL"] });
    layout.macros = [];
    expect(() => generate(layout)).toThrow(/macro.*paste.*exist/);
    layout.holdTapProfiles = [];
    expect(() => generate(layout)).toThrow(/profile.*custom.*exist/);
    expect(() => bindingToDts(macroTap({ mods: ["LCTL"] }), { layerIndex: new Map(), profileLabels: new Map([["custom", "custom"]]), macroLabels: new Map([["paste", "paste"]]), tapDanceLabels: new Map() })).toThrow(/macro.*hold-tap/i);
  });
});
