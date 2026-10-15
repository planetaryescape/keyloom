import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import type { ProposalCard as Proposal } from "../../api/http.ts";
import type { BoardDefinition } from "../../boards/schema.ts";
import type { Layout } from "../../layout/schema.ts";
import { groupProposals } from "./compare.ts";
import { Markdown } from "./Markdown.tsx";
import { PriorityChips } from "./PriorityChips.tsx";
import { ProposalCompare } from "./ProposalCompare.tsx";
import { ProposalCard } from "./ProposalCard.tsx";
import { keyLabel, layerName } from "./proposal-facts.ts";
import type { AssistantTurn, UserTurn } from "./transcript.ts";

export function UserMessage({ turn, layout }: { turn: UserTurn; layout: Layout }) {
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
    </div>
  );
}

const ENDINGS: Record<string, string> = {
  refused: "The model declined to answer that. Rephrase it and try again.",
  truncated: "The reply was cut off. Ask keyloom to continue.",
  context_full: "This conversation has grown too long for the model to continue. Start a new one.",
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
  onAskAgain: () => void;
  onOpenRelease: () => void;
  onRetry: () => void;
}

export function AssistantMessage({ turn, layout, board, pinnedId, onPreview, onPin, onApply, onRemovePriority, onAskAgain, onOpenRelease, onRetry }: Props) {
  const streaming = turn.phase === "streaming";
  const ending = turn.ending === null ? undefined : ENDINGS[turn.ending];
  const offers = turn.proposals.length;
  return (
    <div className="msg msg-assistant" data-phase={turn.phase}>
      <p className="msg-who">keyloom</p>
      <PriorityChips priorities={turn.priorities} layout={layout} onRemove={onRemovePriority} />
      {/* Hidden from the live region until the reply is whole, so a screen reader hears it once, not token by token. */}
      <div aria-hidden={streaming || undefined}>
        {turn.text === "" ? null : <Markdown source={turn.text} />}
        {turn.phase === "done" && offers > 0 ? <p className="sr-only">keyloom offered {offers} {offers === 1 ? "option" : "options"}.</p> : null}
      </div>
      {streaming ? (
        <p className="msg-activity" aria-hidden="true">
          <LoaderCircle size={14} className="spin" />
          {turn.activity ?? (turn.text === "" ? "Thinking…" : "Writing…")}
        </p>
      ) : null}
      {turn.phase === "stopped" ? <p className="msg-note">Stopped. What came through is above.</p> : null}
      {ending === undefined || turn.phase !== "done" ? null : <p className="msg-note">{ending}</p>}
      {groupProposals(turn.proposals).map((group) => (
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
            <strong>The reply stopped</strong>
            <p>{turn.failure.message}</p>
            <div className="chat-problem-actions">
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
