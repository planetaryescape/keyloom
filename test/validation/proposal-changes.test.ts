import { expect, test } from "bun:test";
import type { ChangeOp } from "../../src/layout/change.ts";
import { nativeLegend } from "../../src/layout/native-legend.ts";
import { retargetLayerHold } from "../../src/layout/behavior-facts.ts";
import { automaticReviewErrors } from "../../src/validation/review-policy.ts";
import { proposalChanges } from "../../src/validation/proposal-changes.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { tinyBoard, tinyLayout } from "../helpers/workload.ts";
import { groundedLayout, retargetMode } from "../helpers/grounded-review.ts";

const board = tinyBoard();

function seeded(): Layout {
  const layout = tinyLayout(undefined, [
    { kind: "key", code: "N1" }, { kind: "key", code: "N2" }, { kind: "none" }, { kind: "key", code: "N4" },
  ]);
  layout.layers.push({ id: "tools", name: "Tools", bindings: [{ kind: "key", code: "A" }, { kind: "none" }, { kind: "none" }, { kind: "none" }] });
  layout.macros = [{ id: "copy", name: "Copy", steps: [{ op: "tap", code: "C", mods: ["LGUI"] }] }];
  layout.tapDances = [{ id: "esc-caps", name: "Escape or Caps", tap: { kind: "key", code: "ESCAPE" }, hold: { kind: "modifier", mods: ["LSFT"] }, termMs: 200 }];
  layout.combos = [{ id: "go-tools", name: "Tools", positions: [1, 3], layerIds: "all", output: { kind: "layer", action: "momentary", layerId: "tools" } }];
  layout.conditionalLayers = [{ id: "tri", ifLayerIds: ["symbols", "tools"], thenLayerId: "base" }];
  layout.holdTapProfiles = [{ id: "home", name: "Home row", firmware: "qmk", options: { "tapping-term-ms": 200 } }];
  layout.settings = [{ firmware: "qmk", key: "TAPPING_TERM", value: 200 }];
  return layout;
}

const cases: Array<{ op: ChangeOp; category: string }> = [
  { op: { op: "setBinding", at: { layerId: "base", position: 0 }, binding: { kind: "key", code: "F13" } }, category: "binding" },
  { op: { op: "setSensorBindings", layerId: "base", sensorBindings: [{ kind: "rotation", clockwise: { kind: "key", code: "A" }, counterclockwise: { kind: "key", code: "B" } }] }, category: "blocked" },
  { op: { op: "moveBinding", from: { layerId: "base", position: 0 }, to: { layerId: "base", position: 2 } }, category: "binding" },
  { op: { op: "swapBindings", a: { layerId: "base", position: 0 }, b: { layerId: "base", position: 3 } }, category: "binding" },
  { op: { op: "addLayer", layer: { id: "extra", name: "Extra" }, afterLayerId: "base" }, category: "Layers" },
  { op: { op: "removeLayer", layerId: "tools" }, category: "Layers" },
  { op: { op: "renameLayer", layerId: "tools", name: "Utilities" }, category: "Layers" },
  { op: { op: "duplicateLayer", layerId: "tools", layer: { id: "tools-copy", name: "Tools copy" } }, category: "Layers" },
  { op: { op: "moveLayer", layerId: "tools", afterLayerId: "base" }, category: "Layers" },
  { op: { op: "setLayerStyle", layerId: "tools", shortLabel: "UTIL", color: 4 }, category: "Layers" },
  { op: { op: "setLayerLighting", layerId: "tools", lighting: { layer: [85, 255, 255], keys: { "0": [10, 255, 255] } } }, category: "Layers" },
  { op: { op: "upsertMacro", macro: { id: "copy", name: "Copy now", steps: [{ op: "tap", code: "V", mods: ["LGUI"] }] } }, category: "Macros" },
  { op: { op: "removeMacro", macroId: "copy" }, category: "Macros" },
  { op: { op: "upsertTapDance", tapDance: { ...seeded().tapDances[0]!, termMs: 240 } }, category: "Tap dances" },
  { op: { op: "removeTapDance", tapDanceId: "esc-caps" }, category: "Tap dances" },
  { op: { op: "upsertCombo", combo: { id: "save", name: "Save shortcut", positions: [0, 3], layerIds: "all", output: { kind: "key", code: "S", mods: ["LCTL"] }, timeoutMs: 45 } }, category: "Combos" },
  { op: { op: "removeCombo", comboId: "go-tools" }, category: "Combos" },
  { op: { op: "upsertConditionalLayer", conditionalLayer: { id: "tri", ifLayerIds: ["symbols", "tools"], thenLayerId: "tools" } }, category: "Conditional layers" },
  { op: { op: "removeConditionalLayer", conditionalLayerId: "tri" }, category: "Conditional layers" },
  { op: { op: "upsertHoldTapProfile", profile: { id: "home", name: "Home row revised", firmware: "zmk", options: { "tapping-term-ms": 240 } } }, category: "profile" },
  { op: { op: "setFirmwareSetting", setting: { firmware: "qmk", key: "TAPPING_TERM", value: 240 } }, category: "Firmware settings" },
  { op: { op: "removeFirmwareSetting", firmware: "qmk", key: "TAPPING_TERM" }, category: "Firmware settings" },
  { op: { op: "dropFunction", function: "key:F13", reason: "Synthetic allowance" }, category: "blocked" },
];

