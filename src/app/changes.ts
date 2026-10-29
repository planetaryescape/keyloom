// Use cases for changing a layout: check, propose, apply, reject, list, show and undo
// (02#applying-undoing-and-stale-bases, 07). The agent proposes and the validator decides (D-014):
// every path that writes a revision runs `evaluate` against the head it is about to extend.
import { plainSummary } from "../layout/history-summary.ts";
import { type ProposalCard, toCard } from "./proposal-card.ts";
import { type Layout } from "../layout/schema.ts";
import type { ChangeOp, DecisionDraft } from "../layout/change.ts";
import { recordChoice, restoreChangeSet, subjectOf, supersedeTouched, suspendChangeSet } from "../memory/choices.ts";
import { type StaleConflict, staleConflicts } from "../layout/stale.ts";
import {
  type ChangeSetRow, type ChangeSetSource, type ChangeSetStatus, type StoredDraft, type Tradeoffs, findChangeSet, insertChangeSet, listChangeSets, listConversationChangeSets, markApplied,
  markRejected, markSuperseded, recordSupersededDecisionIds,
} from "../persistence/change-sets.ts";
import { type RevisionRow, findRevision, revisionChain } from "../persistence/layouts.ts";
import { appendLog } from "../persistence/log.ts";
import { appendRevision, liveChangeSets } from "../persistence/revisions.ts";
import { transact } from "../persistence/transaction.ts";
import { type ValidationResult, ValidationResultSchema } from "../validation/result.ts";
import type { SelectionScope } from "../validation/selection-rules.ts";
import { restoreProblems } from "../validation/restore.ts";
import { type Evaluation, evaluate } from "../validation/validate.ts";
import type { App } from "./context.ts";
import { decisionFactsFor, pinnedFor } from "./decisions.ts";
import { NotFoundError, StaleBaseError, UsageError, ValidationFailedError } from "./errors.ts";
import { type LayoutView, getLayout } from "./layouts.ts";
import { closeOpenQuestion } from "./question-skip.ts";

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
  /** The proposed change set of this conversation that this one revises (D-452). It is set aside in the same transaction that saves this one. */
  supersedes?: string;
};

/** The agent's proposals in this conversation that BK has not decided: what a new proposal could replace or sit beside (D-452). */
export const openProposals = (app: App, conversationId: string): ChangeSetRow[] =>
  listConversationChangeSets(app.db, conversationId).filter((cs) => cs.status === "proposed" && cs.source === "agent");

const listOf = (open: readonly ChangeSetRow[]) =>
  open.length === 0 ? "No proposal is open." : `Open: ${open.map((cs) => `${cs.id} ("${cs.title ?? cs.explanation.slice(0, 40)}")`).join("; ")}.`;

/**
 * What a revision may replace (D-452): a proposed change set of this conversation and this layout. The message is read by the model, which
 * decides again, so it says what the state is and what to do about it. Another conversation's id reads as an unknown one.
 */
export function requireSupersedable(app: App, layoutId: string, conversationId: string | null, id: string): ChangeSetRow {
  if (conversationId === null) throw new UsageError("supersedes only works inside a conversation; propose without it");
  const cs = findChangeSet(app.db, id);
  const open = openProposals(app, conversationId);
  if (!cs || cs.conversationId !== conversationId || cs.layoutId !== layoutId) throw new UsageError(`no proposal "${id}" in this conversation. ${listOf(open)}`);
  if (cs.status === "applied") throw new UsageError(`${id} is applied: BK took it. If the answer still changes something, propose that as a new change against the layout as it is now, with supersedes: null. ${listOf(open)}`);
  if (cs.status !== "proposed") throw new UsageError(`${id} is ${cs.status}, so it can't be superseded. ${listOf(open)}`);
  return cs;
}

