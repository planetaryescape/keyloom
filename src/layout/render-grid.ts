// Plain-text grids of a layout, placed by the board's physical rows (10-cli.md). Pure, so the
// CLI and, later, the agent's get_layout tool print the same text.
import { KEYCODES, type KeyCodeInfo } from "./keycodes.ts";
import type { Binding, Layer, Macro, Mod, SlotAction, TapDance } from "./schema.ts";

/** Structural, so this module needs nothing from src/boards. */
export type GridKey = { x: number; y: number; w: number; h: number; r?: number; rx?: number; ry?: number };

/**
 * Where a rotated key actually sits: its box moved so its centre is the rotated centre. A text grid
 * can't draw rotation, and the Glove80's thumb keys share one unrotated x and y, fanned out only by
 * `r` around (rx, ry). Positive r turns clockwise, as in the geometry files and CSS.
 */
export function placedKey(key: GridKey): GridKey {
  if (!key.r) return key;
  const t = (key.r * Math.PI) / 180;
  const ox = key.rx ?? key.x;
  const oy = key.ry ?? key.y;
  const dx = key.x + key.w / 2 - ox;
  const dy = key.y + key.h / 2 - oy;
  const cx = ox + dx * Math.cos(t) - dy * Math.sin(t);
  const cy = oy + dx * Math.sin(t) + dy * Math.cos(t);
  return { x: cx - key.w / 2, y: cy - key.h / 2, w: key.w, h: key.h };
}

export type GridContext = {
  layers: readonly Pick<Layer, "id" | "name">[];
  macros: readonly Pick<Macro, "id">[];
  /** Needed to number a tap dance key; without it one reads "TD?". */
  tapDances?: readonly TapDance[];
};

const MOD_SYMBOL: Record<Mod, string> = {
  LCTL: "⌃", LSFT: "⇧", LALT: "⌥", LGUI: "⌘",
  RCTL: "r⌃", RSFT: "r⇧", RALT: "r⌥", RGUI: "r⌘",
};

const byName = new Map<string, KeyCodeInfo>(KEYCODES.map((k) => [k.name, k]));

const same = (a: readonly Mod[], b: readonly Mod[]) => a.length === b.length && b.every((m) => a.includes(m));

/** ⌘⇧ for a set of modifiers; the two sets people name get their names. */
export function modsText(mods: readonly Mod[]): string {
  // All right-hand: one "r" in front reads better than one per modifier (rHyp, not r⌃r⇧r⌥r⌘).
  if (mods.length > 1 && mods.every((m) => m.startsWith("R"))) {
    return `r${modsText(mods.map((m) => `L${m.slice(1)}` as Mod))}`;
  }
  if (same(mods, ["LCTL", "LSFT", "LALT", "LGUI"])) return "Hyp";
  if (same(mods, ["LCTL", "LSFT", "LALT"])) return "Meh";
  return mods.map((m) => MOD_SYMBOL[m]).join("");
}

/** The shortest readable name for a key: its label if that is short, else its shortest alias. */
export function shortKeyLabel(code: string): string {
  const info = byName.get(code);
  if (!info) return code;
  if (info.label.length <= 5) return info.label;
  const aliases = [...info.qmk.map((n) => n.replace(/^KC_/, "")), ...info.zmk];
  return aliases.reduce((best, n) => (n.length < best.length ? n : best), info.label);
}

/** A key with its modifiers in front: ⌘⇧4. Shared by the terminal grid and the viewer's keycaps. */
export function tapText(code: string, mods?: readonly Mod[]): string {
  return `${mods ? modsText(mods) : ""}${shortKeyLabel(code)}`;
}

function layerRef(id: string, ctx: GridContext): string {
  const i = ctx.layers.findIndex((l) => l.id === id);
  return i < 0 ? id : String(i);
}

const LAYER_PREFIX = { momentary: "MO", toggle: "TG", to: "TO", oneShot: "OSL" } as const;

/** Short text for what one tap dance slot does. */
export function slotLabel(a: SlotAction, ctx: GridContext): string {
  switch (a.kind) {
    case "key": return tapText(a.code, a.mods);
    case "modifier": return modsText(a.mods);
    case "layer": return `${LAYER_PREFIX[a.action]}${layerRef(a.layerId, ctx)}`;
    case "macro": {
      const i = ctx.macros.findIndex((m) => m.id === a.macroId);
      return i < 0 ? "M?" : `M${i}`;
    }
  }
}

/** One line per tap dance, for under the grids: `TD0  Esc tap, Caps Lock double-tap`. */
export function tapDanceLegend(tapDances: readonly TapDance[], ctx: GridContext): string[] {
  return tapDances.map((td, i) => {
    const slots = [
      `${slotLabel(td.tap, ctx)} tap`,
      td.hold ? `${slotLabel(td.hold, ctx)} hold` : "",
      td.doubleTap ? `${slotLabel(td.doubleTap, ctx)} double-tap` : "",
      td.tapThenHold ? `${slotLabel(td.tapThenHold, ctx)} tap then hold` : "",
    ].filter((t) => t !== "");
    return `TD${i}  ${td.name}: ${slots.join(", ")}${td.termMs === undefined ? "" : `, term ${td.termMs} ms`}`;
  });
}

