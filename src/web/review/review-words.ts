// How the board review's words are drawn (D-340): a title or body carries `{key:<layerId>:<position>}` and `{layer:<layerId>}` markers,
// which the screen draws as caps and chips; the marker, the counts and the line under the config name in words. Pure.
import type { BoardReview } from "../../api/review.ts";
import type { ReviewItem } from "../../validation/review-item.ts";

export type Segment = { kind: "text"; text: string } | { kind: "key"; layerId: string; position: number } | { kind: "layer"; layerId: string };

const MARKER = /\{(key|layer):([^{}:]+)(?::(\d+))?\}/g;

/** A title or body as text, caps and chips, in order. A marker the engine left malformed reads as its text. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKER)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    const [, kind, layerId, position] = m as unknown as [string, string, string, string | undefined];
    if (kind === "key" && position !== undefined) out.push({ kind: "key", layerId, position: Number(position) });
    else if (kind === "layer" && position === undefined) out.push({ kind: "layer", layerId });
    else out.push({ kind: "text", text: m[0] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The items that show: not hidden. */
export const shownItems = (review: BoardReview): ReviewItem[] => review.items.filter((i) => i.dismissedAt === null);

/** "1 problem · 2 hints", "2 hints", or null when there is nothing to note (suggestions are counted under the item they fix). */
export function markerWords(review: BoardReview): string | null {
  const shown = shownItems(review);
  const problems = shown.filter((i) => i.kind === "problem").length;
  const hints = shown.filter((i) => i.kind === "hint").length;
  const loose = shown.filter((i) => i.kind === "suggestion" && i.fixes.length === 0).length;
  const parts = [
    ...(problems > 0 ? [plural(problems, "problem", "problems")] : []),
    ...(hints > 0 ? [plural(hints, "hint", "hints")] : []),
    ...(loose > 0 ? [plural(loose, "suggestion", "suggestions")] : []),
  ];
  return parts.length === 0 ? null : parts.join(" · ");
}

/** Problems, then suggestions (each right under what it fixes when that is shown), then hints. */
export function grouped(review: BoardReview): { problems: ReviewItem[]; suggestions: ReviewItem[]; hints: ReviewItem[] } {
  const shown = shownItems(review);
  return {
    problems: shown.filter((i) => i.kind === "problem"),
    suggestions: shown.filter((i) => i.kind === "suggestion"),
    hints: shown.filter((i) => i.kind === "hint"),
  };
}

/** The suggestions that fix an item, so they sit under it. */
export const fixesFor = (review: BoardReview, id: string): ReviewItem[] => shownItems(review).filter((i) => i.kind === "suggestion" && i.fixes.includes(id));
