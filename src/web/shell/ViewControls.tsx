import { Eye, History, Library, Spline } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

// The least space kept between the strip's last layer and the first control.
const GAP_PX = 16;

interface Toggle {
  on: boolean;
  onToggle: () => void;
}

// The tools BK reaches for often, one click away beside the layer strip (D-311): Combos and Inspect draw on the board, History and
// Library open their sheets. Quiet until used; the label goes where the stage is narrow and the tooltip carries it.
export function ViewControls({ combos, inspect, history, library }: { combos: Toggle; inspect: Toggle; history: Toggle; library: Toggle }) {
  const root = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  // Labels when they fit beside the strip, icons when they would meet it: measured against the strip's own right edge, since a board
  // with many or long layer names (the Glove80's "Factory test layer") makes the strip wider than the stage's width says (P4 review).
  const labelled = useRef(0);
  useLayoutEffect(() => {
    const element = root.current;
    const floor = element?.parentElement;
    if (element === null || floor === null || floor === undefined) return;
    const measure = () => {
      const strip = floor.querySelector<HTMLElement>(".layer-tabs");
      if (strip === null) return;
      const box = element.getBoundingClientRect();
      if (element.dataset.compact !== "true") labelled.current = box.width;
      const stripRight = Math.min(strip.getBoundingClientRect().right, strip.getBoundingClientRect().left + strip.scrollWidth);
      const labelledLeft = box.right - labelled.current;
      setCompact(labelledLeft < stripRight + GAP_PX);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(floor);
    const strip = floor.querySelector(".layer-tabs");
    if (strip !== null) observer.observe(strip);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={root} className="view-controls" role="toolbar" aria-label="View" data-compact={compact}>
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
