import { X } from "lucide-react";
import type { ReactNode } from "react";
import "./sheet.css";

// The sheets that open from the menu (History, Library, Combos, Settings) share one shape (23#how-the-whole-fits-together, P4): a
// title, a line saying what it is for, and a close. No icon badge, no rule under it; the rows carry the weight.
export function SheetHead({ title, lead, closeLabel, onClose, children }: { title: string; lead?: ReactNode; closeLabel: string; onClose: () => void; children?: ReactNode }) {
  return (
    <header className="sheet-head">
      <div className="sheet-title">
        <h2>{title}</h2>
        {lead === undefined ? null : <p>{lead}</p>}
      </div>
      {children}
      <button type="button" className="sheet-close" aria-label={closeLabel} title={`${closeLabel} (Esc)`} onClick={onClose}>
        <X size={16} aria-hidden="true" />
      </button>
    </header>
  );
}

/** A key as a small cap: its printed legend, so a list reads the way the board does. */
export function MiniCap({ children, layer }: { children: ReactNode; layer?: string | undefined }) {
  return (
    <span className="mini-cap-wrap">
      <kbd className="mini-cap">{children}</kbd>
      {layer === undefined ? null : <span className="mini-cap-layer">{layer}</span>}
    </span>
  );
}
