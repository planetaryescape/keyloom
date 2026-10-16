import { ArrowRight, CircleCheck, CircleSlash, Eye, EyeOff, Hammer, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ProposalCard as Proposal } from "../../api/http.ts";
import type { BoardDefinition } from "../../boards/schema.ts";
import type { Layout } from "../../layout/schema.ts";
import { ApiError } from "../api.ts";
import { Validation } from "../editor/Validation.tsx";
import { previewProposal } from "./preview.ts";
import { ProposalMoves } from "./ProposalMoves.tsx";
import { changeWords, keyLabel, replacedNatives, shortTitle, slotKey, slotName } from "./proposal-facts.ts";
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
  /** The command bar's card: the explanation, the changes as chips, one trade-off line, the options as tabs, Apply (comp d). */
  compact?: boolean;
  /** The tabs that switch between options, drawn where the comp puts them, beside Apply. */
  alternatives?: React.ReactNode;
  /** The folded bar in a short window: the option's name, Not this and Apply on one line (P3 review). */
  line?: boolean;
}

const MAX_ROWS = 6;

// One alternative from the agent. The same card serves a fresh proposal, an applied one and a
// superseded sibling, so the choice reads the same whichever you look at.
export function ProposalCard({ proposal, option, layout, board, pinned, onPreview, onPin, onApply, onAskAgain, onOpenRelease, compact = false, alternatives = null, line = false }: Props) {
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
  // The bar's chips, in legend glyphs: what each changed key printed and what it will (comp d).
  const [chips] = useState(() => {
    const after = previewProposal(board, layout, proposal, "").layout;
    return proposal.validation.diff.changed.flatMap((slot) => {
      const words = changeWords(layout, after, slot);
      return words === null ? [] : [{ key: slotKey(slot), ...words }];
    });
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

  // The validator's warnings and errors, only when there are any: a clean proposal says nothing about checking.
  const problems = proposal.validation.errors.length + proposal.validation.warnings.length;

  // Applied, superseded, or Not this and Apply: the same in the card and in the folded line.
  const actions = (
    <>
          {proposal.status === "applied" ? (
            <span className="proposal-badge" data-tone="success" ref={outcome} tabIndex={-1}>
              <CircleCheck size={14} aria-hidden="true" />
              Applied
            </span>
          ) : proposal.status === "superseded" ? (
            <span className="proposal-badge"><CircleSlash size={14} aria-hidden="true" />Superseded</span>
          ) : open ? (
            <>
              <button type="button" className="bar-link" onClick={() => (confirming ? setConfirming(false) : onPin(proposal))} disabled={!pinned && !confirming}>
                {confirming ? "Keep it" : "Not this"}
              </button>
              <button
                type="button"
                className="bar-apply"
                disabled={applying || !proposal.validation.ok || failure?.stale === true}
                onClick={() => (natives.length > 0 && !confirming ? setConfirming(true) : void apply())}
              >
                {applying ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
                {confirming ? "Replace and apply" : "Apply"}
                {applying ? null : <kbd aria-hidden="true">↵</kbd>}
              </button>
            </>
          ) : null}
    </>
  );

  if (compact && line) {
    return (
      <article className="proposal-line" data-status={proposal.status} data-pinned={pinned} aria-label={proposal.title}>
        <strong className="proposal-line-title" title={proposal.title}>{shortTitle(proposal.title, 44)}</strong>
        {failure === null ? null : <span className="proposal-line-problem" role="alert">{failure.message}</span>}
        {confirming ? <span className="proposal-line-problem" role="alert">Replaces {natives.length === 1 ? "a custom key" : `${natives.length} custom keys`} keyloom can&apos;t write back; Undo restores it.</span> : null}
        <span className="proposal-bar-gap" />
        {actions}
      </article>
    );
  }

  if (compact) {
    const confirmBlock = confirming ? (
      <div className="proposal-confirm" role="alertdialog" aria-labelledby={`${titleId}-confirm`}>
        <p id={`${titleId}-confirm`}>
          <TriangleAlert size={16} aria-hidden="true" />
          <span>
            This replaces {natives.length === 1 ? "a custom key" : `${natives.length} custom keys`}: {natives.map((n) => slotName(layout, n.slot)).join(", ")}. keyloom can&apos;t write their firmware code back, though Undo restores it.
          </span>
        </p>
      </div>
    ) : null;
    return (
      <article className="proposal proposal-compact" data-status={proposal.status} data-pinned={pinned} aria-labelledby={titleId}>
        <h3 id={titleId} className="sr-only">{proposal.title}</h3>
        {/* The tab carries a short name; the full title leads the sentence. */}
        <p className="proposal-why"><strong>{proposal.title.replace(/[.\s]+$/, "")}.</strong> {proposal.explanation}</p>
        {chips.length === 0 ? null : (
          <ul className="proposal-chips" aria-label="Keys this changes">
            {chips.map((chip) => (
              <li key={chip.key}>
                <span>{chip.from}</span>
                <ArrowRight size={12} aria-label="becomes" role="img" />
                <strong>{chip.to}</strong>
              </li>
            ))}
          </ul>
        )}
        {costs.length === 0 ? null : <p className="proposal-trade"><span>Trade-off:</span> {costs.join(" ")}</p>}
        {proposal.decisionDraft === null || !open ? null : <p className="proposal-trade"><span>keyloom will remember:</span> {proposal.decisionDraft.reason}</p>}
        {problems === 0 ? null : <Validation layout={layout} idleNote="" state={{ status: "done", result: proposal.validation }} onRecheck={() => {}} showMoves={false} />}
        {confirmBlock}
        {failure === null ? null : (
          <div className="proposal-problem" role="alert">
            <TriangleAlert size={16} aria-hidden="true" />
            <div>
              <p>{failure.message}</p>
              {failure.stale ? <button type="button" className="bar-link" onClick={onAskAgain}>Ask for a fresh proposal</button> : null}
            </div>
          </div>
        )}
        <div className="proposal-bar-foot">
          {alternatives}
          <span className="proposal-bar-gap" />
          {actions}
        </div>
      </article>
    );
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
