// Words a graphical cap shares between its legends: modifiers as marks, and layers by the names people read (D-267, D-270). Pure.
import type { GridContext } from "./render-grid.ts";
import type { Mod } from "./schema.ts";

const MOD_GLYPH: Readonly<Record<Mod, string>> = { LCTL: "⌃", RCTL: "⌃", LALT: "⌥", RALT: "⌥", LSFT: "⇧", RSFT: "⇧", LGUI: "⌘", RGUI: "⌘" };

/**
 * Modifiers as a cap prints them: Apple's order (⌃⌥⇧⌘), either side alike, and the two named sets as a mark (✦ Hyper, ◆ Meh). Which side
 * a modifier is on stays in the key's name and its panel (D-267); the terminal grid keeps its own spelling (modsText).
 */
export function capMods(mods: readonly Mod[]): string {
  const glyphs = new Set(mods.map((mod) => MOD_GLYPH[mod]));
  const text = ["⌃", "⌥", "⇧", "⌘"].filter((glyph) => glyphs.has(glyph)).join("");
  if (text === "⌃⌥⇧⌘") return "✦";
  if (text === "⌃⌥⇧") return "◆";
  return text;
}

/** A layer's name as people read it: firmware spelling (default_layer, one_shot) becomes words, starting with a capital. Display only. */
export function layerDisplayName(name: string): string {
  const spaced = name.includes("_") && !/\s/.test(name) ? name.replace(/_+/g, " ").trim() : name;
  if (spaced === "") return name;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// A layer key has about eight letters of room at the legend floor in the condensed width.
const LAYER_NAME_ROOM = 8;

/**
 * What a layer's key prints for it (D-270): the label the person chose, else the layer's name as people read it when it fits, else its
 * first word, else the first three letters ("Navigation" is "Nav"). Never the firmware's spelling.
 */
export function layerLegend(layerId: string, ctx: GridContext): string {
  const layer = ctx.layers.find((candidate) => candidate.id === layerId);
  if (layer === undefined) return layerId;
  if (layer.shortLabel !== undefined) return layer.shortLabel;
  const name = layerDisplayName(layer.name);
  if (name.length <= LAYER_NAME_ROOM) return name;
  const first = name.split(/\s+/)[0] ?? name;
  return first.length <= LAYER_NAME_ROOM ? first : first.slice(0, 3);
}

