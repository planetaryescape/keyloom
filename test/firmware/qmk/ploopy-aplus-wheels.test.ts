import { expect, test } from "bun:test";
import { readDefaultKeymap } from "../../../src/app/default-keymap.ts";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { boardSensorDefaults, effectiveSensors } from "../../../src/boards/sensors.ts";
import { generateQmkSource } from "../../../src/firmware/qmk/generate.ts";
import { importQmkSource } from "../../../src/firmware/qmk/import.ts";
import type { Layout, SensorBinding } from "../../../src/layout/schema.ts";
import { evaluate } from "../../../src/validation/validate.ts";
import { lostFunctionsIn, splitLost } from "../../../src/web/editor/lost-functions.ts";
import { tempDir } from "../../helpers/tmp.ts";

const board = (await loadBoardDir(`${import.meta.dir}/../../../boards/ploopy/aplus`)).definition;
const found = await readDefaultKeymap(board, { cacheDir: tempDir(), fetchText: (url) => Bun.file(`${import.meta.dir}/../../fixtures/qmk/ploopy-aplus-default/${url.split("/").at(-1)}`).text() });
if (!found.layout) throw new Error(found.reason);
const factory = found.layout;
const volume: SensorBinding = { kind: "rotation", clockwise: { kind: "key", code: "AUDIO_VOL_UP" }, counterclockwise: { kind: "key", code: "AUDIO_VOL_DOWN" } };
const letters: SensorBinding = { kind: "rotation", clockwise: { kind: "key", code: "A" }, counterclockwise: { kind: "key", code: "B" } };
const source = (layout: Layout) => generateQmkSource({ layout, board, revisionId: "wheel-test" }).files;
const changed = () => {
  const doc = structuredClone(factory);
  doc.layers[0]!.sensorBindings = [volume, boardSensorDefaults(board)[1]!];
  doc.layers[2]!.sensorBindings = [boardSensorDefaults(board)[0]!, letters];
  return doc;
};

test("an A+ turn edit passes validation and preserves the other knob, press, and layers", () => {
  const original = structuredClone(factory);
  const sensors = [volume, boardSensorDefaults(board)[1]!];
  const checked = evaluate(board, original, [{ op: "setSensorBindings", layerId: original.layers[0]!.id, sensorBindings: sensors }]);
  expect(checked.result.errors).toEqual([]);
  expect(checked.after!.layers[0]!.sensorBindings).toEqual(sensors);
  expect(checked.after!.layers[0]!.bindings).toEqual(original.layers[0]!.bindings);
  expect(checked.after!.layers.slice(1)).toEqual(original.layers.slice(1));
  expect(original.layers[0]!.sensorBindings).toBeUndefined();
  const reset = evaluate(board, checked.after!, [{ op: "setSensorBindings", layerId: original.layers[0]!.id, sensorBindings: null }]);
  expect(reset.result.errors.map((error) => error.code)).toEqual(["function_lost", "function_lost"]);
  const loss = splitLost(lostFunctionsIn(reset.result), [{ layerId: original.layers[0]!.id, position: 6 }]);
  expect(loss.direct.map((entry) => entry.function)).toEqual(["key:AUDIO_VOL_UP", "key:AUDIO_VOL_DOWN"]);
  expect(loss.collateral).toEqual([]);
  const confirmed = evaluate(board, checked.after!, [{ op: "setSensorBindings", layerId: original.layers[0]!.id, sensorBindings: null }, ...["AUDIO_VOL_UP", "AUDIO_VOL_DOWN"].map((code) => ({ op: "dropFunction" as const, function: `key:${code}`, reason: "Restore factory turns" }))]);
  expect(confirmed.result.errors).toEqual([]);
  expect(effectiveSensors(board, confirmed.after!.layers[0]!)).toEqual(boardSensorDefaults(board));
});

test("A+ scrolling is a checked turn action, while foreign or arbitrary source is refused", () => {
  const turn: SensorBinding = { kind: "rotation", clockwise: { kind: "native", firmware: "qmk", source: "MS_WHLU", label: "Scroll up" }, counterclockwise: { kind: "none" } };
  const check = (sensor: SensorBinding) => evaluate(board, factory, [{ op: "setSensorBindings", layerId: factory.layers[0]!.id, sensorBindings: [sensor, boardSensorDefaults(board)[1]!] }]);
  expect(check(turn).result.errors).toEqual([]);
  const invalid: SensorBinding = { ...turn, clockwise: { kind: "native", firmware: "zmk", source: "&msc SCRL_UP", label: "Scroll up" } };
  expect(check(invalid).result.ok).toBe(false);
  expect(() => source({ ...factory, layers: factory.layers.map((layer, i) => i === 0 ? { ...layer, sensorBindings: [invalid, boardSensorDefaults(board)[1]!] } : layer) })).toThrow("A+ turns support");
  expect(evaluate(board, factory, [{ op: "setSensorBindings", layerId: factory.layers[0]!.id, sensorBindings: [volume] }]).result.ok).toBe(false);
});