/** A proposal made while another is open must say which it is (D-452): the model declares a replacement or that it stands beside, so no old card keeps an Apply by accident. */
export function requireDeclared(app: App, conversationId: string | null, supersedes: string | null | undefined): void {
  if (conversationId === null || supersedes !== undefined) return;
  const open = openProposals(app, conversationId);
  if (open.length === 0) return;
  throw new UsageError(`Nothing was saved. ${listOf(open)} Call propose_changes again with supersedes: <id> if this replaces one of them, or supersedes: null if it stands beside them.`);
}

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
    // Checked again inside the transaction: BK may have applied the old one while the model was working.
    if (input.supersedes !== undefined) requireSupersedable(app, view.layout.id, input.conversationId ?? null, input.supersedes);
    const saved = toView(insertChangeSet(app.db, {
      layoutId: view.layout.id, baseRevisionId: view.revision.id, source: input.source, ops: input.ops, explanation: input.explanation,
      validation: result, status: "proposed",
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.decisionDraft === undefined ? {} : { decisionDraft: input.decisionDraft }),
      ...(input.supersedes === undefined && input.tradeoffs === undefined ? {} : { tradeoffs: { ...(input.tradeoffs ?? { gains: [], costs: [] }), ...(input.supersedes === undefined ? {} : { supersedes: input.supersedes }) } }),
      ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
      ...(input.proposalGroup === undefined ? {} : { proposalGroup: input.proposalGroup }),
    }));
    if (input.supersedes !== undefined) markSuperseded(app.db, input.supersedes);
    return saved;
  });
}

/** `decisionId` is the choice written for this change, or null when it carried no reason to remember. */
export type ApplyOutcome = { revisionId: string; changeSetId: string; validation: ValidationResult; decisionId: string | null };

/**
 * One line per apply (11#logs): IDs and the validator's verdict as codes, never the ops, the summary or a key.
 * The content lives in the database; the log is how a bad flash is traced back to what was applied. Called
 * after the transaction commits, so an apply that rolls back leaves no line.
 */
function logApply(app: App, applied: { layoutId: string; source: ChangeSetSource; outcome: ApplyOutcome }): void {
  const { validation } = applied.outcome;
  appendLog(app.dataDir, {
    event: "apply",
    layoutId: applied.layoutId,
    revisionId: applied.outcome.revisionId,
    changeSetId: applied.outcome.changeSetId,
    decisionId: applied.outcome.decisionId,
    source: applied.source,
    ok: validation.ok,
    errorCodes: [...new Set(validation.errors.map((i) => i.code))],
    warningCodes: [...new Set(validation.warnings.map((i) => i.code))],
  });
}

