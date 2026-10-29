// Use cases for the board review (D-340): the checks run at once and are stored; the agent's part runs after and fills in. A revision is
// reviewed once. The next revision's review says which of the previous one's findings are gone, so the screen can tick them off.
import type { AgentModel, Usage } from "../agent/model.ts";
import { keyName } from "../boards/key-names.ts";
import { layerDisplayName } from "../layout/cap-words.ts";
import { runReviewAgent } from "../agent/review.ts";
import { findChangeSet, markRejected } from "../persistence/change-sets.ts";
import { findLayoutRow } from "../persistence/layouts.ts";
import { appendLog } from "../persistence/log.ts";
import {
  type AiStatus, type BoardReviewRow, type ReviewItemRow, type ReviewTrigger, claimAi, dismissItem, dismissals, finishAi, findReview, findReviewOfRevision, insertReview, latestReview,
  listReviewItems, restoreItem,
} from "../persistence/reviews.ts";
import { transact } from "../persistence/transaction.ts";
import { type FixedItem, type ReviewItem, itemId } from "../validation/review-item.ts";
import { ValidationResultSchema } from "../validation/result.ts";
import { reviewChecks } from "../validation/review-checks.ts";
import { createAgentPorts } from "./agent-ports.ts";
import type { App } from "./context.ts";
import { ModelError, NotFoundError } from "./errors.ts";
import { getLayout } from "./layouts.ts";

export type { AiStatus, ReviewTrigger } from "../persistence/reviews.ts";
export type { FixedItem, ReviewItem } from "../validation/review-item.ts";

/** A run that started this long ago and never finished is taken to have died with its process. */
export const AI_STALE_MS = 10 * 60_000;

export type BoardReview = {
  id: string;
  layoutId: string;
  revisionId: string;
  trigger: ReviewTrigger;
  checkedAt: number;
  checks: { status: "done"; summary: { layers: number; keys: number; combos: number } };
  ai: { status: AiStatus; reason: string | null; model: string | null };
  /** Hidden items are in the list with `dismissedAt` set, so the screen can count them and offer them back. */
  items: ReviewItem[];
  /** What the previous review had that this revision no longer produces, each saying which review it was fixed since. */
  fixed: FixedItem[];
};

export type ReviewView = {
  layoutId: string;
  /** The config's head now. The review is stale while its `revisionId` differs. */
  headRevisionId: string;
  /** The newest review of the config, or null when none has run. */
  review: BoardReview | null;
};

/** What the screen is told when a review changes. */
export type ReviewEvent = { type: "review"; layoutId: string; revisionId: string; reviewId: string; aiStatus: AiStatus };

export type ReviewHooks = { emit?: (event: ReviewEvent) => void; now?: () => number };

const itemOf = (row: ReviewItemRow, hidden: ReadonlyMap<string, number>): ReviewItem => ({ ...row, dismissedAt: hidden.get(row.id) ?? null });

function toReview(app: App, row: BoardReviewRow): BoardReview {
  const hidden = dismissals(app.db, row.layoutId);
  return {
    id: row.id, layoutId: row.layoutId, revisionId: row.revisionId, trigger: row.trigger, checkedAt: row.checkedAt,
    checks: { status: "done", summary: row.summary },
    ai: { status: row.ai.status, reason: row.ai.reason, model: row.ai.model },
    items: listReviewItems(app.db, row.id).map((r) => itemOf(r, hidden)),
    fixed: row.fixed.flatMap((f) => (row.previousReviewId === null ? [] : [{ ...itemOf(f, hidden), fixedSince: row.previousReviewId }])),
  };
}

export function showReview(app: App, ref: string): ReviewView {
  const layout = findLayoutRow(app.db, ref);
  if (!layout) throw new NotFoundError(`no layout "${ref}"`);
  const row = latestReview(app.db, layout.id);
  return { layoutId: layout.id, headRevisionId: layout.headRevisionId, review: row ? toReview(app, row) : null };
}

