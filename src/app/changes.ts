// Use cases for changing a layout: check, propose, apply, reject, list, show and undo
// (02#applying-undoing-and-stale-bases, 07). The agent proposes and the validator decides (D-014):
// every path that writes a revision runs `evaluate` against the head it is about to extend.
import { type Layout } from "../layout/schema.ts";
import type { ChangeOp, DecisionDraft } from "../layout/change.ts";
import { recordChoice, restoreChangeSet, subjectOf, supersedeTouched, suspendChangeSet } from "../memory/choices.ts";
import { type StaleConflict, staleConflicts } from "../layout/stale.ts";
import {
  type ChangeSetRow, type ChangeSetSource, type ChangeSetStatus, type StoredDraft, type Tradeoffs, findChangeSet, insertChangeSet, listChangeSets, markApplied,
  markRejected,
} from "../persistence/change-sets.ts";
import { type RevisionRow, findRevision } from "../persistence/layouts.ts";
import { appendRevision, liveChangeSets } from "../persistence/revisions.ts";
import { transact } from "../persistence/transaction.ts";
import { type ValidationResult, ValidationResultSchema } from "../validation/result.ts";
import type { SelectionScope } from "../validation/selection-rules.ts";
import { type Evaluation, evaluate } from "../validation/validate.ts";
import type { App } from "./context.ts";
import { decisionFactsFor, pinnedFor } from "./decisions.ts";
import { NotFoundError, StaleBaseError, UsageError, ValidationFailedError } from "./errors.ts";
import { type LayoutView, getLayout } from "./layouts.ts";

/** A change set with its stored validation parsed. */
export type ChangeSetView = Omit<ChangeSetRow, "validation"> & { validation: ValidationResult };

const toView = (row: ChangeSetRow): ChangeSetView => ({ ...row, validation: ValidationResultSchema.parse(row.validation) });

const NO_DIFF: ValidationResult["diff"] = { changed: [], displaced: [], dropped: [], relearnCount: 0, retuned: [], reminders: [] };

function baseDocument(app: App, view: LayoutView, baseRevisionId: string): Layout {
  if (baseRevisionId === view.revision.id) return view.document;
  const base = findRevision(app.db, view.layout.id, baseRevisionId);
  if (!base) throw new NotFoundError(`layout ${view.layout.name} has no revision "${baseRevisionId}"`);
  return base.layout;
}

/** What the ops touch that changed between their base and the head; empty when the head is the base. */
function conflictsWithHead(app: App, view: LayoutView, baseRevisionId: string, ops: readonly ChangeOp[]): StaleConflict[] {
  if (baseRevisionId === view.revision.id) return [];
  return staleConflicts(baseDocument(app, view, baseRevisionId), view.document, ops);
}

const staleMessage = (baseRevisionId: string, conflicts: StaleConflict[]) =>
  `the layout changed since ${baseRevisionId} at ${conflicts.map((c) => c.label).join("; ")}; propose the change again against the head`;

/**
 * Validates `ops` against the head. A stale base is a `stale_base` error here (07 lists it as one),
 * but apply throws it as a StaleBaseError instead.
 */
export function checkChange(app: App, ref: string, input: { baseRevisionId?: string; ops: ChangeOp[]; selection?: SelectionScope }): ValidationResult {
  const view = getLayout(app, ref);
  if (input.baseRevisionId !== undefined) {
    const conflicts = conflictsWithHead(app, view, input.baseRevisionId, input.ops);
    if (conflicts.length > 0) {
      const slots = conflicts.flatMap((c) => (c.slot ? [c.slot] : []));
      const error = { code: "stale_base", message: staleMessage(input.baseRevisionId, conflicts), ...(slots.length ? { slots } : {}) };
      return { ok: false, errors: [error], warnings: [], diff: NO_DIFF };
    }
  }
  return evaluate(view.board.definition, view.document, input.ops, { ...evaluationContext(app, view.layout.id), ...(input.selection ? { selection: input.selection } : {}) }).result;
}

/** What the validator needs from memory: pinned priorities and the choices still in force (08). */
const evaluationContext = (app: App, layoutId: string) => ({ pinned: pinnedFor(app, layoutId), decisions: decisionFactsFor(app, layoutId) });

