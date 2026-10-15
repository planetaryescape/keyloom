import { ArrowRight, CircleCheck, CircleSlash, Eye, EyeOff, Hammer, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ProposalCard as Proposal } from "../../api/http.ts";
import type { BoardDefinition } from "../../boards/schema.ts";
import type { Layout } from "../../layout/schema.ts";
import { ApiError } from "../api.ts";
import { Validation } from "../editor/Validation.tsx";
import { previewProposal } from "./preview.ts";
import { ProposalMoves } from "./ProposalMoves.tsx";
import { keyLabel, replacedNatives, slotKey, slotName } from "./proposal-facts.ts";
import "./proposal.css";

interface Props {
  proposal: Proposal;
  /** Which of several alternatives this is, so the card and its row in the comparison carry the same number. Omitted for a lone proposal. */
  option?: { number: number; of: number };
  layout: Layout;
  board: BoardDefinition;
  /** The card whose preview is pinned on the board. */
  pinned: boolean;
  /** Hover or focus on the card previews it on the board; leaving clears it. */
  onPreview: (proposal: Proposal | null) => void;
  onPin: (proposal: Proposal) => void;
  /** Applies it; rejects with the server's ApiError. */
  onApply: (proposal: Proposal) => Promise<void>;
  onAskAgain: () => void;
  onOpenRelease: () => void;
}

const MAX_ROWS = 6;