const supportedOps = [
  "setBinding", "setSensorBindings", "moveBinding", "swapBindings", "addLayer", "removeLayer",
  "renameLayer", "duplicateLayer", "moveLayer", "setLayerStyle", "setLayerLighting", "upsertMacro",
  "removeMacro", "upsertTapDance", "removeTapDance", "upsertCombo", "removeCombo",
  "upsertConditionalLayer", "removeConditionalLayer", "upsertHoldTapProfile", "setFirmwareSetting",
  "removeFirmwareSetting", "dropFunction",
] as const satisfies readonly ChangeOp["op"][];
type UncoveredChangeOp = Exclude<ChangeOp["op"], (typeof supportedOps)[number]>;
const uncoveredOps: Record<UncoveredChangeOp, never> = {};

test("every ChangeOp kind has a concrete comparison or an explicit blocked state", () => {
  void uncoveredOps;
  const covered = [...new Set(cases.map(({ op }) => op.op))].sort();
  const supported = [...supportedOps].sort();
  expect(covered).toEqual(supported);
  for (const { op, category } of cases) {
    const facts = proposalChanges(seeded(), [op], board);
    if (category === "blocked") {
      expect(facts.incomplete.length, op.op).toBeGreaterThan(0);
      continue;
    }
    expect(facts.incomplete, op.op).toEqual([]);
    if (category === "binding") expect(facts.bindings.length, op.op).toBeGreaterThan(0);
    else if (category === "profile") expect(facts.profiles[0]?.fields.length, op.op).toBeGreaterThan(0);
    else expect(facts.sections.find((section) => section.title === category)?.items[0]?.fields.length, op.op).toBeGreaterThan(0);
    expect(facts.summary).not.toBe("No visible source differences were found.");
  }
});

test("a new combo retains its chord keys, scope, output and timeout as values", () => {
  const facts = proposalChanges(seeded(), [cases.find(({ op }) => op.op === "upsertCombo")!.op], board);
  const combo = facts.sections.find((section) => section.title === "Combos")?.items[0];
  expect(combo?.name).toBe("Combo · Save shortcut");
  expect(combo?.fields).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: "Keys", current: "Not present", proposed: expect.stringContaining(" + ") }),
    expect.objectContaining({ label: "Active on", current: "Not present", proposed: "All layers" }),
    expect.objectContaining({ label: "Output", current: "Not present", proposed: "Sends Left Ctrl + S" }),
    expect.objectContaining({ label: "Chord window", current: "Not present", proposed: "45 ms" }),
  ]));
  expect(facts.summary).toContain("Output: Not present → Sends Left Ctrl + S");
});