/**
 * Items that were findings of the earlier review and are not any more. A finding about keys that is still about some of them (the
 * list of empty keys, after one was filled) has changed, not gone, so it is not ticked off. Suggestions go quietly: a suggestion is
 * only ever about its own revision.
 */
function goneSince(earlier: readonly ReviewItemRow[], now: readonly ReviewItemRow[], hidden: ReadonlyMap<string, number>, source: ReviewItemRow["source"]): ReviewItemRow[] {
  const family = (i: ReviewItemRow) => `${i.source}:${i.code}:${[...i.layers].sort().join(",")}`;
  const stillThere = (old: ReviewItemRow) =>
    now.some((n) => n.id === old.id || (old.keys.length > 0 && family(n) === family(old) && n.keys.some((k) => old.keys.some((o) => o.layerId === k.layerId && o.position === k.position))));
  return earlier.filter((i) => i.source === source && i.kind !== "suggestion" && !stillThere(i) && !hidden.has(i.id));
}

/**
 * The checks for the head of `ref`, stored. Returns the review already there when the revision has one, so a revision is never
 * reviewed twice; `created` says which. Synchronous and cheap: the agent's part is `runReviewAi`.
 */
export function createReview(app: App, ref: string, trigger: ReviewTrigger, hooks: ReviewHooks = {}): { review: BoardReview; created: boolean } {
  const result = transact(app.db, () => {
    const view = getLayout(app, ref);
    const existing = findReviewOfRevision(app.db, view.layout.id, view.revision.id);
    if (existing) return { row: existing, created: false };
    const checks = reviewChecks(view.board.definition, view.document);
    const previous = latestReview(app.db, view.layout.id);
    const earlier = previous ? listReviewItems(app.db, previous.id) : [];
    const hidden = dismissals(app.db, view.layout.id);
    const inserted = insertReview(app.db, {
      layoutId: view.layout.id, revisionId: view.revision.id, trigger, checkedAt: (hooks.now ?? Date.now)(), summary: checks.summary,
      items: checks.items.map(({ dismissedAt: _, ...row }) => row), previousReviewId: previous?.id ?? null,
      fixed: goneSince(earlier, checks.items.map(({ dismissedAt: _, ...r }) => r), hidden, "check"),
    });
    // The earlier review's suggestions were about its revision. A change set still open for it would sit in the config's proposals
    // for ever, so it is rejected now that a newer review replaces the suggestion.
    if (inserted.created) {
      for (const item of earlier) {
        if (item.proposalId !== null && findChangeSet(app.db, item.proposalId)?.status === "proposed") markRejected(app.db, item.proposalId, (hooks.now ?? Date.now)());
      }
    }
    return { row: inserted.review, created: inserted.created };
  });
  const review = toReview(app, result.row);
  if (result.created) hooks.emit?.({ type: "review", layoutId: review.layoutId, revisionId: review.revisionId, reviewId: review.id, aiStatus: review.ai.status });
  return { review, created: result.created };
}

export type ReviewAiDeps = {
  /** The model the agent runs on; throws a ModelError when none is set up. */
  model(): Promise<AgentModel>;
};

// ModelError's own text for these says how to start a chat; a review is not one.
const NO_PROVIDER = "No model provider is set up. Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY, or sign in with `codex login`.";
const KEYED = { ANTHROPIC_API_KEY: "Anthropic", OPENROUTER_API_KEY: "OpenRouter" } as const;

/**
 * Why there is no model, in words. Chat does not fall back from a provider that was chosen (flag, KEYLOOM_PROVIDER or config) to a ready
 * one, so neither does a review; what differs is the sentence: a chosen provider without a key is not "no provider".
 */
function unavailableReason(err: ModelError): string {
  if (err.message.startsWith("No model provider is set up")) return NO_PROVIDER;
  const keyed = /\b(ANTHROPIC_API_KEY|OPENROUTER_API_KEY) is not set/.exec(err.message)?.[1] as keyof typeof KEYED | undefined;
  if (keyed !== undefined) return `${KEYED[keyed]} is chosen but has no key. Set ${keyed}, or choose another provider.`;
  return err.message;
}

