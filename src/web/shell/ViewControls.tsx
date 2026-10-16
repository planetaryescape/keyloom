import { Eye, History, Library, Spline } from "lucide-react";
import type { ReactNode } from "react";

interface Toggle {
  on: boolean;
  onToggle: () => void;
}

// The tools BK reaches for often, one click away beside the layer strip (D-311): Combos and Inspect draw on the board, History and
// Library open their sheets. Quiet until used; the label goes where the stage is narrow and the tooltip carries it.
export function ViewControls({ combos, inspect, history, library }: { combos: Toggle; inspect: Toggle; history: Toggle; library: Toggle }) {
  return (
    <div className="view-controls" role="toolbar" aria-label="View">
      <Control icon={<Spline size={15} aria-hidden="true" />} label="Combos" hint="⌥C" detail="Draw the combos on the board" toggle={combos} />
      <Control icon={<Eye size={15} aria-hidden="true" />} label="Inspect" hint="⌥I" detail="Show what each key is and what transparent keys pass through to" toggle={inspect} />
      <Control icon={<History size={15} aria-hidden="true" />} label="History" hint="⌥H" detail="Every change to this layout" toggle={history} />
      <Control icon={<Library size={15} aria-hidden="true" />} label="Library" hint="⌥L" detail="Macros, tap dances and timings your keys share" toggle={library} />
    </div>
  );
}

function Control({ icon, label, hint, detail, toggle }: { icon: ReactNode; label: string; hint: string; detail: string; toggle: Toggle }) {
  return (
    <button type="button" className="view-control" aria-pressed={toggle.on} aria-label={label} title={`${detail} (${hint})`} onClick={toggle.onToggle}>
      {icon}
      <span className="view-control-label">{label}</span>
    </button>
  );
}
