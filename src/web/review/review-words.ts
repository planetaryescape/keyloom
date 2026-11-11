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

/** Counts every visible item, including suggestions nested under findings. */
export function markerWords(review: BoardReview): string | null {
  const shown = shownItems(review);
  const problems = shown.filter((i) => i.kind === "problem").length;
  const hints = shown.filter((i) => i.kind === "hint").length;
  const suggestions = shown.filter((i) => i.kind === "suggestion").length;
  const parts = [
    ...(problems > 0 ? [plural(problems, "problem", "problems")] : []),
    ...(hints > 0 ? [plural(hints, "hint", "hints")] : []),
    ...(suggestions > 0 ? [plural(suggestions, "suggestion", "suggestions")] : []),
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

// A key with no legend says nothing as a cap, so the review says where it is instead, in the board's own rows (D-340).
const ROW_PLACES: Readonly<Record<string, string>> = {
  function: "on the function row", number: "on the number row", top: "on the top row", home: "on the home row",
  bottom: "on the bottom row", lower: "on the lowest row", thumb: "by the thumbs",
};

/** Where a key sits, in words: "on the function row", "by the thumbs". */
export function placeOf(position: number, rows: Readonly<Record<string, readonly number[]>>): string {
  const row = Object.entries(rows).find(([, positions]) => positions.includes(position))?.[0];
  if (row === undefined) return "elsewhere on the board";
  return ROW_PLACES[row] ?? `on the ${row} row`;
}

/** "5 on the function row, 4 by the thumbs": keys counted by where they sit, most first; one key is just its place. */
export function placeWords(positions: readonly number[], rows: Readonly<Record<string, readonly number[]>>): string {
  const counts = new Map<string, number>();
  for (const p of positions) {
    const place = placeOf(p, rows);
    counts.set(place, (counts.get(place) ?? 0) + 1);
  }
  if (positions.length === 1) return [...counts.keys()][0] ?? "";
  // A stable sort keeps the board's own row order among places with the same count.
  return [...counts].sort((a, b) => b[1] - a[1]).map(([place, n]) => `${n} ${place}`).join(", ");
}

/**
 * Why there are no suggestions, and what to do (R4-10). `unavailable` with no model recorded means none is set up, so only the setup helps.
 * With a model recorded, the provider refused the account (a key it rejects, no credits, no access). That is fixed in the model setup or at
 * the provider, so it offers the setup, Add credits when the code says the account ran out, and Try again for after it is fixed at the
 * provider, where keyloom can't see it (#288 review). Anything else that stopped the look can be tried again. By the code, never the text.
 */
export type AiMissingAction = "credits" | "set_up" | "retry";
export type AiMissing = { words: string; actions: readonly AiMissingAction[]; refused: boolean };
export function aiMissingWords(ai: BoardReview["ai"]): AiMissing {
  if (ai.status === "unavailable" && ai.model === null) return { words: "Suggestions need a model, and none is set up.", actions: ["set_up"], refused: false };
  if (ai.status === "unavailable" && ai.code === "no_credits") {
    return { words: "The model account is out of credits, so there are no suggestions this time. Add credits, then try again.", actions: ["credits", "set_up", "retry"], refused: true };
  }
  if (ai.status === "unavailable") {
    return { words: "The model provider refused this key or account, so there are no suggestions this time. Fix the account or change the key, then try again.", actions: ["set_up", "retry"], refused: true };
  }
  return { words: "keyloom's own look didn't finish, so there are no suggestions this time.", actions: ["retry"], refused: false };
}

/**
 * Why Apply on a suggestion did not change the config, and the way on (R4-07). Only an answer of 400 or more proves nothing was applied.
 * A suggestion made for an earlier version, or one the validator now refuses, can't be applied by asking again, so it offers a fresh
 * review; one that is no longer open says so the same way; any other refusal can be tried again. Anything else (no answer, an answer the
 * page couldn't read, or a failure after the Apply landed) leaves the outcome unknown, so the page reads the proposals again before it
 * offers Apply. By the server's code only, never its text.
 */
export type ApplyFailure = { words: string; action: "fresh_review" | "retry" | "check" | "show" };

/** The Apply landed but the page couldn't read the new layout, so the board still shows the old one (#288 review). */
export const APPLIED_NOT_SHOWN: ApplyFailure = { words: "Applied. keyloom couldn't show the new layout yet.", action: "show" };
export function applyFailureWords(error: { code: string | undefined; status: number; message: string }): ApplyFailure {
  if (error.status < 400) return { words: "keyloom didn't confirm this Apply, so it may have gone through. Check before applying it again.", action: "check" };
  if (error.code === "stale_base" || error.code === "validation_failed") return { words: "This suggestion no longer fits your config, so nothing was applied.", action: "fresh_review" };
  if (error.code === "not_found" || error.code === "usage") return { words: "This suggestion is no longer open, so nothing was applied.", action: "fresh_review" };
  return { words: `Nothing was applied: ${error.message}`, action: "retry" };
}
