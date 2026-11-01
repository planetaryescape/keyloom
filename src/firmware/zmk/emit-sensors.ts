import type { BoardDefinition } from "../../boards/schema.ts";
import { effectiveSensors } from "../../boards/sensors.ts";
import type { Binding, Layout } from "../../layout/schema.ts";
import { bindingToDts, type EmitContext } from "./emit-binding.ts";
import { keyExprText } from "./key-expr.ts";
import { GenerateError } from "./generate-error.ts";

const SCROLL_PARAMETERS = new Map([
  ["SCRL_UP", "MOVE_Y(200)"], ["SCRL_DOWN", "MOVE_Y(-200)"], ["SCRL_LEFT", "MOVE_X(-200)"], ["SCRL_RIGHT", "MOVE_X(200)"],
]);

/** ZMK already dispatches sensor-bindings per active layer; no hardware-module fork needed. */
export function renderSensors(layout: Layout, board: BoardDefinition, ctx: EmitContext) {
  const behaviors: string[][] = [];
  const roots: string[][] = [];
  const bindings = new Map<string, string[]>();
  const used = new Set((layout.passthrough.map((p) => p.source).join(" ").match(/\b[A-Za-z_]\w*\b/g) ?? []));
  for (const label of [...ctx.profileLabels.values(), ...ctx.macroLabels.values(), ...ctx.tapDanceLabels.values()]) used.add(label);
  const claim = (stem: string) => {
    let label = stem;
    for (let n = 1; used.has(label); n++) label = `${stem}_${n}`;
    used.add(label);
    return label;
  };
  const pointing = new Map<string, string>();
  const turnAction = (action: Binding): string => {
    const match = action.kind === "native" && action.firmware === "zmk" ? /^&(mmv|msc) (\w+)$/.exec(action.source) : null;
    if (!match) return bindingToDts(action, ctx);
    const scroll = match[1] === "msc";
    const kind = scroll ? "scroll" : "move";
    let label = pointing.get(kind);
    if (!label) {
      label = claim(`keyloom_encoder_${kind}`);
      pointing.set(kind, label);
      // Adapted from zmkfirmware/zmk app/dts/behaviors/mouse_move.dtsi @ edf5c0814fd3ea202e43aad2d68fd32e882a518c (MIT).
      // Its default 16 ms tick and ramp produce no movement during a sensor's 5 ms tap.
      // Dedicated constant-speed devices leave ordinary mouse keys' feel unchanged.
      behaviors.push([`${label}: ${label} {`, '    compatible = "zmk,behavior-input-two-axis";', "    #binding-cells = <1>;",
        `    x-input-code = <${scroll ? "INPUT_REL_HWHEEL" : "INPUT_REL_X"}>;`, `    y-input-code = <${scroll ? "INPUT_REL_WHEEL" : "INPUT_REL_Y"}>;`,
        "    delay-ms = <0>;", "    time-to-max-speed-ms = <0>;", "    acceleration-exponent = <0>;", "    trigger-period-ms = <5>;", "};"]);
      roots.push([`${claim(`${label}_listener`)} {`, '    compatible = "zmk,input-listener";', `    device = <&${label}>;`, "};"]);
    }
    // A 5 ms tick needs 200 units/sec to yield a whole scroll unit, not a discarded fraction.
    const parameter = scroll ? SCROLL_PARAMETERS.get(match[2] ?? "") : match[2];
    if (!parameter) throw new GenerateError(`unsupported encoder pointing action ${action.kind === "native" ? action.source : ""}`);
    return `&${label} ${parameter}`;
  };
  layout.layers.forEach((layer, li) => {
    const sensors = effectiveSensors(board, layer);
    const defaults = board.revisions[0]?.build;
    const count = defaults?.kind === "zmk-west-docker" ? defaults.sensorBindings?.length ?? 0 : 0;
    if (sensors.length !== count) throw new GenerateError(`layer ${layer.id}: expected ${count} sensor bindings, got ${sensors.length}`);
    bindings.set(layer.id, sensors.map((sensor, si) => {
      if (sensor.kind === "native") return sensor.source;
      if (sensor.clockwise.kind === "key" && sensor.counterclockwise.kind === "key") return `&inc_dec_kp ${keyExprText({ code: sensor.clockwise.code, mods: sensor.clockwise.mods ?? [] })} ${keyExprText({ code: sensor.counterclockwise.code, mods: sensor.counterclockwise.mods ?? [] })}`;
      const label = claim(`keyloom_sensor_${li}_${si}`);
      const cw = turnAction(sensor.clockwise);
      const ccw = turnAction(sensor.counterclockwise);
      behaviors.push([
        `${label}: ${label} {`,
        '    compatible = "zmk,behavior-sensor-rotate";',
        "    #sensor-binding-cells = <0>;",
        "    tap-ms = <20>;",
        `    bindings = <${cw}>, <${ccw}>;`,
        "};",
      ]);
      return `&${label}`;
    }));
  });
  return { behaviors, bindings, roots };
}