// One alternative from the agent. The same card serves a fresh proposal, an applied one and a
// superseded sibling, so the choice reads the same whichever you look at.
export function ProposalCard({ proposal, option, layout, board, pinned, onPreview, onPin, onApply, onAskAgain, onOpenRelease }: Props) {
  const titleId = useId();
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [failure, setFailure] = useState<{ message: string; stale: boolean } | null>(null);
  const [justApplied, setJustApplied] = useState(false);
  const outcome = useRef<HTMLDivElement>(null);
  const natives = useMemo(() => replacedNatives(layout, proposal), [layout, proposal]);
  // Read once, against the layout the proposal was made for: after an apply the head already holds
  // the change, and a card that read "S to S" would say nothing.
  const [rows] = useState(() => {
    const after = previewProposal(board, layout, proposal, "").layout;
    return proposal.validation.diff.changed
      .map((slot) => ({ key: slotKey(slot), where: slotName(layout, slot), before: keyLabel(layout, slot), after: keyLabel(after, slot) }))
      .filter((row) => row.before !== row.after);
  });
  const { gains, costs } = proposal.tradeoffs;
  const open = proposal.status === "proposed";

  // The apply moves focus here so a screen reader hears the result and the next step is a Tab away.
  useEffect(() => {
    if (justApplied) outcome.current?.focus();
  }, [justApplied]);

  async function apply() {
    setApplying(true);
    setFailure(null);
    try {
      await onApply(proposal);
      setConfirming(false);
      setJustApplied(true);
    } catch (error) {
      setConfirming(false);
      setFailure({
        message:
          error instanceof ApiError && error.code === "stale_base"
            ? "The layout changed after this was proposed, so it no longer applies cleanly."
            : error instanceof Error ? error.message : "Couldn't apply this.",
        stale: error instanceof ApiError && error.code === "stale_base",
      });
    } finally {
      setApplying(false);
    }
  }

  return (
    <article
      className="proposal"
      data-status={proposal.status}
      data-pinned={pinned}
      aria-labelledby={titleId}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse" && open) onPreview(proposal);
      }}
      onPointerLeave={() => onPreview(null)}
      onFocus={() => open && onPreview(proposal)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onPreview(null);
      }}
    >
      {option === undefined ? null : <p className="proposal-kicker">Option {option.number} of {option.of}</p>}
      <header className="proposal-head">
        <h3 id={titleId}>{proposal.title}</h3>
        {proposal.status === "applied" ? (
          <span className="proposal-badge" data-tone="success"><CircleCheck size={14} aria-hidden="true" />Applied</span>
        ) : proposal.status === "superseded" ? (
          <span className="proposal-badge"><CircleSlash size={14} aria-hidden="true" />Superseded</span>
        ) : null}
      </header>
      <p className="proposal-why">{proposal.explanation}</p>

      {rows.length === 0 ? null : (
        <div className="proposal-section">
          <h4>Changes</h4>
          <ul className="proposal-rows" aria-label="Keys this changes">
            {rows.slice(0, MAX_ROWS).map((row) => (
              <li key={row.key}>
                <span className="proposal-where">{row.where}</span>
                <span className="proposal-swap">
                  <kbd>{row.before}</kbd>
                  <ArrowRight size={14} aria-label="becomes" role="img" />
                  <kbd data-new="true">{row.after}</kbd>
                </span>
              </li>
            ))}
            {rows.length > MAX_ROWS ? <li className="muted">and {rows.length - MAX_ROWS} more</li> : null}
          </ul>
        </div>
      )}

      <ProposalMoves proposal={proposal} layout={layout} />

      <div className="tradeoffs">
        <div>
          <h4>Gains</h4>
          <ul>{gains.map((text) => <li key={text}>{text}</li>)}</ul>
        </div>
        <div>
          <h4>Costs</h4>
          <ul>{costs.map((text) => <li key={text}>{text}</li>)}</ul>
        </div>
      </div>

      {proposal.decisionDraft === null || !open ? null : (
        <div className="proposal-remembers">
          <h4>keyloom will remember</h4>
          <p>{proposal.decisionDraft.reason}</p>
        </div>
      )}

      <Validation layout={layout} idleNote="" state={{ status: "done", result: proposal.validation }} onRecheck={() => {}} showMoves={false} />

      {open ? (
        confirming ? (
          <div className="proposal-confirm" role="alertdialog" aria-labelledby={`${titleId}-confirm`}>
            <p id={`${titleId}-confirm`}>
              <TriangleAlert size={16} aria-hidden="true" />
              <span>
                This replaces {natives.length === 1 ? "a native binding" : `${natives.length} native bindings`}:{" "}
                {natives.map((n) => `${slotName(layout, n.slot)} (${n.binding.label})`).join(", ")}. The firmware code behind {natives.length === 1 ? "it is" : "them is"} removed, and keyloom can't write it back, though Undo restores it.
              </span>
            </p>
            <div className="proposal-actions">
              <button type="button" className="button button-primary" disabled={applying} onClick={() => void apply()} autoFocus>
                {applying ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
                Replace and apply
              </button>
              <button type="button" className="button" disabled={applying} onClick={() => setConfirming(false)}>Keep it</button>
            </div>
          </div>
        ) : (
          <div className="proposal-actions">
            <button type="button" className="button" aria-pressed={pinned} onClick={() => onPin(proposal)}>
              {pinned ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
              {pinned ? "Stop previewing" : "Show on keyboard"}
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={applying || !proposal.validation.ok || failure?.stale === true}
              onClick={() => (natives.length > 0 ? setConfirming(true) : void apply())}
            >
              {applying ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
              Apply
            </button>
          </div>
        )
      ) : null}

      {failure === null ? null : (
        <div className="proposal-problem" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <div>
            <p>{failure.message}</p>
            {failure.stale ? (
              <button type="button" className="button" onClick={onAskAgain}>Ask for a fresh proposal</button>
            ) : null}
          </div>
        </div>
      )}

      {justApplied && proposal.status === "applied" ? (
        <div className="proposal-next" ref={outcome} tabIndex={-1}>
          <p>
            <strong>Applied to your layout.</strong> It isn't on your keyboard yet, and Undo above the board takes it back.
          </p>
          <button type="button" className="button" onClick={onOpenRelease}>
            <Hammer size={14} aria-hidden="true" />
            Build and flash
          </button>
        </div>
      ) : null}
    </article>
  );
}
