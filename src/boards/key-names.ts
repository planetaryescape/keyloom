// A key as a person names it (D-279): by what its cap prints and where it sits under the hand, never by its number. "S (left ring,
// home row, Layer 0)", "Numbers hold (left red thumb key)". Positions stay in the structured fields that ops and tools carry; these
// words are for sentences.
import type { Slot } from "../layout/change.ts";
import { layerDisplayName } from "../layout/cap-words.ts";
import { bindingLegend, type Legend } from "../layout/legend.ts";
import type { GridContext } from "../layout/render-grid.ts";
import type { Layout } from "../layout/schema.ts";
import { keyCentre } from "./key-slots.ts";
import type { BoardDefinition, Geometry } from "./schema.ts";

type Board = Pick<BoardDefinition, "fingers" | "rows" | "hands" | "display">;

const rowOf = (def: Board, position: number): string | null => Object.entries(def.rows).find(([, positions]) => positions.includes(position))?.[0] ?? null;

/**
 * Where a key sits: "left ring, home row", "right index, top row, inner", "left red thumb key", "right thumb, outer". Inner and outer
 * only when the same finger has more than one key in that row (index and pinky columns), and only with geometry to tell them apart.
 */
export function keyPlace(def: Board, position: number, geometry?: Pick<Geometry, "keys">): string {
  const raw = def.fingers[String(position)];
  const [hand, finger] = raw === undefined || !raw.includes("-") ? [null, null] : (raw.split("-", 2) as [string, string]);
  const row = rowOf(def, position);
  const red = def.display?.keycaps?.[String(position)] === "red";
  if (hand === null || finger === null) return row === null ? "a key off the hands" : `${row} row`;
  const sameSpot = Object.entries(def.fingers)
    .filter(([p, f]) => f === raw && (finger === "thumb" || rowOf(def, Number(p)) === row))
    .map(([p]) => Number(p));
  const side = sameSpot.length > 1 && geometry !== undefined ? innerOrOuter(position, sameSpot, hand, geometry) : null;
  if (finger === "thumb") {
    if (red) return `${hand} red thumb key`;
    return side === null ? `${hand} thumb` : `${hand} thumb, ${side}`;
  }
  return `${hand} ${finger}, ${row ?? "off the rows"}${row === null ? "" : " row"}${side === null ? "" : `, ${side}`}`;
}

// Inner is toward the other hand. A key in the middle of three shares neither end, so it is "middle".
function innerOrOuter(position: number, group: readonly number[], hand: string, geometry: Pick<Geometry, "keys">): string | null {
  const xs = group.map((p) => ({ p, x: geometry.keys[p] === undefined ? null : keyCentre(geometry.keys[p]).x })).filter((k): k is { p: number; x: number } => k.x !== null);
  if (xs.length < 2) return null;
  xs.sort((a, b) => (hand === "left" ? b.x - a.x : a.x - b.x));
  const i = xs.findIndex((k) => k.p === position);
  if (i < 0) return null;
  return i === 0 ? "inner" : i === xs.length - 1 ? "outer" : "middle";
}

/** What the cap prints, as words a sentence can hold: "S", "S hold ⌥", "Nav once", "blank". A layer key's small legend already says how. */
export function legendWords(legend: Pick<Legend, "kind" | "tap" | "hold">): string {
  if (legend.tap === "" && legend.hold === undefined) return "blank";
  if (legend.hold === undefined) return legend.tap;
  return legend.kind === "holdTap" ? `${legend.tap} hold ${legend.hold}` : `${legend.tap} ${legend.hold}`;
}

/** "S hold ⌥ (left ring, home row, Layer 0)": what the key does now and where it is. The layer is left out when the sentence has it. */
export function keyName(def: Board, layout: Pick<Layout, "layers" | "macros" | "tapDances">, slot: Slot, opts: { geometry?: Pick<Geometry, "keys">; withLayer?: boolean } = {}): string {
  const layer = layout.layers.find((l) => l.id === slot.layerId);
  const binding = layer?.bindings[slot.position];
  const ctx: GridContext = { layers: layout.layers, macros: layout.macros, tapDances: layout.tapDances };
  const what = binding === undefined ? "blank" : legendWords(bindingLegend(binding, ctx));
  const place = keyPlace(def, slot.position, opts.geometry);
  const where = opts.withLayer === false || layer === undefined ? place : `${place}, ${layerDisplayName(layer.name)}`;
  return `${what} (${where})`;
}