/** Re-validates against the head and returns the document to save; throws unless the ops are valid and not stale. */
function resolveAgainstHead(
  app: App, view: LayoutView, baseRevisionId: string, ops: ChangeOp[], selection?: SelectionScope,
): { result: ValidationResult; after: Layout; touched: Evaluation["touched"] } {
  const conflicts = conflictsWithHead(app, view, baseRevisionId, ops);
  if (conflicts.length > 0) throw new StaleBaseError(staleMessage(baseRevisionId, conflicts), conflicts.map((c) => c.label));
  const evaluation: Evaluation = evaluate(view.board.definition, view.document, ops, { ...evaluationContext(app, view.layout.id), ...(selection ? { selection } : {}) });
  if (!evaluation.result.ok || !evaluation.after) {
    const { errors } = evaluation.result;
    throw new ValidationFailedError(`${errors.length} validation error${errors.length === 1 ? "" : "s"}: ${errors[0]?.message ?? "invalid"}`, evaluation.result);
  }
  return { result: evaluation.result, after: evaluation.after, touched: evaluation.touched };
}

const requireText = (value: string, what: string) => {
  if (!value.trim()) throw new UsageError(`${what} must not be empty`);
};

/** What an agent proposal carries beyond the ops: a card heading, trade-offs, and the conversation and alternatives group it belongs to. */
export type ProposalMeta = {
  title?: string; tradeoffs?: Tradeoffs; conversationId?: string; proposalGroup?: string; selection?: SelectionScope;
  /** What to remember when this is applied, and the messages of BK's it answers (08). */
  decisionDraft?: StoredDraft;
};

/** Saves a valid change set against the current head without applying it. Invalid ops are refused, not stored. */
export function proposeChange(
  app: App,
  ref: string,
  input: { ops: ChangeOp[]; explanation: string; source: ChangeSetSource } & ProposalMeta,
): ChangeSetView {
  requireText(input.explanation, "the explanation");
  return transact(app.db, () => {
    const view = getLayout(app, ref);
    const { result } = resolveAgainstHead(app, view, view.revision.id, input.ops, input.selection);
    return toView(insertChangeSet(app.db, {
      layoutId: view.layout.id, baseRevisionId: view.revision.id, source: input.source, ops: input.ops, explanation: input.explanation,
      validation: result, status: "proposed",
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.decisionDraft === undefined ? {} : { decisionDraft: input.decisionDraft }),
      ...(input.tradeoffs === undefined ? {} : { tradeoffs: input.tradeoffs }),
      ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
      ...(input.proposalGroup === undefined ? {} : { proposalGroup: input.proposalGroup }),
    }));
  });
}

/** `decisionId` is the choice written for this change, or null when it carried no reason to remember. */
export type ApplyOutcome = { revisionId: string; changeSetId: string; validation: ValidationResult; decisionId: string | null };

/** Writes the decision for an applied change, or just retires what it overrode when there is nothing to remember. */
function remember(
  app: App, view: LayoutView, cs: { id: string; conversationId: string | null }, draft: StoredDraft | null,
  outcome: { result: ValidationResult; after: Layout; touched: Evaluation["touched"] },
): string | null {
  const touched = outcome.touched.map((t) => t.decisionId);
  if (draft === null) {
    supersedeTouched(app.db, touched, null);
    return null;
  }
  const { sourceMessageIds, ...words } = draft;
  const slots = [...outcome.result.diff.changed, ...outcome.result.diff.retuned];
  return recordChoice(app.db, {
    layoutId: view.layout.id, draft: words, subject: subjectOf(outcome.after, slots), changeSetId: cs.id,
    conversationId: cs.conversationId, sourceMessageIds, touched,
  }).id;
}

/** Applies a proposed change set to the head, re-validating it first. */
export function applyChange(app: App, changeSetId: string): ApplyOutcome {
  return transact(app.db, () => {
    const cs = findChangeSet(app.db, changeSetId);
    if (!cs) throw new NotFoundError(`no change set "${changeSetId}"`);
    if (cs.status !== "proposed") throw new UsageError(`change set ${cs.id} is ${cs.status}, not proposed`);
    const view = getLayout(app, cs.layoutId);
    const resolved = resolveAgainstHead(app, view, cs.baseRevisionId, cs.ops);
    const { result, after } = resolved;
    const revision = appendRevision(app.db, {
      layoutId: view.layout.id, expectedHeadId: view.revision.id, layout: after, origin: cs.source, summary: cs.explanation, changeSetId: cs.id,
    });
    markApplied(app.db, cs, result);
    const decisionId = remember(app, view, cs, cs.decisionDraft, resolved);
    return { revisionId: revision.id, changeSetId: cs.id, validation: result, decisionId };
  });
}

/**
 * What an editor change remembers: only a reason BK typed, because a typo fix needs no memory (08).
 * The goal says it was done by hand; the summary is the choice; his words are the reason.
 */
export function editorDraft(summary: string, reason: string | undefined): StoredDraft | undefined {
  const why = reason?.trim();
  if (!why) return undefined;
  return { goal: "Changed by hand in the editor", choice: summary.trim(), reason: why, scope: { apps: [], habits: [] }, sourceMessageIds: [] };
}

