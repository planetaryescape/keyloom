// Each layer has one colour: its light (D-263). It shows as the board's underglow, on the strip's lit miniature, and as the dot on
// every key that reaches the layer. Pure, so the board, the strip and the tests agree on it.
import { colourAt, hsvToHex, isDark } from "../../layout/colour.ts";
import { layerColorOf } from "../../layout/layer-ops.ts";
import type { Binding, Hsv, Layer, Layout } from "../../layout/schema.ts";

const key = (hsv: Hsv) => hsv.join(",");

// The colour most of a layer's keys are lit, ignoring dark keys, so a layer whose LEDs are mostly red with blue arrows reads as red.
function dominant(lighting: NonNullable<Layer["lighting"]>, keyCount: number): Hsv | null {
  const counts = new Map<string, { hsv: Hsv; n: number }>();
  for (let position = 0; position < keyCount; position++) {
    const hsv = colourAt({ lighting }, position);
    if (isDark(hsv)) continue;
    const entry = counts.get(key(hsv)) ?? { hsv, n: 0 };
    entry.n += 1;
    counts.set(key(hsv), entry);
  }
  let best: { hsv: Hsv; n: number } | null = null;
  for (const entry of counts.values()) if (best === null || entry.n > best.n) best = entry;
  return best?.hsv ?? null;
}

/**
 * A layer's light as a CSS colour, or null for a layer that is unlit.
 *
 * Its LED colours come first, because they are what the keyboard itself shows on that layer. Without LEDs, a layer the person gave a
 * colour keeps it, and any other layer but the first is lit in the colour its place picks. The first layer with no LEDs and no chosen
 * colour is the board at rest: no light.
 */
export function layerLight(layers: readonly Layer[], index: number, keyCount: number): string | null {
  const layer = layers[index];
  if (layer === undefined) return null;
  if (layer.lighting !== undefined) {
    const lit = dominant(layer.lighting, keyCount);
    if (lit !== null) return hsvToHex(lit);
  }
  if (index === 0 && layer.color === undefined) return null;
  return `var(--layer-${layerColorOf(layers, index)})`;
}

/** The layer a key takes you to, if it reaches one: a layer key, a hold-tap that holds a layer, or a tap dance with a layer slot. */
export function reachedLayer(binding: Binding | undefined, layout: Pick<Layout, "tapDances">): string | null {
  if (binding === undefined) return null;
  if (binding.kind === "layer") return binding.layerId;
  if (binding.kind === "holdTap") return "layerId" in binding.hold ? binding.hold.layerId : null;
  if (binding.kind === "tapDance") {
    const dance = layout.tapDances.find((candidate) => candidate.id === binding.tapDanceId);
    const slot = [dance?.hold, dance?.tapThenHold, dance?.doubleTap, dance?.tap].find((action) => action?.kind === "layer");
    return slot?.kind === "layer" ? slot.layerId : null;
  }
  return null;
}

/**
 * The key a layer is reached from, on the first layer: where its light change starts (D-265). A held key first, since holding is how
 * a layer is usually used, then any other. Null when nothing on the first layer reaches it.
 */
export function reachKey(layout: Pick<Layout, "layers" | "tapDances">, layerId: string, thumbs: ReadonlySet<number>): number | null {
  const base = layout.layers[0];
  if (base === undefined) return null;
  const reaching = base.bindings.flatMap((binding, position) => (reachedLayer(binding, layout) === layerId ? [position] : []));
  const held = (position: number) => {
    const binding = base.bindings[position];
    return binding?.kind === "holdTap" || (binding?.kind === "layer" && binding.action === "momentary");
  };
  return reaching.find((p) => held(p) && thumbs.has(p)) ?? reaching.find(held) ?? reaching[0] ?? null;
}
