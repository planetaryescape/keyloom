// The board review's own checks (D-340): the validator's standing warnings, plus the one cheap check it has no rule for yet, as items.
// Pure and deterministic: the same layout always gives the same items with the same ids, which is what lets a dismissal and a
// "fixed" tick follow a finding from one revision to the next.
import type { BoardDefinition } from "../boards/schema.ts";
import type { Slot } from "../layout/change.ts";
import type { Layout } from "../layout/schema.ts";
import type { Issue } from "./result.ts";
import { type ReviewItem, itemId } from "./review-item.ts";
import { standingIssues } from "./validate.ts";

export type ReviewSummary = { layers: number; keys: number; combos: number };

// Findings that are advice about how a layout feels, not something that is broken.
const HINT_CODES: ReadonlySet<string> = new Set(["homerow_same_hand_mods", "doubled_letter_tapdance", "tap_dance_same_action"]);
// Findings that stop the layout being built or saved as it is.
const ERROR_CODES: ReadonlySet<string> = new Set(["schema", "binding_count", "unknown_ref", "layer_limit"]);

const layer = (id: string) => `{layer:${id}}`;
const key = (s: Slot) => `{key:${s.layerId}:${s.position}}`;
const keys = (slots: readonly Slot[]) => {
  const named = slots.slice(0, 4).map(key);
  if (slots.length > 4) return `${named.join(", ")} and ${slots.length - 4} more`;
  return named.length > 1 ? `${named.slice(0, -1).join(", ")} and ${named.at(-1)}` : (named[0] ?? "");
};

// The validator's sentence is a good body but a poor row title, so the findings that read as advice get a short one of their own.
const TITLES: Readonly<Record<string, string>> = {
  homerow_same_hand_mods: "Rolling two letters can fire a home-row modifier",
  doubled_letter_tapdance: "A tap dance sits on a letter that doubles in words",
  tap_dance_same_action: "A tap dance has two slots that do the same thing",
  macro_looks_like_secret: "A macro types what looks like a password",
};

/** A finding's first sentence, so a row has a title whose full words are in the body. */
const firstSentence = (text: string): string => (/^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text).slice(0, 120);

function wording(doc: Layout, issue: Issue): { title: string; body: string } {
  const base = doc.layers[0]?.id;
  if (issue.code === "layer_unreachable" && issue.layerId !== undefined) {
    return {
      title: `${layer(issue.layerId)} can't be reached`,
      body: `No key switches to ${layer(issue.layerId)}${base === undefined ? "" : ` from ${layer(base)}`}, so nothing on it can be used.`,
    };
  }
  if (issue.code === "layer_trap" && issue.layerId !== undefined) {
    return {
      title: `${layer(issue.layerId)} has no way back`,
      body: `${layer(issue.layerId)} has no key that gets back to ${base === undefined ? "the base layer" : layer(base)}, so you could get stuck on it.${issue.slots?.length ? ` It is entered from ${keys(issue.slots)}.` : ""}`,
    };
  }
  const plain = issue.plain ?? issue.message;
  return { title: TITLES[issue.code] ?? firstSentence(plain), body: plain };
}

function fromIssue(doc: Layout, issue: Issue): ReviewItem {
  const slots = issue.slots ?? [];
  const layers = issue.layerId === undefined ? [] : [issue.layerId];
  const { title, body } = wording(doc, issue);
  const kind = HINT_CODES.has(issue.code) ? "hint" : "problem";
  return {
    id: itemId({ source: "check", code: issue.code, layers, keys: slots }),
    source: "check", kind, severity: kind === "hint" ? "info" : ERROR_CODES.has(issue.code) ? "error" : "warning",
    code: issue.code, title, body, keys: slots.map((s) => ({ layerId: s.layerId, position: s.position })), layers,
    proposalId: null, fixes: [], dismissedAt: null,
  };
}

/** Keys that do nothing on the base layer: nothing bound, or transparent with no layer beneath to fall through to. */
function emptyKeys(doc: Layout, board: BoardDefinition): ReviewItem[] {
  const base = doc.layers[0];
  if (base === undefined) return [];
  const empty = base.bindings.flatMap((b, position) => (position < board.keyCount && (b.kind === "none" || b.kind === "transparent") ? [position] : []));
  if (empty.length === 0) return [];
  const slots = empty.map((position) => ({ layerId: base.id, position }));
  return [{
    id: itemId({ source: "check", code: "keys_do_nothing", layers: [], keys: slots }),
    source: "check", kind: "hint", severity: "info", code: "keys_do_nothing",
    title: `${empty.length} ${empty.length === 1 ? "key does" : "keys do"} nothing on ${layer(base.id)}`,
    body: `${keys(slots)} ${empty.length === 1 ? "is" : "are"} empty on ${layer(base.id)}. Pressing ${empty.length === 1 ? "it" : "them"} types nothing.`,
    keys: slots, layers: [], proposalId: null, fixes: [], dismissedAt: null,
  }];
}

export function reviewChecks(board: BoardDefinition, doc: Layout): { items: ReviewItem[]; summary: ReviewSummary } {
  const items = new Map<string, ReviewItem>();
  for (const item of [...standingIssues(board, doc).map((i) => fromIssue(doc, i)), ...emptyKeys(doc, board)]) {
    // Two issues about the same layer and keys are one finding to BK.
    if (!items.has(item.id)) items.set(item.id, item);
  }
  return { items: [...items.values()], summary: { layers: doc.layers.length, keys: board.keyCount, combos: doc.combos.length } };
}