const usageLine = (u: Usage) => ({ inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens });

/**
 * The agent's part of a review, once. Claims the review first, so two processes (the server and a `keyloom review --run`) never both
 * spend a model call on it. Never throws: whatever goes wrong is the review's `failed` or `unavailable` status, in words.
 */
export async function runReviewAi(app: App, reviewId: string, deps: ReviewAiDeps, hooks: ReviewHooks & { force?: boolean; signal?: AbortSignal } = {}): Promise<BoardReview> {
  const now = hooks.now ?? Date.now;
  const row = findReview(app.db, reviewId);
  if (!row) throw new NotFoundError(`no review "${reviewId}"`);
  if (!claimAi(app.db, row.id, now(), AI_STALE_MS, hooks.force ? { force: true } : {})) return toReview(app, row);
  const announce = (status: AiStatus) => hooks.emit?.({ type: "review", layoutId: row.layoutId, revisionId: row.revisionId, reviewId: row.id, aiStatus: status });
  announce("running");

  const started = now();
  const finish = (status: "done" | "unavailable" | "failed", reason: string | null, model: string | null, items: ReviewItem[], rejectedProposals: readonly string[] = []) => {
    transact(app.db, () => {
      for (const id of rejectedProposals) if (findChangeSet(app.db, id)?.status === "proposed") markRejected(app.db, id, now());
      const kept = items.map(({ dismissedAt: _, ...r }) => r);
      finishAi(app.db, row.id, { status, reason, model, items: kept, fixedAgent: status === "done" ? agentGone(app, row, kept) : [] });
    });
    announce(status);
  };

  let model: AgentModel;
  try {
    model = await deps.model();
  } catch (err) {
    // No provider set up is the normal state of a fresh install, not a fault.
    if (err instanceof ModelError && err.kind === "missing_key") finish("unavailable", unavailableReason(err), null, []);
    else if (err instanceof ModelError) finish("failed", err.message, null, []);
    else finish("failed", `keyloom could not start the model: ${err instanceof Error ? err.message : String(err)}`, null, []);
    return toReview(app, findReview(app.db, row.id) as BoardReviewRow);
  }

  const proposed: string[] = [];
  try {
    const checks = listReviewItems(app.db, row.id).filter((i) => i.source === "check").map((i) => itemOf(i, new Map()));
    const ports = createAgentPorts(app, row.layoutId, null);
    // Counted here, not in the agent: a suggestion's change set exists the moment propose_changes saves it, whatever the review does with it.
    const propose = ports.propose.bind(ports);
    ports.propose = (alternatives, options) => {
      const results = propose(alternatives, options);
      for (const r of results) if (r.changeSetId !== null) proposed.push(r.changeSetId);
      return results;
    };
    if (getLayout(app, row.layoutId).revision.id !== row.revisionId) {
      finish("failed", "Your layout changed before keyloom could look at it; it will look at the new version.", model.model, []);
    } else {
      const outcome = await runReviewAgent({ model, ports, checks, ...(hooks.signal ? { signal: hooks.signal } : {}) });
      appendLog(app.dataDir, {
        event: "board_review", reviewId: row.id, layoutId: row.layoutId, revisionId: row.revisionId, provider: model.provider, model: model.model, status: outcome.status,
        iterations: outcome.iterations, usage: usageLine(outcome.usage), ...(outcome.costUsd === undefined ? {} : { costUsd: outcome.costUsd }), durationMs: now() - started,
      });
      // The review is about the revision it was made for. If the layout moved while the model worked, its suggestions are against a
      // head that is gone; the newer revision gets its own review.
      if (getLayout(app, row.layoutId).revision.id !== row.revisionId) {
        finish("failed", "Your layout changed while keyloom was looking; it will look at the new version.", model.model, [], proposed);
      } else if (outcome.status === "done") {
        const attached = attachProposals(app, outcome.items, proposed, listReviewItems(app.db, row.id).filter((i) => i.source === "check"));
        const single = onePerProblem(app, attached.items);
        finish("done", null, model.model, single.items, [...attached.withdrawn, ...single.withdrawn]);
      }
      else {
        // Out of steps (or cut off) after saving a fix: that fix is still worth showing, so it is attached the same way and the review
        // is done, with the reason in words. It is failed only when nothing usable was saved.
        const attached = attachProposals(app, [], proposed, listReviewItems(app.db, row.id).filter((i) => i.source === "check"));
        const single = onePerProblem(app, attached.items);
        const withdrawn = [...attached.withdrawn, ...single.withdrawn];
        if (single.items.length === 0) finish("failed", outcome.reason, model.model, [], [...proposed]);
        else finish("done", outcome.limit ? "Stopped at its step limit; showing what it found." : `${outcome.reason.replace(/\.$/, "")}; showing what it found.`, model.model, single.items, withdrawn);
      }
    }
  } catch (err) {
    if (hooks.signal?.aborted) {
      finish("failed", "keyloom was closed while it was looking. It will look again after your next change.", model.model, [], proposed);
      return toReview(app, findReview(app.db, row.id) as BoardReviewRow);
    }
    const known = model.classifyError(err);
    // A model API failure is something BK can act on, in words. Anything else is a bug: it is logged with its stack and shown plainly.
    if (known === null) console.error("keyloom: board review failed", err);
    finish("failed", known?.message ?? `keyloom hit an error while reviewing: ${err instanceof Error ? err.message : String(err)}`, model.model, [], proposed);
  }
  return toReview(app, findReview(app.db, row.id) as BoardReviewRow);
}

