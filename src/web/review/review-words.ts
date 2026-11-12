// How the board review's words are drawn (D-340): a title or body carries `{key:<layerId>:<position>}` and `{layer:<layerId>}` markers,
// which the screen draws as caps and chips; the marker, the counts and the line under the config name in words. Pure.
import type { ChatProviderStatus } from "../../api/http.ts";
import type { BoardReview } from "../../api/review.ts";
import type { ReviewItem } from "../../validation/review-item.ts";

/** A message as a sentence that ends in a full stop. */
export const sentence = (text: string): string => text.trim().replace(/([^.!?])$/, "$1.");

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
export type AiMissingAction = "credits" | "set_up" | "switch" | "set_up_other" | "retry";
export type AiMissing = { words: string; actions: readonly AiMissingAction[]; refused: boolean; reasonShown?: true };
/**
 * `canSwitch` is false when --provider or KEYLOOM_PROVIDER fixes the model, so no other one can take the review, and while the provider
 * status is unread, so a lock is not known yet. `nowOn` names the provider keyloom uses now when it is no longer the one the look failed
 * on (a switch in chat since): Try again runs on that one, so the words say so and offer no switch.
 */
export function aiMissingWords(ai: BoardReview["ai"], canSwitch = true, nowOn: string | null = null): AiMissing {
  if (ai.status === "unavailable" && ai.model === null) return { words: "Suggestions need a model, and none is set up.", actions: ["set_up"], refused: false };
  // A used-up plan stays used up until it resets, so Try again alone is no way on: another model is, as in chat (R5-04, R6-01). The
  // reason is Codex's reset sentence in keyloom's words, so it shows in place, not behind Details.
  if (ai.status === "unavailable" && ai.code === "usage_limit") {
    const why = ai.reason === null ? "" : ` ${sentence(ai.reason)}`;
    if (nowOn !== null) return { words: `Your Codex usage limit was reached, so there are no suggestions this time.${why} keyloom now uses ${nowOn}, so Try again runs the review on ${nowOn}.`, actions: ["retry"], refused: false, reasonShown: true };
    if (!canSwitch) return { words: `Your Codex usage limit is reached, so there are no suggestions this time.${why} Try again once the limit lifts.`, actions: ["retry"], refused: false, reasonShown: true };
    return { words: `Your Codex usage limit is reached, so there are no suggestions this time.${why} Switch to another model, or try again once the limit lifts.`, actions: ["switch", "set_up_other", "retry"], refused: false, reasonShown: true };
  }
  if (ai.status === "unavailable" && ai.code === "no_credits") {
    return { words: "The model account is out of credits, so there are no suggestions this time. Add credits, then try again.", actions: ["credits", "set_up", "retry"], refused: true };
  }
  if (ai.status === "unavailable") {
    return { words: "The model provider refused this key or account, so there are no suggestions this time. Fix the account or change the key, then try again.", actions: ["set_up", "retry"], refused: true };
  }
  return { words: "keyloom's own look didn't finish, so there are no suggestions this time.", actions: ["retry"], refused: false };
}

/** The provider a look failed on, by its code: `usage_limit` comes only from Codex (src/agent/codex/errors.ts). Null when not known. */
export const failedProvider = (ai: BoardReview["ai"]): ChatProviderStatus["providers"][number]["id"] | null => (ai.code === "usage_limit" ? "codex" : null);

/**
 * The ready providers a review can switch to: none while the status is unread or a lock fixes the model, and never the one in use or the
 * one the look failed on, so a switch can't lead back to a used-up plan (R6-01 review).
 */
export function switchTargets(status: ChatProviderStatus | null, failedOn: ChatProviderStatus["providers"][number]["id"] | null): ChatProviderStatus["providers"][number]["id"][] {
  if (status === null || status.lockedBy !== null) return [];
  const active = status.active?.provider;
  return status.providers.filter((p) => p.ready && p.id !== active && p.id !== failedOn).map((p) => p.id);
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
/** Show the new layout failed again (R5-09): the change is still applied, so the words say that, with why, and the button stays. */
export function appliedNotShown(error: unknown): ApplyFailure {
  const why = error instanceof Error && error.message.trim() !== "" ? ` ${sentence(error.message)}` : "";
  return { words: `Applied. keyloom still couldn't show the new layout.${why}`, action: "show" };
}
export function applyFailureWords(error: { code: string | undefined; status: number; message: string }): ApplyFailure {
  if (error.status < 400) return { words: "keyloom didn't confirm this Apply, so it may have gone through. Check before applying it again.", action: "check" };
  if (error.code === "stale_base" || error.code === "validation_failed") return { words: "This suggestion no longer fits your config, so nothing was applied.", action: "fresh_review" };
  if (error.code === "not_found" || error.code === "not_open") return { words: "This suggestion is no longer open, so nothing was applied.", action: "fresh_review" };
  // A review suggestion that no longer preserves the config is refused as usage; a fresh review makes one that does.
  if (error.code === "usage") return { words: "This suggestion no longer fits your config, so nothing was applied.", action: "fresh_review" };
  return { words: `Nothing was applied: ${error.message}`, action: "retry" };
}

/** The review request that failed, so its Try again repeats that one request (R5-03, R5-10). */
export type ReviewAction = "load" | "run" | "dismiss" | "restore" | "stop";

/**
 * What a failed review request offers (R5-10). No answer, or a server fault, may pass: Try again repeats the same request. A refusal
 * (400, 404) would be refused again, because the review changed under the page (a run already going, an item gone), so the button reads
 * the review again instead. A read that failed is always tried again. By the status and code only, never the text.
 */
export type ReviewProblem = { words: string; button: "Try again" | "Read the review again"; next: "repeat" | "reload" };
export function reviewProblemWords(action: ReviewAction, error: { code: string | undefined; status: number; message: string }): ReviewProblem {
  const what = action === "load" ? "keyloom couldn't read this config's review." : action === "run" ? "keyloom couldn't start the review." : action === "stop" ? "keyloom couldn't stop the review." : action === "dismiss" ? "keyloom couldn't hide that." : "keyloom couldn't show that again.";
  const refused = action !== "load" && error.status >= 400 && error.status < 500;
  if (refused) return { words: `${what} ${sentence(error.message)}`, button: "Read the review again", next: "reload" };
  // Each of these requests is safe to repeat: a second run replaces the first, and hiding a hidden item hides it.
  // A server fault's own words ("internal error") say nothing to a person; its detail is in the server's log.
  return { words: `${what} ${error.status < 400 ? "The server didn't answer." : "It hit an unexpected error."}`, button: "Try again", next: "repeat" };
}
