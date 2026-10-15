import { ArrowLeft, LoaderCircle, MessageSquareText, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import type { DecisionCard, DecisionPatch } from "../../api/http.ts";
import type { Slot } from "../../layout/change.ts";
import type { Layout } from "../../layout/schema.ts";
import { STATUS_WORDS, keysLine, kindWords, splitByLife, successorOf } from "./decision-text.ts";
import type { DecisionsState } from "./useDecisions.ts";
import "./decisions.css";

interface Props {
  state: DecisionsState;
  layout: Layout;
  onBack: () => void;
  onReload: () => void;
  /** The keys of the decision being pointed at, to light them on the board; null when the pointer leaves. */
  onHighlight: (slots: Slot[] | null) => void;
  /** Rejects with a message to show. */
  onEdit: (id: string, patch: DecisionPatch) => Promise<void>;
  onRetire: (id: string) => Promise<void>;
  /** Opens the conversation a decision came from; resolves to an error message, or null once it is showing. */
  onOpenConversation: (conversationId: string) => Promise<string | null>;
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

// What keyloom remembers, in the open: every decision with its status, the keys it is about, and the words
// it came from. BK can correct or retire any of them (08), so nothing here is read-only.
export function DecisionsView({ state, layout, onBack, onReload, onHighlight, onEdit, onRetire, onOpenConversation }: Props) {
  return (
    <div className="decisions">
      <button type="button" className="button history-back" onClick={onBack}>
        <ArrowLeft size={14} aria-hidden="true" />
        Back to chat
      </button>
      {state.status === "loading" ? (
        <p className="muted" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" /> Loading what keyloom remembers…</p>
      ) : state.status === "error" ? (
        <div className="chat-inline-error" role="alert">
          <p>{state.message}</p>
          <button type="button" className="button" onClick={onReload}><RefreshCw size={14} aria-hidden="true" />Try again</button>
        </div>
      ) : (
        <List items={state.items} layout={layout} onHighlight={onHighlight} onEdit={onEdit} onRetire={onRetire} onOpenConversation={onOpenConversation} />
      )}
    </div>
  );
}

function List({ items, layout, onHighlight, onEdit, onRetire, onOpenConversation }: Omit<Props, "state" | "onBack" | "onReload"> & { items: DecisionCard[] }) {
  const { active, replaced } = splitByLife(items);
  if (items.length === 0) {
    return (
      <p className="decisions-empty">
        <strong>Nothing remembered yet</strong>
        When you apply a change, keyloom keeps the reason, so a later change to those keys can bring it back.
      </p>
    );
  }
  const row = (d: DecisionCard) => (
    <li key={d.id}>
      <Decision decision={d} all={items} layout={layout} onHighlight={onHighlight} onEdit={onEdit} onRetire={onRetire} onOpenConversation={onOpenConversation} />
    </li>
  );
  return (
    <>
      <ul className="decisions-list" aria-label="What keyloom remembers">{active.map(row)}</ul>
      {replaced.length === 0 ? null : (
        <details className="decisions-replaced">
          <summary>{replaced.length} replaced by a later change</summary>
          <ul className="decisions-list" aria-label="Replaced decisions">{replaced.map(row)}</ul>
        </details>
      )}
    </>
  );
}

function Decision({
  decision: d, all, layout, onHighlight, onEdit, onRetire, onOpenConversation,
}: Omit<Props, "state" | "onBack" | "onReload"> & { decision: DecisionCard; all: readonly DecisionCard[] }) {
  const titleId = useId();
  const [mode, setMode] = useState<"view" | "edit" | "retire">("view");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const keys = keysLine(layout, d);
  const slots = d.subject.slots ?? [];
  const successor = successorOf(d, all);
  const live = d.status !== "superseded";

  async function run(work: () => Promise<string | null | void>) {
    setBusy(true);
    setProblem(null);
    try {
      const failure = await work();
      if (typeof failure === "string") setProblem(failure);
      else setMode("view");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className="decision"
      data-status={d.status}
      aria-labelledby={titleId}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse" && slots.length > 0) onHighlight(slots);
      }}
      onPointerLeave={() => onHighlight(null)}
      onFocus={() => slots.length > 0 && onHighlight(slots)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onHighlight(null);
      }}
    >
      <p className="decision-meta">
        <span>{kindWords(d)}</span>
        <span className="decision-status" data-status={d.status}>{STATUS_WORDS[d.status]}</span>
      </p>
      {mode === "edit" ? (
        <EditForm
          decision={d}
          busy={busy}
          onCancel={() => setMode("view")}
          onSave={(patch) => void run(async () => void (await onEdit(d.id, patch)))}
        />
      ) : (
        <>
          <h3 id={titleId}>{d.goal}</h3>
          {d.kind === "choice" && d.choice !== d.goal ? <p className="decision-choice">{d.choice}</p> : null}
          <p className="decision-reason"><span>Why</span>{d.reason}</p>
          {keys === "" ? null : <p className="decision-keys"><span>Keys</span>{keys}</p>}
          {d.scope.apps.length + d.scope.habits.length === 0 ? null : (
            <p className="decision-keys"><span>Applies to</span>{[...d.scope.apps, ...d.scope.habits].join("; ")}</p>
          )}
          {d.outcomeNote === null ? null : <p className="decision-outcome"><span>You said</span>{d.outcomeNote}</p>}
          {d.status !== "superseded" ? null : (
            <p className="decision-keys">
              <span>Replaced by</span>
              {successor === undefined ? "a later change" : successor.choice}
              {d.supersededBy === null ? " (no reason was recorded)" : ""}
            </p>
          )}
          <p className="decision-when">{when.format(d.createdAt)}</p>
        </>
      )}

      {mode === "retire" ? (
        <div className="decision-confirm" role="alertdialog" aria-label="Retire this decision">
          <p>keyloom will stop using this to remind you or to advise. The record stays in your history.</p>
          <div className="decision-actions">
            <button type="button" className="button button-primary" disabled={busy} onClick={() => void run(() => onRetire(d.id))} autoFocus>
              {busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
              Retire
            </button>
            <button type="button" className="button" disabled={busy} onClick={() => setMode("view")}>Keep</button>
          </div>
        </div>
      ) : mode === "view" ? (
        <div className="decision-actions">
          {!live ? null : (
            <button type="button" className="button" onClick={() => setMode("edit")}>
              <Pencil size={14} aria-hidden="true" />Edit
            </button>
          )}
          {!live ? null : (
            <button type="button" className="button" onClick={() => setMode("retire")}>
              <Trash2 size={14} aria-hidden="true" />Retire
            </button>
          )}
          {d.conversationId === null ? null : (
            <button type="button" className="button" disabled={busy} onClick={() => void run(() => onOpenConversation(d.conversationId as string))}>
              <MessageSquareText size={14} aria-hidden="true" />Conversation
            </button>
          )}
        </div>
      ) : null}
      {problem === null ? null : <p className="decision-problem" role="alert">{problem}</p>}
    </article>
  );
}

function EditForm({ decision: d, busy, onCancel, onSave }: { decision: DecisionCard; busy: boolean; onCancel: () => void; onSave: (patch: DecisionPatch) => void }) {
  const id = useId();
  const [goal, setGoal] = useState(d.goal);
  const [choice, setChoice] = useState(d.choice);
  const [reason, setReason] = useState(d.reason);
  const [status, setStatus] = useState<"hypothesis" | "tried_helpful" | "tried_unhelpful">(
    d.status === "tried_helpful" || d.status === "tried_unhelpful" ? d.status : "hypothesis",
  );
  const choiceRow = d.kind === "choice";
  const empty = goal.trim() === "" || reason.trim() === "" || (choiceRow && choice.trim() === "");

  function save() {
    const patch: DecisionPatch = {};
    if (goal.trim() !== d.goal) patch.goal = goal.trim();
    if (choiceRow && choice.trim() !== d.choice) patch.choice = choice.trim();
    if (reason.trim() !== d.reason) patch.reason = reason.trim();
    if (choiceRow && status !== d.status) patch.status = status;
    if (Object.keys(patch).length === 0) onCancel();
    else onSave(patch);
  }

  return (
    <form className="decision-edit" onSubmit={(event) => { event.preventDefault(); if (!empty) save(); }}>
      <label htmlFor={`${id}-goal`}>{d.kind === "priority" ? "What you said" : "Goal"}</label>
      <textarea id={`${id}-goal`} rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} disabled={busy} autoFocus />
      {!choiceRow ? null : (
        <>
          <label htmlFor={`${id}-choice`}>What was chosen</label>
          <textarea id={`${id}-choice`} rows={2} value={choice} onChange={(e) => setChoice(e.target.value)} disabled={busy} />
        </>
      )}
      <label htmlFor={`${id}-reason`}>Why</label>
      <textarea id={`${id}-reason`} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
      {!choiceRow ? null : (
        <>
          <label htmlFor={`${id}-status`}>How it went</label>
          <select id={`${id}-status`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)} disabled={busy}>
            <option value="hypothesis">Not tested yet</option>
            <option value="tried_helpful">It helped</option>
            <option value="tried_unhelpful">It didn&apos;t help</option>
          </select>
        </>
      )}
      <div className="decision-actions">
        <button type="submit" className="button button-primary" disabled={busy || empty}>
          {busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
          Save
        </button>
        <button type="button" className="button" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
