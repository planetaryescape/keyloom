import { ArrowRight, ArrowRightLeft, Check, CheckCircle2, CircleAlert, ExternalLink, History, Keyboard, KeyRound, MapPin, MessageSquarePlus, RefreshCw, ShieldCheck } from "lucide-react";
import { RestartKeyloom } from "../shell/RestartKeyloom.tsx";
import type { ChatSelection, ProposalCard as Proposal } from "../../api/http.ts";
import type { AgentArtifact } from "../../api/artifacts.ts";
import type { BoardDefinition } from "../../boards/schema.ts";
import type { Layout } from "../../layout/schema.ts";
import { groupProposals } from "./compare.ts";
import { Markdown, type DrawReference } from "./Markdown.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { PriorityChips } from "./PriorityChips.tsx";
import { ProposalCompare } from "./ProposalCompare.tsx";
import { ProposalCard } from "./ProposalCard.tsx";
import { ProposalTabs } from "./ProposalTabs.tsx";
import { keyLabel, layerName, optionLabels } from "./proposal-facts.ts";
import { type AssistantTurn, type ConfirmationCard, type OutcomeCard, type UserTurn, questionClosed, questionOpen, questionSkipped } from "./transcript.ts";
import { AgentWorking } from "./AgentWorking.tsx";
import { ConfigCardList, type ConfigCards } from "./ConfigCards.tsx";
import type { AgentWorkStatus, AgentWorkView } from "./work-view.ts";
import { presentationView } from "./presentation-view.ts";
import { TurnUsage } from "./TurnUsage.tsx";
import { type FailureAction, type FailureView, type Prepared, failureView, preparedWords } from "./failure-words.ts";

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