test("factory output has no wheel hook, while custom turns reimport as editable pairs", async () => {
  expect(source(factory)[0]!.content).not.toContain("keyloom_aplus_wheel_turn");
  const doc = changed();
  const files = source(doc);
  const imported = await importQmkSource({ name: "roundtrip", keymapC: files[0]!.content, configH: files[1]!.content, rulesMk: files.find((file) => file.path === "rules.mk")!.content, keymapJson: files.find((file) => file.path === "keymap.json")!.content }, board);
  expect(imported.layout.layers.map((layer) => layer.sensorBindings)).toEqual(doc.layers.map((layer) => effectiveSensors(board, layer)));
  const withoutLayerComments = (c: string) => c.replace(/\/\/ layer-\d+: [^\n]*/g, "");
  expect(withoutLayerComments(source(imported.layout)[0]!.content)).toBe(withoutLayerComments(files[0]!.content));
  imported.layout.layers.forEach((layer) => { delete layer.sensorBindings; });
  expect(source(imported.layout)[0]!.content).not.toContain("keyloom_aplus_wheel_turn");
  expect(source(imported.layout)[0]!.content).toContain("mouse_report.v = -leftwheel_delta");
});

test("edited callbacks and generated wheel code are refused instead of losing custom source", async () => {
  const doc = changed();
  const task = doc.passthrough.find((chunk) => chunk.anchor === "function:pointing_device_task_user")!;
  task.source = task.source.replace(" > 10)", " > 11)");
  expect(() => source(doc)).toThrow("differs from the pinned factory source");
  const generated = source(changed())[0]!.content.replace("ticks[wheel] += delta;", "ticks[wheel] += delta * 2;");
  await expect(importQmkSource({ name: "edited", keymapC: generated }, board)).rejects.toThrow("generated wheel code was edited");
});

test("the generated C dispatches directions, consumes custom motion, and clears partial turns on layer changes", async () => {
  const generated = source(changed())[0]!.content;
  const start = generated.indexOf("static bool keyloom_aplus_wheel_turn");
  const helper = generated.slice(start, generated.indexOf("// end-keyloom-aplus-wheels", start));
  const dir = tempDir("aplus-wheel-c-");
  const harness = `#include <stdint.h>
#include <stdbool.h>
#include <stdlib.h>
#include <assert.h>
enum { KC_NO, KC_AUDIO_VOL_UP, KC_AUDIO_VOL_DOWN, KC_A, KC_B };
#define TMAG5273_LOWRES_TICK_SIZE 480
#define TMAG5273_WHEEL_DEADZONE 60
static uint32_t layer_state = 1, default_layer_state = 1;
static bool held = false;
static uint16_t sent[32];
static int count = 0;
static uint8_t get_highest_layer(uint32_t state) { uint8_t i=0; while (state >>= 1) i++; return i; }
static bool matrix_is_on(int row, int col) { assert(row == 0); assert(col == 6 || col == 7); return held; }
static void tap_code16(uint16_t code) { assert(count < 32); sent[count++] = code; }
${helper}
int main(void) {
  assert(!keyloom_aplus_wheel_turn(1, 480, 200));
  assert(count == 0);
  assert(keyloom_aplus_wheel_turn(0, 240, 200));
  assert(count == 0);
  assert(keyloom_aplus_wheel_turn(0, 240, 200));
  assert(count == 1 && sent[0] == KC_AUDIO_VOL_UP);
  assert(keyloom_aplus_wheel_turn(0, -960, -200));
  assert(count == 3 && sent[1] == KC_AUDIO_VOL_DOWN && sent[2] == KC_AUDIO_VOL_DOWN);
  assert(keyloom_aplus_wheel_turn(0, 240, 200));
  layer_state = 4;
  assert(!keyloom_aplus_wheel_turn(0, 480, 200));
  assert(keyloom_aplus_wheel_turn(1, 480, 200));
  assert(count == 4 && sent[3] == KC_A);
  assert(keyloom_aplus_wheel_turn(1, -480, -200));
  assert(count == 5 && sent[4] == KC_B);
  layer_state = 1;
  assert(keyloom_aplus_wheel_turn(0, 240, 200));
  assert(count == 5);
  held = true;
  assert(keyloom_aplus_wheel_turn(0, 480, 200));
  held = false;
  assert(keyloom_aplus_wheel_turn(0, 240, 200));
  assert(count == 5);
  assert(keyloom_aplus_wheel_turn(0, 480, 0));
  assert(count == 5);
  layer_state = 128;
  assert(!keyloom_aplus_wheel_turn(0, 480, 200));
  return 0;
}`;
  await Bun.write(`${dir}/wheel.c`, harness);
  const compile = Bun.spawnSync(["cc", "-std=c11", "-Wall", "-Werror", `${dir}/wheel.c`, "-o", `${dir}/wheel`]);
  expect(compile.stderr.toString()).toBe("");
  expect(compile.exitCode).toBe(0);
  const run = Bun.spawnSync([`${dir}/wheel`]);
  expect(run.stderr.toString()).toBe("");
  expect(run.exitCode).toBe(0);
});
