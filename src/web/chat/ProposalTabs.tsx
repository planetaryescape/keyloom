import type { ProposalCard } from "../../api/http.ts";
import { optionLabels } from "./proposal-facts.ts";

/** One compact row above the card when the agent sent more than one alternative; a click pins that option on the board. */
export function ProposalTabs({ group, shownId, pinnedId, onPin }: { group: readonly ProposalCard[]; shownId: string; pinnedId: string | null; onPin: (proposal: ProposalCard) => void }) {
  if (group.length < 2) return null;
  const labels = optionLabels(group.map((option) => option.title));
  return (
    <div className="proposal-tabs" role="tablist" aria-label="Options">
      {group.map((proposal, index) => (
        <button
          key={proposal.changeSetId}
          type="button"
          role="tab"
          className="proposal-tab"
          aria-selected={proposal.changeSetId === shownId}
          data-status={proposal.status}
          onClick={() => proposal.changeSetId !== pinnedId && onPin(proposal)}
        >
          <span className="proposal-tab-n">{index + 1}</span>
          <span className="proposal-tab-title" title={proposal.title}>{labels[index]}</span>
        </button>
      ))}
    </div>
  );
}
