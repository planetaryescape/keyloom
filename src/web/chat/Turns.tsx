import { ArrowRight, ArrowRightLeft, Check, CheckCircle2, CircleAlert, Keyboard, MapPin, RefreshCw, ShieldCheck } from "lucide-react";
import type { ChatSelection, ProposalCard as Proposal } from "../../api/http.ts";
import type { AgentArtifact } from "../../api/artifacts.ts";
import type { BoardDefinition } from "../../boards/schema.ts";
import type { Layout } from "../../layout/schema.ts";
import { groupProposals } from "./compare.ts";
import { Markdown } from "./Markdown.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { PriorityChips } from "./PriorityChips.tsx";
import { ProposalCompare } from "./ProposalCompare.tsx";
import { ProposalCard } from "./ProposalCard.tsx";
import { ProposalTabs } from "./ProposalTabs.tsx";
import { keyLabel, layerName, optionLabels } from "./proposal-facts.ts";
import { type AssistantTurn, type ConfirmationCard, type OutcomeCard, type UserTurn, questionOpen, questionSkipped } from "./transcript.ts";
import { AgentWorking } from "./AgentWorking.tsx";
import { ConfigCardList, type ConfigCards } from "./ConfigCards.tsx";
import type { AgentWorkStatus, AgentWorkView } from "./work-view.ts";
import { presentationView } from "./presentation-view.ts";
import { TurnUsage } from "./TurnUsage.tsx";

export function UserMessage({ turn, layout, context, onSelectKeys }: { turn: UserTurn; layout: Layout; context?: string; onSelectKeys?: (selection: ChatSelection) => void }) {
  const { selection } = turn;
  return (
    <div className="msg msg-user">
      <p className="msg-who">You</p>
      <div className="msg-bubble">
        <p>{turn.text}</p>
        {selection === null ? null : (
          <p className="msg-selection">
            Selected on {layerName(layout, selection.layerId)}:{" "}
            {onSelectKeys ? (
              <button
                type="button"
                className="msg-selection-action"
                onClick={() => onSelectKeys(selection)}
                title="Select these keys on the board"
              >
                {selection.positions.map((position) => keyLabel(layout, { layerId: selection.layerId, position })).join(", ")}
              </button>
            ) : (
              selection.positions.map((position) => keyLabel(layout, { layerId: selection.layerId, position })).join(", ")
            )}
          </p>
        )}
      </div>
      {context === undefined ? null : <p className="msg-context">{context}</p>}
    </div>
  );
}