const MAX_AGENT_ITEMS = 6;

/**
 * A proposal saved in the run must show as a suggestion or not stay open. One the model didn't reference (or whose suggestion was dropped)
 * becomes a suggestion with the change set's own title and explanation, tied to the checks it touches; one past the cap is withdrawn.
 */
function attachProposals(app: App, items: ReviewItem[], proposed: readonly string[], checks: readonly ReviewItemRow[]): { items: ReviewItem[]; withdrawn: string[] } {
  const changedBy = (id: string) => {
    const cs = findChangeSet(app.db, id);
    return cs?.status === "proposed" ? { cs, changed: ValidationResultSchema.parse(cs.validation).diff.changed } : undefined;
  };
  // The checks a change touches: those about keys it changes, or, for a check about a layer alone, a key on that layer.
  const touched = (changed: readonly { layerId: string; position: number }[]) =>
    checks.filter((c) => c.kind !== "suggestion" && (c.keys.length > 0 ? c.keys.some((k) => changed.some((s) => s.layerId === k.layerId && s.position === k.position)) : c.layers.some((l) => changed.some((s) => s.layerId === l)))).map((c) => c.id);
  // A suggestion the model left without `fixes` still fixes what its change touches, or the screen can't put it under its problem.
  const out = items.map((i) => {
    const found = i.kind === "suggestion" && i.fixes.length === 0 && i.proposalId !== null ? changedBy(i.proposalId) : undefined;
    return found ? { ...i, fixes: touched(found.changed) } : i;
  });
  const referenced = new Set(out.map((i) => i.proposalId));
  const withdrawn: string[] = [];
  const taken = new Set([...checks.map((c) => c.id), ...out.map((i) => i.id)]);
  for (const id of new Set(proposed)) {
    if (referenced.has(id)) continue;
    const found = changedBy(id);
    if (found === undefined) continue;
    const { cs, changed } = found;
    const keys = changed.map((s) => ({ layerId: s.layerId, position: s.position }));
    const layers = [...new Set(changed.map((s) => s.layerId))];
    const suggestionId = itemId({ source: "agent", code: "proposed-change", layers, keys });
    if (out.filter((i) => i.source === "agent").length >= MAX_AGENT_ITEMS || taken.has(suggestionId)) {
      withdrawn.push(id);
      continue;
    }
    taken.add(suggestionId);
    out.push({
      id: suggestionId, source: "agent", kind: "suggestion", severity: "info", code: "proposed-change", title: (cs.title ?? cs.explanation).slice(0, 100), body: cs.explanation.slice(0, 400),
      keys, layers, proposalId: id, fixes: touched(changed), dismissedAt: null,
    });
  }
  return { items: out, withdrawn };
}