/** Writes the decision for an applied change, or just retires what it overrode when there is nothing to remember. */
function remember(
  app: App, view: LayoutView, cs: { id: string; conversationId: string | null }, draft: StoredDraft | null,
  outcome: { result: ValidationResult; after: Layout; touched: Evaluation["touched"] },
): string | null {
  const touched = outcome.touched.map((t) => t.decisionId);
  if (draft === null) {
    supersedeTouched(app.db, touched, null);
    if (touched.length > 0) recordSupersededDecisionIds(app.db, cs.id, touched);
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
  const applied = transact(app.db, () => {
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
    closeOpenQuestion(app, cs);
    return { layoutId: view.layout.id, source: cs.source, outcome: { revisionId: revision.id, changeSetId: cs.id, validation: result, decisionId } };
  });
  logApply(app, applied);
  return applied.outcome;
}

/**
 * What an editor change remembers: only a reason BK typed, because a typo fix needs no memory (08).
 * The summary says what was done, so it is both the goal and the choice; his words are the reason.
 */
export function editorDraft(summary: string, reason: string | undefined): StoredDraft | undefined {
  const why = reason?.trim();
  if (!why) return undefined;
  return { goal: summary.trim(), choice: summary.trim(), reason: why, scope: { apps: [], habits: [] }, sourceMessageIds: [] };
}

/** The editor path: records an editor change set and applies it in one transaction. A `reason` BK typed is remembered. */
export function applyOps(
  app: App,
  ref: string,
  input: { baseRevisionId: string; ops: ChangeOp[]; summary: string; reason?: string | undefined },
): ApplyOutcome {
  requireText(input.summary, "the summary");
  const applied = transact(app.db, () => {
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
    return { layoutId: view.layout.id, source: "editor" as const, outcome: { revisionId: revision.id, changeSetId: cs.id, validation: result, decisionId } };
  });
  logApply(app, applied);
  return applied.outcome;
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

/**
 * A config's open proposals that no conversation shows (D-336): the ones `keyboard put` makes, and any other made outside the chat. The
 * config page lists them with the chat's proposal card, so they can be previewed, applied or set aside like any other.
 */
export function openProposalsOutsideChat(app: App, ref: string): ProposalCard[] {
  const view = getLayout(app, ref);
  return listChangeSets(app.db, view.layout.id, { status: "proposed" }).filter((row) => row.conversationId === null).map(toCard);
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
 *
 * With `to`, the document is that earlier revision's instead: one new revision that goes back
 * several steps at once (D-170). It is checked against the rules first, but only for problems the
 * head doesn't already have, so a layout imported with a flaw stays restorable.
 */
export function undo(app: App, ref: string, input: { revisionId?: string; to?: string } = {}): { revision: RevisionRow; undoesRevisionId: string } {
  return transact(app.db, () => {
    const view = getLayout(app, ref);
    const head = view.revision;
    if (input.revisionId !== undefined && input.revisionId !== head.id) {
      throw new StaleBaseError(`the head of ${view.layout.name} is ${head.id}, not ${input.revisionId}; only the head can be undone`);
    }
    const target = input.to === undefined ? undefined : goBackTarget(app, view, input.to);
    if (target === undefined && head.parentId === null) throw new UsageError(`${head.id} is the first revision of ${view.layout.name}; there is nothing before it to go back to`);
    const parentId = target?.row.id ?? head.parentId;
    const parent = findRevision(app.db, view.layout.id, parentId as string);
    if (!parent) throw new Error(`revision ${head.id} has a missing parent ${parentId}`);
    if (target !== undefined) {
      const refused = restoreProblems(view.board.definition, view.document, parent.layout);
      if (!refused.ok) throw new ValidationFailedError(`${parent.revision.summary} can't be restored: ${refused.errors[0]?.message ?? "it breaks a rule"}`, refused);
    }
    // Restoring an earlier document is not a change set, so it isn't re-validated against ops: undo must work
    // even if a rule has since been tightened.
    const revision = appendRevision(app.db, {
      layoutId: view.layout.id, expectedHeadId: head.id, layout: parent.layout, origin: "undo",
      summary: target === undefined ? undoSummary(head) : `Back to: ${plainSummary(parent.revision.summary)}`,
      // Memory follows `undoes`'s parent, so naming the revision just after the target makes it follow the target.
      undoesRevisionId: target?.after.id ?? head.id,
    });
    // Memory follows the document: what the head carried and the restored document does not leaves the
    // memory (and what it had superseded returns), and what the restored document carries comes back (08).
    const was = liveChangeSets(app.db, view.layout.id, head.id);
    const now = liveChangeSets(app.db, view.layout.id, revision.id);
    // Newest first: suspending a later change returns the decision it superseded, which the earlier change's own suspend then retires. The other way round leaves that decision active.
    for (const id of [...was].reverse()) if (!now.has(id)) suspendChangeSet(app.db, id);
    for (const id of now) if (!was.has(id)) restoreChangeSet(app.db, id);
    return { revision, undoesRevisionId: head.id };
  });
}

/** The revision to go back to, and the one right after it on the way to the head. */
function goBackTarget(app: App, view: LayoutView, to: string): { row: RevisionRow; after: RevisionRow } {
  const chain = revisionChain(app.db, view.layout.id, view.revision.id);
  const at = chain.findIndex((r) => r.id === to);
  if (at < 0) throw new NotFoundError(`layout ${view.layout.name} has no revision "${to}"`);
  if (at === 0) throw new UsageError(`${to} is already the current revision of ${view.layout.name}`);
  return { row: chain[at] as RevisionRow, after: chain[at - 1] as RevisionRow };
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
    // Undoing a go-back puts the later work back.
    if (head.summary.startsWith("Back to: ")) return `Redo: ${head.summary}`;
  }
  return `Undo: ${head.summary}`;
}