// The copy's card (D-467). It says what came across, what did not and why, and what was never about keys. The carried sentence leads, the
// per-layer breakdown folds under it, and the drops — what decides whether the copy is usable — follow as the next thing, also behind a
// disclosure, so the card is short. It reads as keyloom talking: no success wording, no exclamation, and every count names the plan's facts.
function TransferArtifactView({ transfer }: { transfer: Extract<AgentArtifact, { kind: "transfer" }> }) {
  const dropped = transfer.skippedCount ?? transfer.skipped.length;
  const layers = transfer.layers ?? [];
  const layerTotal = transfer.layerCount ?? layers.length;
  const guessed = transfer.guessedCount ?? 0;
  const combos = transfer.combos;
  const combosSkipped = combos === undefined ? 0 : (combos.skippedCount ?? combos.skipped.length);
  const notes = transfer.notes ?? [];
  const noteTotal = transfer.noteCount ?? notes.length;
  const placed = transfer.placementCount ?? 0;
  const blocked = transfer.placementsBlocked ?? 0;
  const carried = transfer.mappedCount;
  const carriedKeys = carried === 1 ? "1 key" : `${carried} keys`;
  const onLayers = layerTotal > 1 ? ` on ${layerTotal} layers` : "";
  const guesses = guessed > 0 ? `, ${guessed} of them nearest-place guesses` : "";
  const carriedLine = carried === 0
    ? "No keys came across."
    : dropped === 0
      ? `All ${carriedKeys} came across${onLayers}${guesses}.`
      : `${carriedKeys} came across${onLayers}${guesses}.`;
  return (
    <section className="ask-card ask-card-done transfer-card" aria-label="Transfer report">
      <p className="ask-question config-card-title">
        <span>{transfer.sourceBoard}</span>
        <ArrowRight size={14} aria-hidden="true" />
        <span>{transfer.destinationBoard}</span>
      </p>
      <p className="ask-description">{carriedLine}</p>
      {layerTotal > 1 ? (
        <details className="ask-details transfer-layers-details">
          <summary>Carried by layer</summary>
          <ul className="transfer-layers">
            {layers.map((layer, index) => (
              <li key={index}>
                <strong>{layer.source}</strong>: {layer.carried} carried
                {layer.guessed > 0 ? `, ${layer.guessed} guessed` : ""}
                {layer.notCarried > 0 ? `, ${layer.notCarried} left off` : ""}
              </li>
            ))}
            {layerTotal > layers.length ? <li>and {layerTotal - layers.length} more {layerTotal - layers.length === 1 ? "layer" : "layers"}</li> : null}
          </ul>
        </details>
      ) : null}
      {dropped > 0 ? (
        <details className="ask-details transfer-drops">
          <summary>{dropped === 1 ? "1 key did not come across" : `${dropped} keys did not come across`}</summary>
          <ul>
            {transfer.skipped.map((item, index) => (
              <li key={index}>
                <strong>{item.key}</strong>: {item.reason}
              </li>
            ))}
            {dropped > transfer.skipped.length ? <li>and {dropped - transfer.skipped.length} more</li> : null}
          </ul>
        </details>
      ) : null}
      {combos === undefined || (combos.copied === 0 && combosSkipped === 0) ? null : (
        <p className="ask-description">
          {combos.copied === 0 ? "No combos copied" : `${combos.copied} ${combos.copied === 1 ? "combo" : "combos"} copied`}
          {combosSkipped === 0
            ? "."
            : `; ${combosSkipped} did not: ${combos.skipped.map((combo) => `${combo.id} (${combo.why})`).join("; ")}${combosSkipped > combos.skipped.length ? `, and ${combosSkipped - combos.skipped.length} more` : ""}.`}
        </p>
      )}
      {placed > 0 ? <p className="ask-description">{placed === 1 ? "1 layer key had nowhere of its own and was placed on a free key." : `${placed} layer keys had nowhere of their own and were placed on free keys.`}</p> : null}
      {blocked > 0 ? <p className="ask-description">{blocked === 1 ? "1 layer key could not be placed: the layer it enters has no way back on this board." : `${blocked} layer keys could not be placed: the layers they enter have no way back on this board.`}</p> : null}
      {notes.length > 0 ? (
        <div className="transfer-notes">
          <p className="transfer-label">Left out</p>
          <ul>
            {notes.map((note, index) => <li key={index}>{note}</li>)}
          </ul>
          {noteTotal > notes.length ? <p className="ask-description">and {noteTotal - notes.length} more</p> : null}
        </div>
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
  // The button under it starts the new conversation (R1-23).
  context_full: "This conversation has grown too long for the model to continue.",
  iteration_limit: "keyloom stopped after too many steps. Ask again, or narrow what you want.",
};

interface Props {
  turn: AssistantTurn;
  layout: Layout;
  board: BoardDefinition;
  pinnedId: string | null;
  onPreview: (proposal: Proposal | null) => void;
  onPin: (proposal: Proposal) => void;
  onApply: (proposal: Proposal) => Promise<void>;
  onRemovePriority: (id: string) => Promise<void>;
  onAskAgain: (proposal: Proposal, reasons: string[]) => void;
  refusalRecovery?: { reasons: string[]; onPlan: () => void };
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
  /** Opens the model setup with this provider's key field, for a key that was refused or ran out (D-496). */
  onSetUpModel?: () => void;
  /** The provider's billing page, offered when the account is out of credits. */
  creditsUrl?: string | undefined;
  /** The command bar: alternatives are tabs and one card shows at a time, the one on the board (comp d). */
  compact?: boolean;
  /** UI-only projection of observed operations and explicit public working notes. */
  working?: AgentWorkView;
  motionPaused?: boolean;
  /** The configs this reply made, as cards that open them; absent where the page can't switch config. */
  configCards?: ConfigCards;
  /** The ids of proposals a later one revised, anywhere in the thread: a superseded card reads "by the revised proposal" only for these (D-452). */
  revised?: ReadonlySet<string>;
  /** Draws a reference the reply named (D-468): a chip that goes to it, or the words it stands for. */
  reference?: DrawReference;
  /** Starts a new conversation, for a reply that ended because this one is full. */
  onNewConversation?: () => void;
  /** Opens the model setup on a provider other than this conversation's, for a plan whose usage limit is reached (R5-04). */
  onSetUpOther?: () => void;
  /** Opens the conversation history, for a message keyloom may have accepted without confirming it (R5-07). */
  onOpenHistory?: () => void;
  /** The session token, for the failure box's Restart keyloom (R7-01, R7-09). */
  token?: string;
  /** Reads this conversation's proposals again, after Apply found one no longer open (R6-06). Rejects when the read failed. */
  onReadProposals?: () => Promise<void>;
}

export function AssistantMessage({ turn, layout, board, pinnedId, onPreview, onPin, onApply, onRemovePriority, onAskAgain, refusalRecovery, onOpenRelease, onRetry, onAnswer, busy = false, switchTo = [], onSwitch, onSetUpModel, creditsUrl, compact = false, working, motionPaused = false, configCards, revised, reference, onNewConversation, onSetUpOther, onOpenHistory, onReadProposals, token }: Props) {
  const streaming = turn.phase === "streaming";
  const ending = turn.ending === null ? undefined : ENDINGS[turn.ending];
  const offers = turn.proposals.length;
  const status: AgentWorkStatus = questionOpen(turn) ? "waiting" : turn.phase === "streaming" ? "running" : turn.phase === "failed" ? "failed" : turn.phase === "stopped" ? "stopped" : "completed";
  // Existing turns have no correlated lifecycle. Never infer completed calls from their old tool-name hint.
  let work: AgentWorkView = working ?? (turn.presentation === undefined ? { kind: "unavailable", status } : presentationView(turn.presentation, turn.preparations));
  if (questionOpen(turn)) work = { ...work, status: "waiting" };
  // The recorded run paused on this question; skipping or closing it ended the wait, whatever the stored presentation still says (D-452).
  else if ((questionSkipped(turn) || questionClosed(turn)) && work.status === "waiting") work = { ...work, status: "completed" };
  else if (turn.phase === "stopped") work = { ...work, status: "stopped" };
  else if (turn.failure !== null && work.status !== "disconnected") work = { ...work, status: "failed" };
  return (
    <div className="msg msg-assistant" data-phase={turn.phase}>
      <p className="msg-who">keyloom</p>
      <PriorityChips priorities={turn.priorities} layout={layout} onRemove={onRemovePriority} />
      {streaming ? <AgentWorking view={work} motionPaused={motionPaused} /> : null}
      {/* Hidden from the live region until the reply is whole, so a screen reader hears it once, not token by token. */}
      <div aria-hidden={streaming || undefined}>
        {turn.text === "" ? null : <Markdown source={turn.text} {...(reference === undefined ? {} : { reference })} />}
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
      {refusalRecovery === undefined ? null : <div className="proposal-problem"><div><p>The proposed change was refused by validation. No replacement proposal was recorded for this reply.</p>{refusalRecovery.reasons.map((reason) => <p key={reason}>{reason}</p>)}<button type="button" className="bar-link" onClick={refusalRecovery.onPlan}>Plan a revised proposal</button></div></div>}
      {turn.phase === "stopped" ? <p className="msg-note">Stopped. Configs or proposals prepared before Stop may remain.</p> : null}
      {ending === undefined || turn.phase !== "done" ? null : <p className="msg-note">{ending}</p>}
      {turn.ending === "context_full" && turn.phase === "done" && onNewConversation !== undefined ? (
        <button type="button" className="bar-link" disabled={busy} onClick={onNewConversation}>Start a new conversation</button>
      ) : null}
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
                  onReadAgain={busy ? undefined : onReadProposals}
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
                  onReadAgain={busy ? undefined : onReadProposals}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {/* After the proposal it refines: the proposal is on the board first, and the question asks about it (D-452). */}
      {turn.question === null ? null : <QuestionCard question={turn.question} disabled={busy} onAnswer={onAnswer} />}
      {turn.failure === null ? null : <FailureBox view={failureView(turn.failure)} prepared={{ proposals: turn.proposals.length, priorities: turn.priorities.length, mayHave: turn.presentation?.effectsMayHaveOccurred ?? null }} busy={busy} onRetry={onRetry} switchTo={switchTo} onSwitch={onSwitch} onSetUpModel={onSetUpModel} creditsUrl={creditsUrl} onNewConversation={onNewConversation} onSetUpOther={onSetUpOther} onOpenHistory={onOpenHistory} token={token} />}
      {streaming ? null : <AgentWorking view={work} motionPaused={motionPaused} />}
      {streaming ? null : <TurnUsage accounting={turn.accounting} />}
    </div>
  );
}

// Every button here starts or changes a request, so none works while a reply is running; Add credits and the setup leave the request alone.
function FailureBox({ view, prepared, busy, onRetry, switchTo, onSwitch, onSetUpModel, creditsUrl, onNewConversation, onSetUpOther, onOpenHistory, token }: {
  view: FailureView; prepared: Prepared; busy: boolean; onRetry: () => void; switchTo: readonly { id: string; name: string }[];
  onSwitch: ((id: string) => void) | undefined; onSetUpModel: (() => void) | undefined; creditsUrl: string | undefined; onNewConversation: (() => void) | undefined;
  onSetUpOther: (() => void) | undefined; onOpenHistory: (() => void) | undefined; token: string | undefined;
}) {
  const offers = (action: FailureAction) => view.actions.includes(action);
  const credits = offers("credits") && creditsUrl !== undefined;
  const switches = offers("switch") && onSwitch !== undefined && switchTo.length > 0;
  const words = preparedWords(prepared, offers("retry"));
  // A view with its own Ask again already says to check before asking again; only work it can count is added to that.
  const note = view.retryLabel !== undefined && prepared.proposals + prepared.priorities === 0 ? null : words.note;
  const retryLabel = view.retryLabel ?? words.retryLabel;
  return (
    <div className="chat-problem chat-problem-inline" role="alert">
      <CircleAlert size={18} aria-hidden="true" />
      <div className="chat-problem-body">
        <strong>{view.title}</strong>
        <p>
          {view.message}{note === null ? "" : ` ${note}`}
        </p>
        <div className="chat-problem-actions">
          {credits ? (
            <a className="button button-primary" href={creditsUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={14} aria-hidden="true" />
              Add credits
            </a>
          ) : null}
          {offers("set_up_model") && onSetUpModel !== undefined ? (
            <button type="button" className={credits ? "button" : "button button-primary"} onClick={onSetUpModel}>
              <KeyRound size={14} aria-hidden="true" />
              {view.setUpLabel}
            </button>
          ) : null}
          {offers("open_history") && onOpenHistory !== undefined ? (
            <button type="button" className="button button-primary" onClick={onOpenHistory}>
              <History size={14} aria-hidden="true" />
              Open history
            </button>
          ) : null}
          {switches
            ? switchTo.map((other) => (
                <button key={other.id} type="button" className="button" disabled={busy} onClick={() => onSwitch(other.id)}>
                  <ArrowRightLeft size={14} aria-hidden="true" />
                  Switch to {other.name}
                </button>
              ))
            : null}
          {offers("set_up_other") && !switches && onSetUpOther !== undefined ? (
            <button type="button" className="button button-primary" onClick={onSetUpOther}>
              <KeyRound size={14} aria-hidden="true" />
              {view.setUpLabel}
            </button>
          ) : null}
          {offers("new_conversation") && onNewConversation !== undefined ? (
            <button type="button" className={offers("retry") ? "button" : "button button-primary"} disabled={busy} onClick={onNewConversation}>
              <MessageSquarePlus size={14} aria-hidden="true" />
              Start a new conversation
            </button>
          ) : null}
          {offers("retry") ? (
            <button type="button" className="button" disabled={busy} onClick={onRetry}>
              <RefreshCw size={14} aria-hidden="true" />
              {retryLabel}
            </button>
          ) : null}
          {offers("restart") && token !== undefined ? <RestartKeyloom token={token} primary={!offers("retry")} /> : null}
        </div>
      </div>
    </div>
  );
}
