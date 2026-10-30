// The board review's item (D-340): one finding about a layout, from the checks or from the agent. Pure, so the web app can read the
// markers in a title or body and draw them as caps and chips.
import { z } from "zod";

export const ReviewKeySchema = z.object({ layerId: z.string().min(1), position: z.number().int().nonnegative() });
export type ReviewKey = z.infer<typeof ReviewKeySchema>;

export const ReviewItemSchema = z.object({
  /** Stable across revisions for the same finding (`itemId`), so a dismissal follows it. */
  id: z.string().min(1),
  source: z.enum(["check", "agent"]),
  kind: z.enum(["problem", "hint", "suggestion"]),
  /** Problems are "error" or "warning"; hints and suggestions are "info". */
  severity: z.enum(["error", "warning", "info"]),
  /** The validator's code (layer_unreachable, ...) for a check; the agent's kebab-case topic for an agent item. */
  code: z.string().min(1),
  title: z.string().min(1),
  /** Keys and layers are marked `{key:<layerId>:<position>}` and `{layer:<layerId>}` for the screen to draw. */
  body: z.string().min(1),
  keys: z.array(ReviewKeySchema),
  layers: z.array(z.string().min(1)),
  /** A suggestion's change set, proposed and validated against the head, outside any conversation. Null otherwise. */
  proposalId: z.string().min(1).nullable(),
  /** For a suggestion: the ids of the problem or hint items it fixes, so the screen can put it under them and tick them when it is applied. */
  fixes: z.array(z.string().min(1)),
  /** When BK hid it; it stays hidden on later revisions while `id` matches. */
  dismissedAt: z.number().finite().nullable(),
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

/**
 * The findings a fix run works from (D-461): the problems and hints that show. A suggestion is already a proposal BK can apply, and a
 * hidden finding is his decision, so neither is a reason to build another change.
 */
export const fixableFindings = (items: readonly ReviewItem[]): ReviewItem[] =>
  items.filter((item) => item.dismissedAt === null && (item.kind === "problem" || item.kind === "hint"));

/** An item the previous review had and this revision no longer produces. */
export const FixedItemSchema = ReviewItemSchema.extend({ fixedSince: z.string().min(1) });
export type FixedItem = z.infer<typeof FixedItemSchema>;

// FNV-1a: a long list of keys (a whole empty layer) would make an unreadable id, and this needs no crypto module.
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

const MAX_READABLE = 80;

/**
 * `${source}:${code}:${layerIds}:${slots}`, derived from what the finding is about and never from its wording, so a reworded
 * title or body keeps the id and a hidden finding stays hidden. The keys are part of it: a finding about different keys is a
 * different finding.
 */
export function itemId(input: { source: ReviewItem["source"]; code: string; layers: readonly string[]; keys: readonly ReviewKey[] }): string {
  const layers = [...new Set(input.layers)].sort().join(",");
  const slots = input.keys.map((k) => `${k.layerId}/${k.position}`).sort().join(",");
  return `${input.source}:${input.code}:${layers}:${slots.length > MAX_READABLE ? `${input.keys.length}k-${shortHash(slots)}` : slots}`;
}

const MARKER = /\{(key|layer):([^{}:]+)(?::(\d+))?\}/g;

/**
 * Keeps the markers that name a layer and key the layout has and writes the rest as plain text, so a model that invents a layer
 * never puts a chip on the screen that points at nothing.
 */
export function cleanMarkers(text: string, layers: ReadonlyMap<string, { name: string; keyCount: number }>): string {
  return text.replace(MARKER, (whole, kind: string, layerId: string, position: string | undefined) => {
    const layer = layers.get(layerId);
    if (layer === undefined) return layerId;
    if (kind === "layer") return position === undefined ? whole : layer.name;
    if (position === undefined) return layer.name;
    return Number(position) < layer.keyCount ? whole : `key ${Number(position) + 1} on ${layer.name}`;
  });
}
