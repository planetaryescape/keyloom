import { ArrowRightLeft, CircleAlert, RefreshCw } from "lucide-react";
import type { ProposalCard as Proposal } from "../../api/http.ts";
import type { BoardDefinition } from "../../boards/schema.ts";
import type { Layout } from "../../layout/schema.ts";
import { groupProposals } from "./compare.ts";
import { Markdown } from "./Markdown.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { PriorityChips } from "./PriorityChips.tsx";
import { ProposalCompare } from "./ProposalCompare.tsx";
import { ProposalCard } from "./ProposalCard.tsx";
import { keyLabel, layerName, optionLabels } from "./proposal-facts.ts";
import type { AssistantTurn, UserTurn } from "./transcript.ts";
import { AgentWorking } from "./AgentWorking.tsx";
import type { AgentWorkStatus, AgentWorkView } from "./work-view.ts";
import { presentationView } from "./presentation-view.ts";

export function UserMessage({ turn, layout, context }: { turn: UserTurn; layout: Layout; context?: string }) {
  const { selection } = turn;
  return (
    <div className="msg msg-user">
      <p className="msg-who">You</p>
      <div className="msg-bubble">
        <p>{turn.text}</p>
        {selection === null ? null : (
          <p className="msg-selection">
            Selected on {layerName(layout, selection.layerId)}:{" "}
            {selection.positions.map((position) => keyLabel(layout, { layerId: selection.layerId, position })).join(", ")}
          </p>
        )}
      </div>
      {context === undefined ? null : <p className="msg-context">{context}</p>}
    </div>
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
}

export function AssistantMessage({ turn, layout, board, pinnedId, onPreview, onPin, onApply, onRemovePriority, onAskAgain, onOpenRelease, onRetry, onAnswer, busy = false, switchTo = [], onSwitch, compact = false, working, motionPaused = false }: Props) {
  const streaming = turn.phase === "streaming";
  const ending = turn.ending === null ? undefined : ENDINGS[turn.ending];
  const offers = turn.proposals.length;
  const status: AgentWorkStatus = turn.question?.answer === null ? "waiting" : turn.phase === "streaming" ? "running" : turn.phase === "failed" ? "failed" : turn.phase === "stopped" ? "stopped" : "completed";
  // Existing turns have no correlated lifecycle. Never infer completed calls from their old tool-name hint.
  let work: AgentWorkView = working ?? (turn.presentation === undefined ? { kind: "unavailable", status } : presentationView(turn.presentation));
  if (turn.question?.answer === null) work = { ...work, status: "waiting" };
  else if (turn.phase === "stopped") work = { ...work, status: "stopped" };
  else if (turn.failure !== null && work.status !== "disconnected") work = { ...work, status: "failed" };
  return (
    <div className="msg msg-assistant" data-phase={turn.phase}>
      <p className="msg-who">keyloom</p>
      <PriorityChips priorities={turn.priorities} layout={layout} onRemove={onRemovePriority} />
      {/* Hidden from the live region until the reply is whole, so a screen reader hears it once, not token by token. */}
      <div aria-hidden={streaming || undefined}>
        {turn.text === "" ? null : <Markdown source={turn.text} />}
        {turn.phase === "done" && offers > 0 ? <p className="sr-only">keyloom offered {offers} {offers === 1 ? "option" : "options"}.</p> : null}
      </div>
      <AgentWorking view={work} motionPaused={motionPaused} />
      {turn.question === null ? null : <QuestionCard question={turn.question} disabled={busy} onAnswer={onAnswer} />}
      {turn.phase === "stopped" ? <p className="msg-note">Stopped. Configs or proposals prepared before Stop may remain.</p> : null}
      {ending === undefined || turn.phase !== "done" ? null : <p className="msg-note">{ending}</p>}
      {compact
        ? groupProposals(turn.proposals).map((group) => {
            const shown = group.find((proposal) => proposal.changeSetId === pinnedId) ?? group.find((proposal) => proposal.status === "applied") ?? group[0];
            if (shown === undefined) return null;
            return (
              <section className="proposal-group proposal-bar" key={group[0]?.changeSetId} aria-label={group.length > 1 ? `${group.length} options` : "Option"}>
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
                  compact
                  alternatives={
                    group.length < 2 ? null : (
                      <div className="proposal-tabs" role="tablist" aria-label="Options">
                        {group.map((proposal, index) => (
                          <button
                            key={proposal.changeSetId}
                            type="button"
                            role="tab"
                            className="proposal-tab"
                            aria-selected={proposal.changeSetId === shown.changeSetId}
                            data-status={proposal.status}
                            onClick={() => proposal.changeSetId !== pinnedId && onPin(proposal)}
                          >
                            <span className="proposal-tab-n">{index + 1}</span>
                            <span className="proposal-tab-title" title={proposal.title}>{optionLabels(group.map((option) => option.title))[index]}</span>
                          </button>
                        ))}
                      </div>
                    )
                  }
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
    </div>
  );
}
