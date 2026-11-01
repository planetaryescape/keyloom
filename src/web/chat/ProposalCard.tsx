import { ArrowRight, ChevronRight, CircleCheck, CircleSlash, Eye, EyeOff, Hammer, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ProposalCard as Proposal } from "../../api/http.ts";
import type { BoardDefinition } from "../../boards/schema.ts";
import type { Layout } from "../../layout/schema.ts";
import { ApiError } from "../api.ts";
import { functionName } from "../editor/function-label.ts";
import { Validation } from "../editor/Validation.tsx";
import { previewProposal } from "./preview.ts";
import { ProposalMoves } from "./ProposalMoves.tsx";
import { changeWords, keyLabel, leadSentence, replacedNatives, shortTitle, slotKey, slotName } from "./proposal-facts.ts";
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
  /** The folded bar in a short window: the option's name, Not this and Apply on one line (P3 review). */
  line?: boolean;
  /** A later proposal revised this one (D-452), so a superseded card says "by the revised proposal". Absent for one set aside because a sibling was applied. */
  revised?: boolean;
}

const MAX_ROWS = 6;

// One alternative from the agent. The same card serves a fresh proposal, an applied one and a
// superseded sibling, so the choice reads the same whichever you look at.
export function ProposalCard({ proposal, option, layout, board, pinned, onPreview, onPin, onApply, onAskAgain, onOpenRelease, compact = false, line = false, revised = false }: Props) {
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
      const words = changeWords(layout, after, slot, board);
      return words === null ? [] : [{ key: slotKey(slot), ...words }];
    });
  });
  const { gains, costs } = proposal.tradeoffs;
  // The validator's count, not the rows': a key whose binding changes while its printed label stays the same still changes.
  const changedKeys = proposal.validation.diff.changed.length;
  const open = proposal.status === "proposed";
  // A function the proposal gives up on purpose is said where Apply is, with its reason: the keys on the board show what moves, not what is lost.
  const { dropped } = proposal.validation.diff;

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
  const { lead, rest } = leadSentence(proposal.explanation);
  // The details show the moves as chips, so "function lost" would only say them again (the same filter as the full form's hideLost).
  const issues = [
    ...proposal.validation.errors.map((issue) => ({ tone: "error" as const, text: issue.plain ?? issue.message })),
    ...proposal.validation.warnings.filter((issue) => issue.code !== "function_lost").map((issue) => ({ tone: "warning" as const, text: issue.plain ?? issue.message })),
  ];

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
              {/* onPin toggles: Not this takes it off the board, and Show it puts it back, so a lone proposal (no tabs) is never stuck off it. */}
              <button type="button" className="bar-link" onClick={() => (confirming ? setConfirming(false) : onPin(proposal))}>
                {confirming ? "Keep it" : pinned ? "Not this" : "Show it"}
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
        {dropped.length === 0 ? null : <span className="proposal-line-drop">Drops {dropped.map((d) => functionName(d.function, layout)).join(", ")}</span>}
        {failure === null ? null : <span className="proposal-line-problem" role="alert">{failure.message}</span>}
        {confirming ? <span className="proposal-line-problem" role="alert">Replaces {natives.length === 1 ? "a custom key" : `${natives.length} custom keys`} keyloom can&apos;t write back; Undo restores it.</span> : null}
        <span className="proposal-bar-gap" />
        {actions}
      </article>
    );
  }

  // A revised proposal replaces this one on the board, so the old card folds to a line; Details still holds all it said (D-452).
  if (compact && proposal.status === "superseded") {
    return (
      <article className="proposal-superseded" data-status="superseded" aria-label={`${proposal.title}, superseded`}>
        <p>
          <CircleSlash size={14} aria-hidden="true" />
          <strong title={proposal.title}>{shortTitle(proposal.title, 44)}</strong>
          <span>{revised ? "Superseded by the revised proposal" : "Superseded"}</span>
        </p>
        <ProposalDetails chips={chips} rest={proposal.explanation} gains={gains} costs={costs} remembers={null} />
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
        <h3 id={titleId} className="proposal-title">{proposal.title}</h3>
        <p className="proposal-why">{lead}</p>
        {changedKeys === 0 && costs.length === 0 ? null : (
          <p className="proposal-facts">
            {changedKeys === 0 ? null : <strong>{changedKeys} {changedKeys === 1 ? "key changes" : "keys change"}</strong>}
            {changedKeys === 0 || costs.length === 0 ? null : <span aria-hidden="true"> · </span>}
            {costs.length === 0 ? null : <span className="proposal-cost">{costs.join("; ")}</span>}
          </p>
        )}
        {dropped.map((d) => (
          <p key={d.function} className="proposal-drop">
            <CircleSlash size={14} aria-hidden="true" />
            <span><strong>Drops {functionName(d.function, layout)}</strong> · {d.reason}</span>
          </p>
        ))}
        <ProposalNotes issues={issues} />
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
        <ProposalDetails chips={chips} rest={rest} gains={gains} costs={costs} remembers={proposal.decisionDraft === null || !open ? null : proposal.decisionDraft.reason} />
        <div className="proposal-bar-foot">
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

type Note = { tone: "error" | "warning"; text: string };

/** The validator's findings in chat: one line, and the full text a tap away. The editor keeps the full list (Validation.tsx). */
function ProposalNotes({ issues }: { issues: readonly Note[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const [first] = issues;
  if (first === undefined) return null;
  const errors = issues.filter((issue) => issue.tone === "error").length;
  const summary = issues.length === 1 ? first.text : `${issues.length} ${errors > 0 ? "problems" : "warnings"}`;
  return (
    <div className="proposal-notes" data-tone={errors > 0 ? "error" : "warning"}>
      <button type="button" className="proposal-notes-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <TriangleAlert size={14} aria-hidden="true" />
        <span data-open={open}>{summary}</span>
      </button>
      <ul id={id} hidden={!open}>
        {issues.map((issue, index) => <li key={index}>{issue.text}</li>)}
      </ul>
    </div>
  );
}

/** What a reader checks before applying, behind one button: the keys, the rest of the reasoning, both sides of the trade and what keyloom will remember. */
function ProposalDetails({ chips, rest, gains, costs, remembers }: {
  chips: readonly { key: string; from: string; to: string }[];
  rest: string;
  gains: readonly string[];
  costs: readonly string[];
  remembers: string | null;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (chips.length === 0 && rest === "" && gains.length === 0 && costs.length === 0 && remembers === null) return null;
  return (
    <div className="proposal-details">
      <button type="button" className="proposal-details-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <ChevronRight size={14} aria-hidden="true" />
        Details
      </button>
      <div id={id} hidden={!open}>
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
        {rest === "" ? null : <p>{rest}</p>}
        {gains.length === 0 ? null : <><h4>Gains</h4><ul>{gains.map((text) => <li key={text}>{text}</li>)}</ul></>}
        {costs.length === 0 ? null : <><h4>Costs</h4><ul>{costs.map((text) => <li key={text}>{text}</li>)}</ul></>}
        {remembers === null ? null : <><h4>keyloom will remember</h4><p>{remembers}</p></>}
      </div>
    </div>
  );
}
