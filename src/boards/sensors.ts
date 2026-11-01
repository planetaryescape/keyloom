import type { BoardDefinition } from "./schema.ts";
import type { Layout, Layer, SensorBinding } from "../layout/schema.ts";
import { sensorFromSource } from "../layout/sensors.ts";

export function boardSensorDefaults(board: BoardDefinition): SensorBinding[] {
  const build = board.revisions[0]?.build;
  return build?.kind === "zmk-west-docker" ? (build.sensorBindings ?? []).map(sensorFromSource) : [];
}

export const effectiveSensors = (board: BoardDefinition, layer: Layer): SensorBinding[] => layer.sensorBindings ?? boardSensorDefaults(board);

/** Analysis sees legacy board defaults too; stored documents need no eager migration. */
export function withSensorDefaults(board: BoardDefinition, doc: Layout): Layout {
  const defaults = boardSensorDefaults(board);
  if (defaults.length === 0) return doc;
  return { ...doc, layers: doc.layers.map((l) => l.sensorBindings === undefined ? { ...l, sensorBindings: defaults } : l) };
}
