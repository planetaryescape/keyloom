// Oryx's ledmap -> per-layer lighting (D-190). The three blocks Oryx writes are read into the model only when writing the
// model back gives exactly the text that was read; anything else (a hand-edited ledmap, a second effect) stays passthrough
// and is reported, so reading never changes what the board would do.
import type { Hsv, Layer, LayerLighting, Layout } from "../../layout/schema.ts";
import type { Chunk } from "./keymap-c.ts";
import { DARK } from "../../layout/colour.ts";
import { SET_LAYER_COLOR, renderIndicators, renderLedmap } from "./emit-lighting.ts";

export const LEDMAP_ANCHOR = "rgb-ledmap";
export const SET_LAYER_COLOR_ANCHOR = "rgb-set-layer-color";
export const INDICATORS_ANCHOR = "rgb-indicators";
export const LIGHTING_ANCHORS = [LEDMAP_ANCHOR, SET_LAYER_COLOR_ANCHOR, INDICATORS_ANCHOR] as const;

export type LightingRead = { lighting: Map<number, LayerLighting>; consumed: Set<string> };

const ROW = /^ {4}\[(\d+)\] = \{ (.*) \},$/;
const TRIPLE = /\{(\d+),(\d+),(\d+)\}/g;

const same = (a: Hsv, b: Hsv) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** The most common colour wins as the layer's; ties go to the one that appears first, so the same ledmap always reads the same way. */
function toLighting(byPosition: readonly Hsv[]): LayerLighting {
  const tally: Array<{ colour: Hsv; count: number }> = [];
  for (const colour of byPosition) {
    const seen = tally.find((t) => same(t.colour, colour));
    if (seen) seen.count++;
    else tally.push({ colour, count: 1 });
  }
  const base = tally.reduce((best, t) => (t.count > best.count ? t : best), tally[0] as { colour: Hsv; count: number }).colour;
  const keys: Record<string, Hsv> = {};
  byPosition.forEach((colour, position) => {
    if (!same(colour, base)) keys[String(position)] = colour;
  });
  return {
    ...(same(base, DARK) ? {} : { layer: base }),
    ...(Object.keys(keys).length === 0 ? {} : { keys }),
  };
}

/**
 * `layers` are the keymap's, in keymaps[] order, that the colours will be written back onto; `ledPositions` is the board's
 * LED number -> key position table. Returns null, with the reason, when the blocks aren't Oryx's.
 */
export function readLighting(
  chunks: readonly Chunk[],
  layers: readonly Layer[],
  ledPositions: readonly number[],
): LightingRead | { problem: string } | null {
  const ledmap = chunks.find((c) => c.anchor === LEDMAP_ANCHOR);
  const setColor = chunks.find((c) => c.anchor === SET_LAYER_COLOR_ANCHOR);
  const indicators = chunks.find((c) => c.anchor === INDICATORS_ANCHOR);
  if (!ledmap && !setColor && !indicators) return null;
  const kept = (why: string) => ({ problem: `the layer colours were kept as code: ${why}` });
  if (!ledmap || !setColor || !indicators) return kept("one of ledmap, set_layer_color and rgb_matrix_indicators_user is missing");
  if (LIGHTING_ANCHORS.some((a) => chunks.filter((c) => c.anchor.startsWith(a)).length !== 1)) return kept("a block appears more than once");

  const lighting = new Map<number, LayerLighting>();
  for (const line of ledmap.source.split("\n")) {
    const row = ROW.exec(line);
    if (!row) continue;
    const index = Number(row[1]);
    const leds = [...(row[2] as string).matchAll(TRIPLE)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as Hsv);
    if (leds.length !== ledPositions.length) return kept(`layer ${index} has ${leds.length} LEDs, but the board has ${ledPositions.length}`);
    if (leds.some((l) => l.some((n) => n > 255))) return kept(`layer ${index} has a colour value over 255`);
    const byPosition = new Array<Hsv>(ledPositions.length).fill(DARK);
    leds.forEach((colour, led) => {
      byPosition[ledPositions[led] as number] = colour;
    });
    if (index >= layers.length) return kept(`ledmap names layer ${index}, which the keymap doesn't have`);
    lighting.set(index, toLighting(byPosition));
  }

  const candidate = layers.map((layer, i) => (lighting.has(i) ? { ...layer, lighting: lighting.get(i) as LayerLighting } : layer));
  if (renderLedmap(candidate, ledPositions) !== ledmap.source) return kept("the ledmap is not in the form Oryx writes");
  if (setColor.source !== SET_LAYER_COLOR) return kept("set_layer_color is not the one Oryx writes");
  if (renderIndicators(candidate) !== indicators.source) return kept("rgb_matrix_indicators_user does not match the ledmap");
  return { lighting, consumed: new Set(LIGHTING_ANCHORS) };
}

/**
 * Layouts imported before the layer colours were modelled hold Oryx's whole RGB section as one passthrough piece. This splits that
 * piece back into its blocks and reads them the way a fresh import would; null when there is nothing to read or it doesn't read
 * back exactly (the layout is then left as it is). The helper and post-init code stay passthrough.
 */
export function upgradeLegacyLighting(layout: Layout, ledPositions: readonly number[]): Layout | null {
  if (layout.firmware !== "qmk" || layout.layers.some((l) => l.lighting !== undefined)) return null;
  const at = layout.passthrough.findIndex((p) => p.file === "keymap.c" && p.anchor === "rgb" && p.source.includes("ledmap[]"));
  const piece = layout.passthrough[at];
  if (piece === undefined) return null;
  const ledmapAt = piece.source.indexOf("const uint8_t PROGMEM ledmap");
  const setAt = piece.source.indexOf("void set_layer_color");
  const indicatorsAt = piece.source.indexOf("bool rgb_matrix_indicators_user");
  if (ledmapAt < 0 || setAt < ledmapAt || indicatorsAt < setAt) return null;
  const cut = (from: number, to: number) => piece.source.slice(from, to).replace(/\s+$/, "");
  const chunks: Chunk[] = [
    { anchor: LEDMAP_ANCHOR, source: cut(ledmapAt, setAt) },
    { anchor: SET_LAYER_COLOR_ANCHOR, source: cut(setAt, indicatorsAt) },
    { anchor: INDICATORS_ANCHOR, source: piece.source.slice(indicatorsAt).replace(/\s+$/, "") },
  ];
  const read = readLighting(chunks, layout.layers, ledPositions);
  if (read === null || "problem" in read) return null;
  const prelude = piece.source.slice(0, ledmapAt).replace(/\s+$/, "");
  const passthrough = layout.passthrough.flatMap((p, i) => (i !== at ? [p] : prelude === "" ? [] : [{ ...p, source: prelude, refersToLayerIndices: false }]));
  return {
    ...layout,
    layers: layout.layers.map((layer, i) => (read.lighting.has(i) ? { ...layer, lighting: read.lighting.get(i) as LayerLighting } : layer)),
    passthrough,
  };
}