/** The editor path: records an editor change set and applies it in one transaction. A `reason` BK typed is remembered. */
export function applyOps(
  app: App,
  ref: string,
  input: { baseRevisionId: string; ops: ChangeOp[]; summary: string; reason?: string },
): ApplyOutcome {
  requireText(input.summary, "the summary");
  return transact(app.db, () => {
    const view = getLayout(app, ref);
    const resolved = resolveAgainstHead(app, view, input.baseRevisionId, input.ops);
    const { result, after } = resolved;
    const draft = editorDraft(input.summary, input.reason);
    const cs = insertChangeSet(app.db, {
      layoutId: view.layout.id, baseRevisionId: input.baseRevisionId, source: "editor", ops: input.ops, explanation: input.summary,
      validation: result, status: "applied", ...(draft ? { decisionDraft: draft } : {}),
    });
    const revision = appendRevision(app.db, {
      layoutId: view.layout.id, expectedHeadId: view.revision.id, layout: after, origin: "editor", summary: input.summary, changeSetId: cs.id,
    });
    const decisionId = remember(app, view, cs, draft ?? null, resolved);
    return { revisionId: revision.id, changeSetId: cs.id, validation: result, decisionId };
  });
}

export function rejectChange(app: App, changeSetId: string): ChangeSetView {
  return transact(app.db, () => {
    const cs = findChangeSet(app.db, changeSetId);
    if (!cs) throw new NotFoundError(`no change set "${changeSetId}"`);
    if (cs.status !== "proposed") throw new UsageError(`change set ${cs.id} is ${cs.status}, not proposed`);
    markRejected(app.db, cs.id);
    return toView(findChangeSet(app.db, cs.id) as ChangeSetRow);
  });
}

export function listChanges(app: App, ref: string, opts: { status?: ChangeSetStatus } = {}): ChangeSetView[] {
  const view = getLayout(app, ref);
  return listChangeSets(app.db, view.layout.id, opts).map(toView);
}

export function showChange(app: App, changeSetId: string): ChangeSetView {
  const cs = findChangeSet(app.db, changeSetId);
  if (!cs) throw new NotFoundError(`no change set "${changeSetId}"`);
  return toView(cs);
}

/**
 * Undoes the head: a new revision whose document is the head's parent's (D-015). A revision that
 * is not the head can't be undone alone, because that would also discard the changes after it;
 * naming one is how a stale tab finds out the head moved.
 */
export function undo(app: App, ref: string, input: { revisionId?: string } = {}): { revision: RevisionRow; undoesRevisionId: string } {
  return transact(app.db, () => {
    const view = getLayout(app, ref);
    const head = view.revision;
    if (input.revisionId !== undefined && input.revisionId !== head.id) {
      throw new StaleBaseError(`the head of ${view.layout.name} is ${head.id}, not ${input.revisionId}; only the head can be undone`);
    }
    if (head.parentId === null) throw new UsageError(`${head.id} is the first revision of ${view.layout.name}; there is nothing before it to go back to`);
    const parent = findRevision(app.db, view.layout.id, head.parentId);
    if (!parent) throw new Error(`revision ${head.id} has a missing parent ${head.parentId}`);
    // Restoring an earlier document is not a change set, so it isn't re-validated: undo must work
    // even if a rule has since been tightened.
    const revision = appendRevision(app.db, {
      layoutId: view.layout.id, expectedHeadId: head.id, layout: parent.layout, origin: "undo", summary: undoSummary(head), undoesRevisionId: head.id,
    });
    // Memory follows the document: what the head carried and the restored document does not leaves the
    // memory (and what it had superseded returns), and what the restored document carries comes back (08).
    const was = liveChangeSets(app.db, view.layout.id, head.id);
    const now = liveChangeSets(app.db, view.layout.id, revision.id);
    for (const id of was) if (!now.has(id)) suspendChangeSet(app.db, id);
    for (const id of now) if (!was.has(id)) restoreChangeSet(app.db, id);
    return { revision, undoesRevisionId: head.id };
  });
}

/**
 * Undoing an undo puts the change back, so it reads "Redo: X" rather than stacking "Undo: Undo: X";
 * undoing that again reads "Undo: X". Only undo revisions are rewritten, so a person's own summary
 * that happens to start with "Undo: " is left alone.
 */
function undoSummary(head: { origin: string; summary: string }): string {
  if (head.origin === "undo") {
    if (head.summary.startsWith("Undo: ")) return `Redo: ${head.summary.slice("Undo: ".length)}`;
    if (head.summary.startsWith("Redo: ")) return `Undo: ${head.summary.slice("Redo: ".length)}`;
  }
  return `Undo: ${head.summary}`;
}
