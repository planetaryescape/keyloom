// The line under a layer's name that says how to get to it from the first layer, in the words a person uses: "Hold ⇥ on the left
// thumb". The key is its own part, so the caption can print it as a keycap. Pure, so the caption and its tests agree.
import type { Layout } from "../../layout/schema.ts";
import { reachKey } from "./layer-light.ts";

/** "Hold", the key's legend, "on the left thumb": the key is drawn as a keycap between the words. */
export type ReachWords = { before: string; key: string | null; after: string };

function fingerWords(finger: string | undefined): string | null {
  if (finger === undefined) return null;
  const [side, digit] = finger.split("-");
  if (side === undefined || digit === undefined) return null;
  return digit === "thumb" ? `${side} thumb` : `${side} ${digit} finger`;
}

/**
 * `legendOf` gives the printed legend of a key on the first layer, which is how the person knows it. `fingers` is the board's finger
 * map by position, so the line can say which hand.
 */
export function reachWords(
  layout: Pick<Layout, "layers" | "tapDances">,
  index: number,
  fingers: Readonly<Record<string, string>>,
  legendOf: (position: number) => string,
): ReachWords {
  const words = (before: string, key: string | null = null, after = ""): ReachWords => ({ before, key, after });
  if (index === 0) return words("Your first layer");
  const layer = layout.layers[index];
  if (layer === undefined) return words("");
  const thumbs = new Set(Object.entries(fingers).flatMap(([p, f]) => (f.endsWith("thumb") ? [Number(p)] : [])));
  const position = reachKey(layout, layer.id, thumbs);
  if (position === null) return words("No key on the first layer reaches it");
  const binding = layout.layers[0]?.bindings[position];
  const where = fingerWords(fingers[String(position)]);
  const label = legendOf(position) || `key ${position + 1}`;
  const on = where === null ? "" : ` on the ${where}`;
  if (binding?.kind === "holdTap") return words("Hold", label, on);
  if (binding?.kind === "layer") {
    switch (binding.action) {
      case "momentary": return words("Hold", label, on);
      case "toggle": return words("Toggled with", label, on);
      case "to": return words("Tap", label, `${on} to go there`);
      case "oneShot": return words("Tap", label, `${on} for one key`);
    }
  }
  return words("From", label, on);
}
