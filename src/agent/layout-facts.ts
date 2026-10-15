// Deterministic answers about a layout that the tools return, so the model never has to find
// "where is Option" by reading grids (03#tools). Pure: it reads a document and a board definition.
import type { BoardDefinition } from "../boards/schema.ts";
import { bindingFunctions } from "../layout/functions.ts";
import { isKeyCode } from "../layout/keycodes.ts";
import { type GridContext, bindingLabel } from "../layout/render-grid.ts";
import { type Binding, type Layout, type Mod, ModSchema } from "../layout/schema.ts";

export type Hand = "left" | "right" | "unknown";

export const handOf = (board: BoardDefinition, position: number): Hand =>
  board.hands.left.includes(position) ? "left" : board.hands.right.includes(position) ? "right" : "unknown";

export const fingerOf = (board: BoardDefinition, position: number): string => board.fingers[String(position)] ?? "unknown";

export type Occurrence = {
  layerId: string;
  layerName: string;
  position: number;
  label: string;
  /** `plain` when the binding produces only this function; `tap` or `hold` for the halves of a hold-tap. */
  role: "plain" | "tap" | "hold";
  binding: Binding;
};

/**
 * Accepts the canonical form (`mod:LALT`, `key:A`, `layer:momentary:layer-1`, `macro:id`) and the
 * two spellings a model reaches for first, a bare modifier (`LALT`) or a bare key code (`A`).
 * Null when it is none of them.
 */
export function normalizeFunction(input: string): string | null {
  const text = input.trim();
  if (/^(mod|key|layer|macro|native):/.test(text)) return text;
  if (ModSchema.safeParse(text).success) return `mod:${text}`;
  if (isKeyCode(text)) return `key:${text}`;
  return null;
}

export function findOccurrences(doc: Layout, fn: string): Occurrence[] {
  const ctx: GridContext = { layers: doc.layers, macros: doc.macros };
  const out: Occurrence[] = [];
  for (const layer of doc.layers) {
    for (const [position, binding] of layer.bindings.entries()) {
      const fns = bindingFunctions(binding);
      const at = fns.indexOf(fn);
      if (at < 0) continue;
      const role = binding.kind === "holdTap" ? (at === 0 ? "tap" : "hold") : "plain";
      out.push({ layerId: layer.id, layerName: layer.name, position, label: bindingLabel(binding, ctx), role, binding });
    }
  }
  return out;
}

/** How a layer is reached: the base layer is always active, every other one needs a key that switches to it. */
export function layerAccess(doc: Layout, board: BoardDefinition, layerId: string): string[] {
  if (doc.layers[0]?.id === layerId) return ["base layer, always active"];
  const ctx: GridContext = { layers: doc.layers, macros: doc.macros };
  const out: string[] = [];
  const where = (from: string, position: number) => `${from}:${position} (${handOf(board, position)} ${fingerOf(board, position)})`;
  for (const layer of doc.layers) {
    for (const [position, b] of layer.bindings.entries()) {
      const label = bindingLabel(b, ctx);
      if (b.kind === "layer" && b.layerId === layerId) out.push(`${b.action} by ${where(layer.id, position)} [${label}]`);
      if (b.kind === "holdTap" && "layerId" in b.hold && b.hold.layerId === layerId) out.push(`hold by ${where(layer.id, position)} [${label}]`);
    }
  }
  for (const combo of doc.combos) {
    if (combo.output.kind === "layer" && combo.output.layerId === layerId) out.push(`${combo.output.action} by combo ${combo.id}`);
  }
  return out.length ? out : ["not reachable from any key"];
}

export const MOD_WORDS: Record<Mod, string> = {
  LCTL: "Left Ctrl", LSFT: "Left Shift", LALT: "Left Option/Alt", LGUI: "Left Command/GUI",
  RCTL: "Right Ctrl", RSFT: "Right Shift", RALT: "Right Option/Alt", RGUI: "Right Command/GUI",
};