/**
 * Several suggestions for one problem are a choice BK did not ask to make. The best one stays (fewest warnings, then the smallest
 * change, then the model's order) and the others' change sets are withdrawn. A suggestion that fixes nothing in particular stays.
 */
function onePerProblem(app: App, items: ReviewItem[]): { items: ReviewItem[]; withdrawn: string[] } {
  const cost = (i: ReviewItem) => {
    const cs = i.proposalId === null ? undefined : findChangeSet(app.db, i.proposalId);
    const v = cs ? ValidationResultSchema.parse(cs.validation) : undefined;
    return [v?.warnings.length ?? 0, v?.diff.changed.length ?? 0];
  };
  const ranked = items.filter((i) => i.kind === "suggestion" && i.fixes.length > 0)
    .map((i, order) => ({ i, c: cost(i), order })).sort((a, b) => a.c[0]! - b.c[0]! || a.c[1]! - b.c[1]! || a.order - b.order);
  const claimed = new Set<string>();
  const dropped = new Set<ReviewItem>();
  for (const { i } of ranked) {
    if (i.fixes.every((f) => claimed.has(f))) dropped.add(i);
    else i.fixes.forEach((f) => claimed.add(f));
  }
  const kept = items.filter((i) => !dropped.has(i));
  const stillShown = new Set(kept.map((i) => i.proposalId));
  return { items: kept, withdrawn: [...dropped].flatMap((i) => (i.proposalId === null || stillShown.has(i.proposalId) ? [] : [i.proposalId])) };
}

/** The previous review's agent findings that this review's agent did not repeat. Only when both agents finished: a missing look is not a fix. */
function agentGone(app: App, row: BoardReviewRow, found: readonly ReviewItemRow[]): ReviewItemRow[] {
  if (row.previousReviewId === null) return [];
  const previous = findReview(app.db, row.previousReviewId);
  if (!previous || previous.ai.status !== "done") return [];
  return goneSince(listReviewItems(app.db, previous.id), [...found, ...listReviewItems(app.db, row.id)], dismissals(app.db, row.layoutId), "agent");
}

function requireItem(app: App, ref: string, itemId: string): { layoutId: string } {
  const view = showReview(app, ref);
  const known = view.review?.items.some((i) => i.id === itemId) || view.review?.fixed.some((i) => i.id === itemId);
  if (!known) throw new NotFoundError(`the latest review of ${ref} has no item "${itemId}"`);
  return { layoutId: view.layoutId };
}

/** Hides a finding on this config. It stays hidden on later revisions while it keeps the same id. */
export function dismissReviewItem(app: App, ref: string, itemId: string, now: () => number = Date.now): ReviewView {
  dismissItem(app.db, requireItem(app, ref, itemId).layoutId, itemId, now());
  return showReview(app, ref);
}

export function restoreReviewItem(app: App, ref: string, itemId: string): ReviewView {
  restoreItem(app.db, requireItem(app, ref, itemId).layoutId, itemId);
  return showReview(app, ref);
}

/** A title or body with its key and layer markers written as words, for the CLI: "S hold ⌥ (left ring, home row, Layer 0)" and "Magic layer". */
export function reviewWords(app: App, review: BoardReview, text: string): string {
  const view = getLayout(app, review.layoutId, review.revisionId);
  return text.replace(/\{(key|layer):([^{}:]+)(?::(\d+))?\}/g, (whole, kind: string, layerId: string, position: string | undefined) => {
    const layer = view.document.layers.find((l) => l.id === layerId);
    if (layer === undefined) return whole;
    if (kind === "layer" || position === undefined) return layerDisplayName(layer.name);
    return keyName(view.board.definition, view.document, { layerId, position: Number(position) }, { geometry: view.board.geometry });
  });
}
