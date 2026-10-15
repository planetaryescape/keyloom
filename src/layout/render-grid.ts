// Plain-text grids of a layout, placed by the board's physical rows (10-cli.md). Pure, so the
// CLI and, later, the agent's get_layout tool print the same text.
import { KEYCODES, type KeyCodeInfo } from "./keycodes.ts";
import type { Binding, Layer, Macro, Mod } from "./schema.ts";

/** Structural, so this module needs nothing from src/boards. */
export type GridKey = { x: number; y: number; w: number; h: number };

export type GridContext = {
  layers: readonly Pick<Layer, "id" | "name">[];
  macros: readonly Pick<Macro, "id">[];
};

const MOD_SYMBOL: Record<Mod, string> = {
  LCTL: "⌃", LSFT: "⇧", LALT: "⌥", LGUI: "⌘",
  RCTL: "r⌃", RSFT: "r⇧", RALT: "r⌥", RGUI: "r⌘",
};

const byName = new Map<string, KeyCodeInfo>(KEYCODES.map((k) => [k.name, k]));

const same = (a: readonly Mod[], b: readonly Mod[]) => a.length === b.length && b.every((m) => a.includes(m));

/** ⌘⇧ for a set of modifiers; the two sets people name get their names. */
export function modsText(mods: readonly Mod[]): string {
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

function layerRef(id: string, ctx: GridContext): string {
  const i = ctx.layers.findIndex((l) => l.id === id);
  return i < 0 ? id : String(i);
}

/** Short cell text for a binding. Full detail is in the JSON form. */
export function bindingLabel(b: Binding, ctx: GridContext): string {
  switch (b.kind) {
    case "key":
      return `${b.mods ? modsText(b.mods) : ""}${shortKeyLabel(b.code)}`;
    case "modifier":
      return modsText(b.mods);
    case "holdTap": {
      const tap = `${b.tap.mods ? modsText(b.tap.mods) : ""}${shortKeyLabel(b.tap.code)}`;
      const hold = "mods" in b.hold ? modsText(b.hold.mods) : `L${layerRef(b.hold.layerId, ctx)}`;
      return `${tap}/${hold}`;
    }
    case "layer": {
      const prefix = { momentary: "MO", toggle: "TG", to: "TO", oneShot: "OSL" }[b.action];
      return `${prefix}${layerRef(b.layerId, ctx)}`;
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
export function rowsOf(geometry: readonly GridKey[]): number[][] {
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
  return rowsOf(geometry).map((row) => {
    let line = "";
    for (const i of row) {
      const key = geometry[i] as GridKey;
      const start = Math.round(key.x * unit);
      const cell = fit(labels[i] as string, Math.max(1, Math.round(key.w * unit) - 1));
      if (width(line) > start) throw new Error(`keys overlap at position ${i}`);
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
  layout: { layers: readonly Layer[]; macros: readonly Pick<Macro, "id">[] },
  opts: GridOptions & { onlyLayerId?: string } = {},
): string {
  const ctx: GridContext = { layers: layout.layers, macros: layout.macros };
  return layout.layers
    .map((layer, i) => ({ layer, i }))
    .filter(({ layer }) => opts.onlyLayerId === undefined || layer.id === opts.onlyLayerId)
    .map(({ layer, i }) => [layerHeading(layer, i), ...renderLayerGrid(geometry, layer, ctx, opts)].join("\n"))
    .join("\n\n");
}