test("an unknown native combo effect is quoted as source and blocks preview and Apply", () => {
  const facts = proposalChanges(seeded(), [{ op: "upsertCombo", combo: { id: "custom", name: "Custom chord", positions: [0, 3], layerIds: "all", output: { kind: "native", firmware: "qmk", source: "MYSTERY_ACTION(9)", label: "Custom" } } }], board);
  const output = facts.sections.find((section) => section.title === "Combos")?.items[0]?.fields.find((changed) => changed.key === "output");
  expect(output?.proposed).toContain("Custom QMK source “MYSTERY_ACTION(9)”");
  expect(output?.verified).toBe(false);
  expect(facts.incomplete.some((reason) => reason.includes("not established"))).toBe(true);
});

test("a recognized native hold-layer with an unmodeled tap keeps its source and remains incomplete", () => {
  const facts = proposalChanges(groundedLayout(), retargetMode(), board);
  expect(facts.bindings[0]?.current).toBe("Tap uses &indicator (effect not established); hold to use Factory; source “&mode 2 0”");
  expect(facts.bindings[0]?.proposed).toBe("Tap uses &indicator (effect not established); hold to use Tools; source “&mode 1 0”");
  expect(facts.bindings[0]?.complete).toBe(false);
  expect(facts.incomplete.some((reason) => reason.includes("not fully established"))).toBe(true);
});

test("same-tap modeled hold-tap changes retain distinct hold effects", () => {
  const before = seeded();
  before.layers[0]!.bindings[0] = { kind: "holdTap", tap: { code: "A" }, hold: { mods: ["LSFT"] }, profileId: "home" };
  const facts = proposalChanges(before, [{ op: "setBinding", at: { layerId: "base", position: 0 }, binding: { kind: "holdTap", tap: { code: "A" }, hold: { mods: ["LCTL"] }, profileId: "home" } }], board);
  expect(facts.bindings[0]?.current).toBe("Tap A; hold Left Shift; profile Home row");
  expect(facts.bindings[0]?.proposed).toBe("Tap A; hold Left Ctrl; profile Home row");
});

test("an allowed native hold-layer retarget can change meaning while preserving its printed legend", () => {
  const before = seeded();
  before.firmware = "zmk";
  before.layers[1]!.name = "Navigation";
  before.layers[1]!.shortLabel = "MAG";
  before.layers[2]!.name = "Numbers";
  before.layers[2]!.shortLabel = "MAG";
  before.passthrough = [{ firmware: "zmk", file: "glove80.keymap", anchor: "behavior:magic", source: "magic: magic_hold_tap { compatible = \"zmk,behavior-hold-tap\"; #binding-cells = <2>; bindings = <&mo>, <&bootloader>; };", refersToLayerIndices: false }];
  before.layers[0]!.bindings[0] = { kind: "native", firmware: "zmk", source: "&magic 1 0", label: "Magic", layerRefs: [{ start: 7, end: 8, layerId: "symbols" }] };
  const ops = retargetLayerHold(before, { layerId: "base", position: 0 }, "tools").ops;
  expect(automaticReviewErrors(before, ops)).toEqual([]);
  const facts = proposalChanges(before, ops, board);
  const oldNative = before.layers[0]!.bindings[0]!;
  if (oldNative.kind !== "native") throw new Error("expected a native hold-layer source");
  const newNative = ops.find((op) => op.op === "setBinding");
  if (newNative?.op !== "setBinding" || newNative.binding.kind !== "native") throw new Error("expected a native hold-layer retarget");
  const grid = { layers: before.layers, macros: before.macros, tapDances: before.tapDances, passthrough: before.passthrough };
  expect(nativeLegend(oldNative, grid)).toMatchObject({ tap: "Magic", hold: "MAG" });
  expect(nativeLegend(newNative.binding, grid)).toMatchObject({ tap: "Magic", hold: "MAG" });
  expect(facts.bindings[0]?.current).toBe("Tap Enter bootloader; hold to use Navigation");
  expect(facts.bindings[0]?.proposed).toBe("Tap Enter bootloader; hold to use Numbers");
  expect(facts.incomplete).toEqual([]);
});
