import { z } from "zod";
import type { BoardDefinition } from "../../boards/schema.ts";
import { APLUS_FACTORY_WHEEL, effectiveSensors } from "../../boards/sensors.ts";
import { SensorBindingSchema, type Layout, type SensorBinding } from "../../layout/schema.ts";
import { isQmkWheelBinding } from "../../layout/sensors.ts";
import { bindingToC } from "./emit-binding.ts";
import { GenerateError } from "./generate-error.ts";
import type { Chunk } from "./keymap-c.ts";
import { ImportError } from "./source.ts";

const START = "// keyloom-aplus-wheels: ";
const END = "// end-keyloom-aplus-wheels";
const FACTORY_TASK = "fa605afd2577885f4d5e89ae94787bd288512ffa12b544542959aaada5a92b3a";
const HOOK = `        /* keyloom A+ custom turns */
        if (keyloom_aplus_wheel_turn(0, leftwheel_delta, leftwheel_deadzone_distance)) leftwheel_delta = 0;
        if (keyloom_aplus_wheel_turn(1, rightwheel_delta, rightwheel_deadzone_distance)) rightwheel_delta = 0;

`;

export const hasAplusWheels = (board: BoardDefinition): boolean => board.revisions[0]?.build.kind === "qmk-docker" && board.revisions[0].build.wheelAdapter === "ploopy-aplus";

const wheelLayers = z.array(z.array(SensorBindingSchema).length(2)).min(1).max(32);
const context = { layerIndex: new Map<string, number>(), macroNames: new Map<string, string>(), tapDanceNames: new Map<string, string>() };

function actionCode(action: Extract<SensorBinding, { kind: "rotation" }>["clockwise"]): string {
  if (action.kind === "native" && !isQmkWheelBinding(action)) throw new GenerateError("A+ turns support keys, scrolling, or Nothing");
  return bindingToC(action, context);
}

/** The A+ has analog wheels, so QMK's encoder_map cannot dispatch their turns. */
function helper(sensors: SensorBinding[][]): string {
  const cases = sensors.flatMap((wheels, layer) => {
    const assignments = wheels.flatMap((wheel, index) => {
      if (wheel.kind === "native") {
        if (wheel.source !== APLUS_FACTORY_WHEEL) throw new GenerateError("the A+ wheel source is not a factory behavior keyloom can retain");
        return [];
      }
      return [`      if (wheel == ${index}) { custom = true; clockwise = ${actionCode(wheel.clockwise)}; counterclockwise = ${actionCode(wheel.counterclockwise)}; }`];
    });
    return assignments.length === 0 ? [] : [`    case ${layer}:`, ...assignments, "      break;"];
  });
  return `${START}${JSON.stringify(sensors)}
static bool keyloom_aplus_wheel_turn(uint8_t wheel, int16_t delta, int16_t distance) {
  static int32_t ticks[2] = {0, 0};
  static uint8_t last_layer[2] = {255, 255};
  if (wheel >= 2) return false;
  const uint8_t layer = get_highest_layer(layer_state | default_layer_state);
  bool custom = false;
  uint16_t clockwise = KC_NO, counterclockwise = KC_NO;
  switch (layer) {
${cases.join("\n")}
  }
  if (!custom || last_layer[wheel] != layer) ticks[wheel] = 0;
  last_layer[wheel] = layer;
  if (!custom) return false;
  if (matrix_is_on(0, 6 + wheel) || abs(distance) <= TMAG5273_WHEEL_DEADZONE - 10) {
    ticks[wheel] = 0;
    return true;
  }
  ticks[wheel] += delta;
  while (ticks[wheel] >= TMAG5273_LOWRES_TICK_SIZE) {
    if (clockwise != KC_NO) tap_code16(clockwise);
    ticks[wheel] -= TMAG5273_LOWRES_TICK_SIZE;
  }
  while (ticks[wheel] <= -TMAG5273_LOWRES_TICK_SIZE) {
    if (counterclockwise != KC_NO) tap_code16(counterclockwise);
    ticks[wheel] += TMAG5273_LOWRES_TICK_SIZE;
  }
  return true;
}
${END}`;
}

/** Generated code must match its metadata exactly before the importer removes it. */
export function readAplusWheels(source: string, board: BoardDefinition) {
  if (!hasAplusWheels(board) || !source.includes(START)) return { source, sensors: undefined };
  const start = source.indexOf(START);
  const lineEnd = source.indexOf("\n", start);
  const end = source.indexOf(END, lineEnd);
  try {
    if (start !== source.lastIndexOf(START) || lineEnd < 0 || end < 0 || source.indexOf(HOOK) !== source.lastIndexOf(HOOK) || !source.includes(HOOK)) throw new Error("missing or repeated wheel code");
    const sensors = wheelLayers.parse(JSON.parse(source.slice(start + START.length, lineEnd)));
    const block = source.slice(start, end + END.length);
    if (block !== helper(sensors)) throw new Error("the generated wheel code was edited");
    return { source: source.slice(0, start) + source.slice(end + END.length).replace(HOOK, ""), sensors };
  } catch (error) {
    throw new ImportError(`cannot read A+ turns: ${error instanceof Error ? error.message : String(error)}. Import the keyloom JSON export or restore the generated wheel code.`);
  }
}

export function writeAplusWheels(layout: Layout, board: BoardDefinition, chunks: readonly Chunk[]) {
  if (!hasAplusWheels(board)) return { chunks, prelude: undefined };
  const parsed = wheelLayers.safeParse(layout.layers.map((layer) => effectiveSensors(board, layer)));
  if (!parsed.success) throw new GenerateError("each A+ layer needs two wheel bindings in left-to-right order");
  const sensors = parsed.data;
  const prelude = helper(sensors);
  if (!sensors.some((wheels) => wheels.some((wheel) => wheel.kind === "rotation"))) return { chunks, prelude: undefined };
  const tasks = chunks.filter((chunk) => chunk.anchor === "function:pointing_device_task_user");
  const task = tasks[0];
  if (tasks.length !== 1 || !task || chunks.some((chunk) => /\bkeyloom_aplus_wheel_turn\b/.test(chunk.source))) throw new GenerateError("A+ custom turns need the unmodified factory wheel callback");
  // Ignore only the control layer's spelling and whitespace. Unknown callback changes must never be overwritten.
  const normalized = task.source.replace(/layer_state_is\([^)]*\)/g, "layer_state_is(CONTROL)").replace(/\s/g, "");
  if (new Bun.CryptoHasher("sha256").update(normalized).digest("hex") !== FACTORY_TASK) throw new GenerateError("the A+ wheel callback differs from the pinned factory source. Keep factory turns or import the factory keymap before assigning custom turns.");
  const at = task.source.indexOf("        /* If we're on the control layers, both wheels adjust the volume. */");
  if (at < 0) throw new GenerateError("the A+ factory wheel insertion point is missing");
  return { prelude, chunks: chunks.map((chunk) => chunk === task ? { ...chunk, source: task.source.slice(0, at) + HOOK + task.source.slice(at) } : chunk) };
}