/** Short cell text for a binding. Full detail is in the JSON form. */
export function bindingLabel(b: Binding, ctx: GridContext): string {
  switch (b.kind) {
    case "key":
      return tapText(b.code, b.mods);
    case "modifier":
      return modsText(b.mods);
    case "holdTap": {
      const tap = tapText(b.tap.code, b.tap.mods);
      const hold = "mods" in b.hold ? modsText(b.hold.mods) : `L${layerRef(b.hold.layerId, ctx)}`;
      return `${tap}/${hold}`;
    }
    case "layer": {
      return `${LAYER_PREFIX[b.action]}${layerRef(b.layerId, ctx)}`;
    }
    case "tapDance": {
      const i = ctx.tapDances?.findIndex((t) => t.id === b.tapDanceId) ?? -1;
      return i < 0 ? "TD?" : `TD${i}`;
    }
    case "macro": {
      const i = ctx.macros.findIndex((m) => m.id === b.macroId);
      return i < 0 ? "M?" : `M${i}`;
    }
    case "transparent":
      return "▽";
    case "none":
      return "×";
    case "native":
      return b.label;
  }
}

/** Visible width. Every glyph used here is one cell wide. */
const width = (s: string) => [...s].length;

function fit(text: string, cells: number): string {
  const chars = [...text];
  const clipped = chars.length > cells ? `${chars.slice(0, cells - 1).join("")}…` : text;
  const pad = cells - width(clipped);
  const left = Math.floor(pad / 2);
  return " ".repeat(left) + clipped + " ".repeat(pad - left);
}

/**
 * Splits keys into rows. The Moonlander and similar boards stagger columns by up to 0.4u, so a
 * row is a chain of keys whose y values are less than half a unit apart.
 */
export function rowsOf(keys: readonly GridKey[]): number[][] {
  const geometry = keys.map(placedKey);
  const order = geometry.map((_, i) => i).sort((a, b) => (geometry[a] as GridKey).y - (geometry[b] as GridKey).y || a - b);
  const rows: number[][] = [];
  let lastY = Number.NEGATIVE_INFINITY;
  for (const i of order) {
    const y = (geometry[i] as GridKey).y;
    if (rows.length === 0 || y - lastY >= 0.5) rows.push([]);
    rows[rows.length - 1]?.push(i);
    lastY = y;
  }
  return rows.map((row) => row.sort((a, b) => (geometry[a] as GridKey).x - (geometry[b] as GridKey).x || a - b));
}

export type GridOptions = { cellWidth?: number };

/** Places one label per key by the key's x, row by row; every line is right-trimmed. */
export function renderCells(geometry: readonly GridKey[], labels: readonly string[], opts: GridOptions = {}): string[] {
  const unit = opts.cellWidth ?? 7;
  if (labels.length !== geometry.length) {
    throw new Error(`${labels.length} labels for ${geometry.length} keys`);
  }
  const placed = geometry.map(placedKey);
  return rowsOf(geometry).map((row) => {
    let line = "";
    for (const i of row) {
      const key = placed[i] as GridKey;
      const cell = fit(labels[i] as string, Math.max(1, Math.round(key.w * unit) - 1));
      // Keys turned toward each other (a thumb fan) can land closer than a cell apart; nudge the
      // later one right rather than drop it, since every key must appear.
      const start = Math.max(Math.round(key.x * unit), line === "" ? 0 : width(line) + 1);
      line += " ".repeat(start - width(line)) + cell;
    }
    return line.trimEnd();
  });
}

/** One layer as a grid. */
export function renderLayerGrid(geometry: readonly GridKey[], layer: Layer, ctx: GridContext, opts: GridOptions = {}): string[] {
  if (layer.bindings.length !== geometry.length) {
    throw new Error(`layer ${layer.id} has ${layer.bindings.length} bindings but the board has ${geometry.length} keys`);
  }
  return renderCells(geometry, layer.bindings.map((b) => bindingLabel(b, ctx)), opts);
}

const layerHeading = (layer: Pick<Layer, "id" | "name">, index: number): string =>
  layer.name === `Layer ${index}` ? `Layer ${index} (${layer.id})` : `Layer ${index}: ${layer.name} (${layer.id})`;

/** Every layer, or one when `onlyLayerId` is given, each under a heading. */
export function renderLayout(
  geometry: readonly GridKey[],
  layout: { layers: readonly Layer[]; macros: readonly Pick<Macro, "id">[]; tapDances?: readonly TapDance[] },
  opts: GridOptions & { onlyLayerId?: string } = {},
): string {
  const ctx: GridContext = { layers: layout.layers, macros: layout.macros, ...(layout.tapDances ? { tapDances: layout.tapDances } : {}) };
  return layout.layers
    .map((layer, i) => ({ layer, i }))
    .filter(({ layer }) => opts.onlyLayerId === undefined || layer.id === opts.onlyLayerId)
    .map(({ layer, i }) => [layerHeading(layer, i), ...renderLayerGrid(geometry, layer, ctx, opts)].join("\n"))
    .concat(layout.tapDances?.length ? [["Tap dances:", ...tapDanceLegend(layout.tapDances, ctx).map((l) => `  ${l}`)].join("\n")] : [])
    .join("\n\n");
}
