import { expect, test } from "bun:test";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { LayoutSchema } from "../../../src/layout/schema.ts";
import { evaluate } from "../../../src/validation/validate.ts";
import { generateZmkSource } from "../../../src/firmware/zmk/generate.ts";
import { importZmk } from "../../../src/firmware/zmk/import.ts";
import { ChangeOpSchema } from "../../../src/layout/change.ts";
import { applyOps } from "../../../src/layout/apply-ops.ts";
import { staleConflicts } from "../../../src/layout/stale.ts";

const board = await loadBoardDir("boards/keebart/corne-choc-pro-bt");
const layout = () => LayoutSchema.parse({ schemaVersion: 1, boardId: board.definition.id, firmware: "zmk",
  layers: [
    { id: "base", name: "Base", bindings: Array.from({ length: 46 }, (_, i) => i === 40 ? { kind: "layer", action: "momentary", layerId: "numbers" } : { kind: "key", code: "A" }) },
    { id: "numbers", name: "Numbers", bindings: Array.from({ length: 46 }, () => ({ kind: "transparent" })) },
  ], macros: [], combos: [], holdTapProfiles: [], settings: [], passthrough: [] });
const mouse = (direction: string) => ({ kind: "native", firmware: "zmk", source: `&mmv MOVE_${direction}`, label: `Mouse ${direction.toLowerCase()}` });

test("per-layer encoder turns reach generation and survive import without reverting to board defaults", async () => {
  const before = layout();
  const ops = [{ op: "setSensorBindings", layerId: "base", sensorBindings: [
    ...Array.from({ length: 2 }, () => ({ kind: "rotation", clockwise: mouse("RIGHT"), counterclockwise: mouse("LEFT") })),
    ...Array.from({ length: 2 }, () => ({ kind: "rotation", clockwise: mouse("DOWN"), counterclockwise: mouse("UP") })),
  ] }];
  // Exercise the public parser and validator, not a generator-only mutation.
  const evaluated = evaluate(board.definition, before, ops.map((op) => ChangeOpSchema.parse(op)));
  expect(evaluated.result.errors).toEqual([]);
  expect(evaluated.result.ok).toBe(true);
  expect(evaluated.result.diff.changed).toEqual([{ layerId: "base", position: 6 }, { layerId: "base", position: 7 }]);
  const generated = generateZmkSource({ layout: evaluated.after!, board: board.definition, revisionId: "encoder-test" });
  const keymap = generated.files[0]!.content;
  expect(keymap).toContain('compatible = "zmk,behavior-sensor-rotate"');
  expect(keymap).toContain("#include <dt-bindings/zmk/pointing.h>");
  expect(keymap).toContain("bindings = <&keyloom_encoder_move MOVE_RIGHT>, <&keyloom_encoder_move MOVE_LEFT>");
  expect(keymap).toContain("tap-ms = <20>");
  expect(keymap).toContain("time-to-max-speed-ms = <0>");
  expect(keymap).toContain("trigger-period-ms = <5>");
  expect(keymap).toContain("device = <&keyloom_encoder_move>");
  expect(keymap).toContain("sensor-bindings = <&inc_dec_kp C_VOL_UP C_VOL_DN");
  expect(generated.files[1]!.content).toContain("CONFIG_ZMK_POINTING=y");
  const imported = await importZmk({ name: "Encoders", keymap, conf: generated.files[1]!.content }, board.definition);
  const again = generateZmkSource({ layout: imported.layout, board: board.definition, revisionId: "again" });
  expect(again.files[0]!.content).toContain("bindings = <&keyloom_encoder_move MOVE_RIGHT>, <&keyloom_encoder_move MOVE_LEFT>");
  expect(imported.report.warnings.join(" ")).not.toContain("sensor-bindings isn't imported");
});

test("bad sensor counts and unrecognised native actions cannot pass validation", () => {
  const invalidCount = ChangeOpSchema.parse({ op: "setSensorBindings", layerId: "base", sensorBindings: [] });
  expect(evaluate(board.definition, layout(), [invalidCount]).result.errors.map((e) => e.code)).toContain("firmware_unsupported");
  const unknown = ChangeOpSchema.parse({ op: "setSensorBindings", layerId: "base", sensorBindings: Array.from({ length: 4 }, () => ({ kind: "native", source: "&invented 42" })) });
  expect(evaluate(board.definition, layout(), [unknown]).result.errors.map((e) => e.code)).toContain("native_edit");
});

test("removing the last reachable media turns requires explicit drops, including legacy defaults", () => {
  const before = layout();
  before.layers.pop();
  before.layers[0]!.bindings[40] = { kind: "key", code: "A" };
  const op = ChangeOpSchema.parse({ op: "setSensorBindings", layerId: "base", sensorBindings: Array.from({ length: 4 }, () => ({ kind: "rotation", clockwise: mouse("RIGHT"), counterclockwise: mouse("LEFT") })) });
  const evaluated = evaluate(board.definition, before, [op]);
  expect(evaluated.result.errors.filter((e) => e.code === "function_lost")).toHaveLength(4);
});

test("encoder drafts detect stale edits and duplicated layers keep their turns", () => {
  const before = layout();
  const op = ChangeOpSchema.parse({ op: "setSensorBindings", layerId: "base", sensorBindings: Array.from({ length: 4 }, () => ({ kind: "rotation", clockwise: mouse("RIGHT"), counterclockwise: mouse("LEFT") })) });
  const applied = applyOps(before, [op]);
  if (!applied.ok) throw new Error(applied.error.message);
  expect(staleConflicts(before, applied.layout, [op])).toHaveLength(1);
  expect(staleConflicts(before, applied.layout, [{ op: "duplicateLayer", layerId: "base", layer: { id: "copy", name: "Copy" } }])).toHaveLength(1);
  const copied = applyOps(applied.layout, [{ op: "duplicateLayer", layerId: "base", layer: { id: "copy", name: "Copy" } }]);
  if (!copied.ok) throw new Error(copied.error.message);
  expect(copied.layout.layers.at(-1)?.sensorBindings).toEqual(applied.layout.layers[0]?.sensorBindings);
  expect(before.layers[0]?.sensorBindings).toBeUndefined();
});

test("encoder presses can propose mouse buttons through the ordinary validator", () => {
  const evaluated = evaluate(board.definition, layout(), [{ op: "setBinding", at: { layerId: "base", position: 6 }, binding: { kind: "native", firmware: "zmk", source: "&mkp LCLK", label: "Left click" } }]);
  expect(evaluated.result.errors).toEqual([]);
});
