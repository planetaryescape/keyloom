// What an importer tells the person after reading a firmware source (05, 06): shared by the QMK and
// ZMK importers so the CLI, the app and the report table treat both the same way.
import type { Binding } from "./schema.ts";

export type NativeItem = { layerId: string; position: number; source: string; label: string; reason: string };
export type PassthroughItem = { file: string; anchor: string; refersToLayerIndices: boolean };

export type ImportReport = {
  boardId: string;
  layers: number;
  keysPerLayer: number;
  /** Bindings across all layers, by kind. */
  bindings: Record<Binding["kind"], number>;
  macros: string[];
  tapDances: string[];
  combos: number;
  settings: number;
  profiles: string[];
  native: NativeItem[];
  passthrough: PassthroughItem[];
  warnings: string[];
};