function ConfirmationCardView({ confirmation, onConfirm, onCancel, disabled }: { confirmation: ConfirmationCard; onConfirm?: (planId: string) => void; onCancel?: (planId: string) => void; disabled?: boolean }) {
  const isPending = confirmation.status === "pending";
  return (
    <section className={`ask-card ${isPending ? "" : "ask-card-done"}`} aria-label="Confirmation">
      <p className="ask-question">
        <ShieldCheck size={16} aria-hidden="true" className="ask-icon" />
        <span>{confirmation.title}</span>
      </p>
      <div className="ask-details">
        {confirmation.targets.length > 0 ? (
          <p className="ask-description">Targets: {confirmation.targets.join(", ")}</p>
        ) : null}
        {confirmation.effects.map((effect, idx) => (
          <p key={idx} className="ask-description">• {effect}</p>
        ))}
        {confirmation.consequences.map((c, idx) => (
          <p key={idx} className="ask-description" style={{ color: "var(--color-warning)" }}>⚠️ {c}</p>
        ))}
      </div>
      {isPending ? (
        <div className="ask-actions" style={{ gap: "var(--space-2)" }}>
          <button
            type="button"
            className="button button-primary"
            disabled={disabled}
            onClick={() => onConfirm?.(confirmation.planId)}
          >
            Approve plan
          </button>
          <button
            type="button"
            className="button"
            disabled={disabled}
            onClick={() => onCancel?.(confirmation.planId)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <p className="ask-answer">
          <Check size={14} aria-hidden="true" />
          <span>{confirmation.status === "approved" ? "Plan approved" : "Plan cancelled"}</span>
        </p>
      )}
    </section>
  );
}

function OutcomeCardView({ outcome }: { outcome: OutcomeCard }) {
  return (
    <section className="ask-card ask-card-done" aria-label="Hardware outcome">
      <p className="ask-answer">
        <CheckCircle2 size={16} aria-hidden="true" style={{ color: "var(--color-success)" }} />
        <span>{outcome.saved}</span>
      </p>
      {outcome.hardwareOutcome !== "unchanged" ? (
        <p className="ask-description" style={{ marginTop: "4px" }}>
          Device: {outcome.device ?? "Keyboard"} · {outcome.hardwareOutcome.replace(/_/g, " ")}
        </p>
      ) : null}
    </section>
  );
}

function TransferArtifactView({ transfer }: { transfer: Extract<AgentArtifact, { kind: "transfer" }> }) {
  return (
    <section className="ask-card ask-card-done" aria-label="Transfer report">
      <p className="ask-question" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <span>{transfer.sourceBoard}</span>
        <ArrowRight size={14} aria-hidden="true" />
        <span>{transfer.destinationBoard}</span>
      </p>
      <p className="ask-description">
        {transfer.mappedCount} keys mapped successfully.
      </p>
      {transfer.skipped.length > 0 ? (
        <details className="ask-details" style={{ marginTop: "var(--space-1)" }}>
          <summary style={{ cursor: "pointer", fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
            {transfer.skipped.length} unsupported or skipped item(s)
          </summary>
          <ul style={{ margin: "var(--space-1) 0 0 var(--space-3)", padding: 0, fontSize: "var(--text-xs)" }}>
            {transfer.skipped.map((s, idx) => (
              <li key={idx} style={{ color: "var(--color-text-muted)" }}>
                <strong>{s.key}</strong>: {s.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function KeyLocationsArtifactView({ locations }: { locations: Extract<AgentArtifact, { kind: "key_locations" }> }) {
  return (
    <section className="ask-card ask-card-done" aria-label="Key locations">
      <p className="ask-question" style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
        <MapPin size={14} aria-hidden="true" />
        <span>Locations for {locations.functionName}</span>
      </p>
      <div className="ask-chips">
        {locations.locations.map((loc, idx) => (
          <span key={idx} className="button ask-layer-chip" style={{ fontSize: "var(--text-xs)" }}>
            {loc.layerName}: Key {loc.position} ({loc.label})
          </span>
        ))}
      </div>
    </section>
  );
}

function KeyboardListArtifactView({ list }: { list: Extract<AgentArtifact, { kind: "keyboard_list" }> }) {
  return (
    <section className="ask-card ask-card-done" aria-label="Registered keyboards">
      <p className="ask-question" style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
        <Keyboard size={14} aria-hidden="true" />
        <span>Keyboards ({list.keyboards.length})</span>
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", marginTop: "var(--space-1)" }}>
        {list.keyboards.map((kb) => (
          <div key={kb.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "var(--text-xs)" }}>
            <span><strong>{kb.name}</strong> ({kb.configs.join(", ")})</span>
            <span style={{ color: kb.connected ? "var(--color-success)" : "var(--color-text-muted)" }}>
              {kb.connected ? "Connected" : "Offline"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

const ENDINGS: Record<string, string> = {
  refused: "The model declined to answer that. Rephrase it and try again.",
  truncated: "The reply was cut off. Ask keyloom to continue.",
  context_full: "This conversation has grown too long for the model to continue. Start a new one.",
  iteration_limit: "keyloom stopped after too many steps. Ask again, or narrow what you want.",
};

// What went wrong, by the server's code (model_<ModelErrorKind>), in the words of comp d2. Anything else stays "The reply stopped".
const FAILURE_TITLES: Record<string, string> = {
  model_no_credits: "Out of credits",
  model_auth: "The key was refused",
  model_permission: "The key can't use this model",
  model_rate_limit: "The model is busy",
  model_overloaded: "The model is busy",
  model_connection: "Can't reach the model",
};
// Failures that another provider would not have: the account, not the request. Only these offer a switch.
const ACCOUNT_FAILURES = new Set(["model_no_credits", "model_auth", "model_permission"]);

interface Props {
  turn: AssistantTurn;
  layout: Layout;
  board: BoardDefinition;
  pinnedId: string | null;
  onPreview: (proposal: Proposal | null) => void;
  onPin: (proposal: Proposal) => void;
  onApply: (proposal: Proposal) => Promise<void>;
  onRemovePriority: (id: string) => Promise<void>;
  onAskAgain: () => void;
  onOpenRelease: () => void;
  onRetry: () => void;
  /** The person's answer to the question this reply asked. */
  onAnswer: (toolUseId: string, text: string) => void;
  /** A reply is streaming, so a question can't be answered until it ends. */
  busy?: boolean;
  /** Other providers that are ready, offered when this one refused the account (out of credits, a key it rejects). */
  switchTo?: readonly { id: string; name: string }[];
  /** Starts a new conversation on that provider with the message that failed back in the box. */
  onSwitch?: (id: string) => void;
  /** The command bar: alternatives are tabs and one card shows at a time, the one on the board (comp d). */
  compact?: boolean;
  /** UI-only projection of observed operations and explicit public working notes. */
  working?: AgentWorkView;
  motionPaused?: boolean;
  /** The configs this reply made, as cards that open them; absent where the page can't switch config. */
  configCards?: ConfigCards;
  /** The ids of proposals a later one revised, anywhere in the thread: a superseded card reads "by the revised proposal" only for these (D-452). */
  revised?: ReadonlySet<string>;
}

export function AssistantMessage({ turn, layout, board, pinnedId, onPreview, onPin, onApply, onRemovePriority, onAskAgain, onOpenRelease, onRetry, onAnswer, busy = false, switchTo = [], onSwitch, compact = false, working, motionPaused = false, configCards, revised }: Props) {
  const streaming = turn.phase === "streaming";
  const ending = turn.ending === null ? undefined : ENDINGS[turn.ending];
  const offers = turn.proposals.length;
  const status: AgentWorkStatus = questionOpen(turn) ? "waiting" : turn.phase === "streaming" ? "running" : turn.phase === "failed" ? "failed" : turn.phase === "stopped" ? "stopped" : "completed";
  // Existing turns have no correlated lifecycle. Never infer completed calls from their old tool-name hint.
  let work: AgentWorkView = working ?? (turn.presentation === undefined ? { kind: "unavailable", status } : presentationView(turn.presentation, turn.preparations));
  if (questionOpen(turn)) work = { ...work, status: "waiting" };
  // The recorded run paused on this question; skipping it ended the wait, whatever the stored presentation still says (D-452).
  else if (questionSkipped(turn) && work.status === "waiting") work = { ...work, status: "completed" };
  else if (turn.phase === "stopped") work = { ...work, status: "stopped" };
  else if (turn.failure !== null && work.status !== "disconnected") work = { ...work, status: "failed" };
  return (
    <div className="msg msg-assistant" data-phase={turn.phase}>
      <p className="msg-who">keyloom</p>
      <PriorityChips priorities={turn.priorities} layout={layout} onRemove={onRemovePriority} />
      <AgentWorking view={work} motionPaused={motionPaused} />
      {/* Hidden from the live region until the reply is whole, so a screen reader hears it once, not token by token. */}
      <div aria-hidden={streaming || undefined}>
        {turn.text === "" ? null : <Markdown source={turn.text} />}
        {turn.phase === "done" && offers > 0 ? <p className="sr-only">keyloom offered {offers} {offers === 1 ? "option" : "options"}.</p> : null}
      </div>
      {turn.confirmation ? <ConfirmationCardView confirmation={turn.confirmation} disabled={busy} /> : null}
      {turn.outcome ? <OutcomeCardView outcome={turn.outcome} /> : null}
      {turn.artifacts?.map((artifact, idx) => {
        if (artifact.kind === "transfer") return <TransferArtifactView key={idx} transfer={artifact} />;
        if (artifact.kind === "key_locations") return <KeyLocationsArtifactView key={idx} locations={artifact} />;
        if (artifact.kind === "keyboard_list") return <KeyboardListArtifactView key={idx} list={artifact} />;
        return null;
      })}
      <ConfigCardList presentation={turn.presentation} cards={configCards} />
      {turn.phase === "stopped" ? <p className="msg-note">Stopped. Configs or proposals prepared before Stop may remain.</p> : null}
      {ending === undefined || turn.phase !== "done" ? null : <p className="msg-note">{ending}</p>}
      {compact
        ? groupProposals(turn.proposals).map((group) => {
            const shown = group.find((proposal) => proposal.changeSetId === pinnedId) ?? group.find((proposal) => proposal.status === "applied") ?? group[0];
            if (shown === undefined) return null;
            return (
              <section className="proposal-group proposal-bar" data-superseded={group.length === 1 && shown.status === "superseded"} key={group[0]?.changeSetId} aria-label={group.length > 1 ? `${group.length} options` : "Option"}>
                {/* Outside the keyed card, so switching options keeps the tab row, and the focus on it, mounted. */}
                <ProposalTabs group={group} shownId={shown.changeSetId} pinnedId={pinnedId} onPin={onPin} />
                <ProposalCard
                  // A card reads its rows once, against the layout it was made for: each option is its own card.
                  key={shown.changeSetId}
                  proposal={shown}
                  layout={layout}
                  board={board}
                  pinned={pinnedId === shown.changeSetId}
                  onPreview={onPreview}
                  onPin={onPin}
                  onApply={onApply}
                  onAskAgain={onAskAgain}
                  onOpenRelease={onOpenRelease}
                  revised={revised?.has(shown.changeSetId) ?? false}
                  compact
                />
              </section>
            );
          })
        : groupProposals(turn.proposals).map((group) => (
        <section className="proposal-group" key={group[0]?.changeSetId} aria-label={group.length > 1 ? `${group.length} options` : "Option"}>
          {group.length > 1 ? <ProposalCompare group={group} layout={layout} pinnedId={pinnedId} onPreview={onPreview} onPin={onPin} /> : null}
          <ul className="proposals" aria-live="off">
            {group.map((proposal, index) => (
              <li key={proposal.changeSetId}>
                <ProposalCard
                  proposal={proposal}
                  {...(group.length > 1 ? { option: { number: index + 1, of: group.length } } : {})}
                  layout={layout}
                  board={board}
                  pinned={pinnedId === proposal.changeSetId}
                  onPreview={onPreview}
                  onPin={onPin}
                  onApply={onApply}
                  onAskAgain={onAskAgain}
                  onOpenRelease={onOpenRelease}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {/* After the proposal it refines: the proposal is on the board first, and the question asks about it (D-452). */}
      {turn.question === null ? null : <QuestionCard question={turn.question} skipped={questionSkipped(turn)} disabled={busy} onAnswer={onAnswer} />}
      {turn.failure === null ? null : (
        <div className="chat-problem chat-problem-inline" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <div className="chat-problem-body">
            <strong>{FAILURE_TITLES[turn.failure.code] ?? "The reply stopped"}</strong>
            <p>
              {turn.failure.message} Configs or proposals prepared before the reply stopped may remain. Check them before trying again.
            </p>
            <div className="chat-problem-actions">
              {ACCOUNT_FAILURES.has(turn.failure.code) && onSwitch !== undefined
                ? switchTo.map((other) => (
                    <button key={other.id} type="button" className="button" onClick={() => onSwitch(other.id)}>
                      <ArrowRightLeft size={14} aria-hidden="true" />
                      Switch to {other.name}
                    </button>
                  ))
                : null}
              <button type="button" className="button" onClick={onRetry}>
                <RefreshCw size={14} aria-hidden="true" />
                Try again
              </button>
            </div>
          </div>
        </div>
      )}
      {streaming ? null : <TurnUsage accounting={turn.accounting} />}
    </div>
  );
}
