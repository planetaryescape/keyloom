import { LoaderCircle, X, Zap } from "lucide-react";
import type { ProposalCard as Proposal } from "../../api/http.ts";
import type { BoardDefinition } from "../../boards/schema.ts";
import type { Layout } from "../../layout/schema.ts";
import { ProposalCard } from "../chat/ProposalCard.tsx";
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
  return (
    <section className="nb-panel" aria-label="Proposals">
      <header className="nb-panel-head nb-panel-head-row">
        <div>
          <p className="nb-eyebrow nb-eyebrow-quiet">{configName}</p>
          <h2>{open.length === 2 ? "Two ways to put it on" : open.length === 1 ? "A proposal waiting" : "Proposals"}</h2>
          <p className="nb-lead">Proposals, checked like any change. Pin one to see it on the board; apply one and its sibling is set aside.</p>
        </div>
        <button type="button" className="sheet-close" aria-label="Close the proposals" onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </header>
      <div className="nb-panel-body nb-proposals">
        {proposals === null ? <p className="nb-note"><LoaderCircle size={13} className="spin" aria-hidden="true" /> Loading…</p> : open.length === 0 ? (
          <p className="nb-note">Nothing is waiting. Applied and set-aside proposals are in History.</p>
        ) : (
          open.map((p, i) => (
            <div key={p.changeSetId} className="nb-proposal">
              {/* Pinning is a visible button, not a hover: the card's own Not this unpins. */}
              <button type="button" className="sheet-action nb-pin" aria-pressed={pinnedId === p.changeSetId} onClick={() => onPin(p)}>
                {pinnedId === p.changeSetId ? "On the board" : "Show it on the board"}
              </button>
              <ProposalCard
                proposal={p}
                {...(open.length > 1 ? { option: { number: i + 1, of: open.length } } : {})}
                layout={layout}
                board={board}
                pinned={pinnedId === p.changeSetId}
                onPreview={onPreview}
                onPin={onPin}
                onApply={onApply}
                onAskAgain={onClose}
                onOpenRelease={onOpenRelease}
              />
            </div>
          ))
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
