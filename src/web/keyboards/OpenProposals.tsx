import { LoaderCircle, X, Zap } from "lucide-react";
import { useEffect } from "react";
import type { ProposalCard as Proposal } from "../../api/http.ts";
import type { BoardDefinition } from "../../boards/schema.ts";
import type { Layout } from "../../layout/schema.ts";
import { ProposalCard } from "../chat/ProposalCard.tsx";
import { ProposalTabs } from "../chat/ProposalTabs.tsx";
import "./keyboards.css";

// A config's open proposals that no conversation shows (n5, D-336): the ones "Put my config on it" made, and any other made outside the
// chat. The same card as the chat's, so pinning previews it on the board and Apply is the ordinary apply; applying one retires its sibling.
export function OpenProposals({ proposals, layout, board, configName, firstFlash, pinnedId, onPin, onPreview, onApply, onClose, onOpenRelease }: {
  proposals: readonly Proposal[] | null;
  layout: Layout;
  board: BoardDefinition;
  configName: string;
  /** Said when the board has never had keyloom's firmware: the first flash is by hand. */
  firstFlash: boolean;
  pinnedId: string | null;
  onPin: (proposal: Proposal) => void;
  onPreview: (proposal: Proposal | null) => void;
  onApply: (proposal: Proposal) => Promise<void>;
  onClose: () => void;
  onOpenRelease: () => void;
}) {
  const open = proposals?.filter((p) => p.status === "proposed") ?? [];
  // One card at a time, the pinned option or the first, and the board shows it: a lone proposal needs no tabs and no "show it" button.
  const shown = open.find((p) => p.changeSetId === pinnedId) ?? open[0];
  useEffect(() => {
    if (shown !== undefined && pinnedId !== shown.changeSetId && !open.some((p) => p.changeSetId === pinnedId)) onPin(shown);
    // Pin once per set of proposals, not on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown?.changeSetId]);
  return (
    <section className="nb-panel" aria-label="Proposals">
      <header className="nb-panel-head nb-panel-head-row">
        <div>
          <p className="nb-eyebrow nb-eyebrow-quiet">{configName}</p>
          <h2>{open.length === 2 ? "Two ways to put it on" : open.length === 1 ? "A proposal waiting" : "Proposals"}</h2>
        </div>
        <button type="button" className="sheet-close" aria-label="Close the proposals" onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </header>
      <div className="nb-panel-body nb-proposals">
        {proposals === null ? <p className="nb-note"><LoaderCircle size={13} className="spin" aria-hidden="true" /> Loading…</p> : shown === undefined ? (
          <p className="nb-note">Nothing is waiting. Applied and set-aside proposals are in History.</p>
        ) : (
          <div className="nb-proposal">
            {/* Outside the keyed card, so switching options keeps the tab row, and the focus on it, mounted. */}
            <ProposalTabs group={open} shownId={shown.changeSetId} pinnedId={pinnedId} onPin={onPin} />
            <ProposalCard
              // Each option is its own card: it reads its rows once, against the layout it was made for.
              key={shown.changeSetId}
              proposal={shown}
              layout={layout}
              board={board}
              pinned={pinnedId === shown.changeSetId}
              onPreview={onPreview}
              onPin={onPin}
              onApply={onApply}
              onAskAgain={onClose}
              onOpenRelease={onOpenRelease}
              compact
            />
          </div>
        )}
        {firstFlash ? (
          <div className="nb-flash">
            <Zap size={14} aria-hidden="true" />
            <p><b>Then the first flash.</b> Apply puts it in the config; nothing goes to the keyboard until you Build and flash, by hand the first time.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
