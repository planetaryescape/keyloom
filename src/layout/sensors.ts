import { fromZmk } from "./keycodes.ts";
import type { Binding, SensorBinding } from "./schema.ts";

/** Legacy defaults use inc_dec_kp. Keep anything else verbatim, never guess its meaning. */
export function sensorFromSource(source: string): SensorBinding {
  const match = /^&inc_dec_kp\s+(\w+)\s+(\w+)$/.exec(source.trim());
  const cw = match ? fromZmk(match[1]!) : undefined;
  const ccw = match ? fromZmk(match[2]!) : undefined;
  return cw && ccw ? { kind: "rotation", clockwise: { kind: "key", code: cw.name }, counterclockwise: { kind: "key", code: ccw.name } } : { kind: "native", source };
}

/** Exact built-in mouse calls only. No arbitrary expressions or source injection. */
export function isZmkMouseBinding(b: Binding): boolean {
  return b.kind === "native" && b.firmware === "zmk" && (
    /^&mmv MOVE_(?:UP|DOWN|LEFT|RIGHT)$/.test(b.source) ||
    /^&msc SCRL_(?:UP|DOWN|LEFT|RIGHT)$/.test(b.source) ||
    /^&mkp (?:LCLK|RCLK|MCLK|MB[1-5])$/.test(b.source)
  ) && !(b.layerRefs?.length || b.unprovable?.length);
}

export function sensorActions(sensors: readonly SensorBinding[]): Binding[] {
  return sensors.flatMap((s) => s.kind === "rotation" ? [s.clockwise, s.counterclockwise] : []);
}
