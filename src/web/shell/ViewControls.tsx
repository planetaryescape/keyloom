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
  // Above the strip instead of beside it, when even the icons would leave the strip too little room to show every layer's name whole.
  const [stack, setStack] = useState(false);
  // Labels when they fit beside the strip, icons when the strip needs the room (P4 review, D-389). Measured against the strip with its
  // add and menu buttons, since a board with many or long layer names (the Glove80's "Factory test layer") makes it wider than the
  // stage's width says, and those buttons were once left out and covered.
  const labelled = useRef(0);
  const iconsOnly = useRef(0);
  useLayoutEffect(() => {
    const element = root.current;
    const row = element?.parentElement;
    const floor = element?.closest<HTMLElement>(".stage-floor");
    if (element === null || element === undefined || row === null || row === undefined || floor === null || floor === undefined) return;
    const measure = () => {
      const wrap = floor.querySelector<HTMLElement>(".layer-tabs-wrap");
      const strip = wrap?.querySelector<HTMLElement>(".layer-tabs");
      if (wrap === null || wrap === undefined || strip === null || strip === undefined) return;
      const box = element.getBoundingClientRect();
      if (element.dataset.compact !== "true") labelled.current = box.width;
      else iconsOnly.current = box.width;
      const natural = naturalWidth(wrap, strip);
      const beside = getComputedStyle(row).display === "grid" && natural + (iconsOnly.current || CONTROLS * ICON_PX) + 2 * GAP_PX <= row.clientWidth;
      setStack(getComputedStyle(row).display === "grid" && !beside);
      if (beside) {
        // Beside the strip in one row: labels only while the strip, at its full width, stays centred with the labelled controls clear of it.
        setCompact(natural + 2 * (labelled.current + GAP_PX) > row.clientWidth);
      } else {
        // Above the strip on a narrower stage: icons when the labels would reach over the strip's right end.
        setCompact(box.right - labelled.current < wrap.getBoundingClientRect().right + GAP_PX);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(floor);
    const strip = floor.querySelector(".layer-tabs");
    if (strip !== null) observer.observe(strip);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={root} className="view-controls" role="toolbar" aria-label="View" data-compact={compact} data-stack={stack}>
      <Control icon={<Spline size={15} aria-hidden="true" />} label="Combos" hint="⌥C" detail="Draw the combos on the board" toggle={combos} />
      <Control icon={<Eye size={15} aria-hidden="true" />} label="Inspect" hint="⌥I" detail="Show what each key is and what transparent keys pass through to" toggle={inspect} />
      <Control icon={<History size={15} aria-hidden="true" />} label="History" hint="⌥H" detail="Every change to this layout" toggle={history} />
      <Control icon={<Library size={15} aria-hidden="true" />} label="Library" hint="⌥L" detail="Macros, tap dances and timings your keys share" toggle={library} />
    </div>
  );
}

// How many controls there are, and a control's width as an icon, for the first measure before the icons have been drawn.
const CONTROLS = 4;
const ICON_PX = 32;

// The strip's width with nothing shortened: its box, plus what its tabs' names and its own scroll hide. A tab never grows past its
// content, so this is the same wherever the strip sits, and beside-or-above can't flip back and forth.
function naturalWidth(wrap: HTMLElement, strip: HTMLElement): number {
  let hidden = Math.max(0, strip.scrollWidth - strip.clientWidth);
  for (const text of strip.querySelectorAll<HTMLElement>(".layer-tab-text")) hidden += Math.max(0, text.scrollWidth - text.clientWidth);
  return wrap.getBoundingClientRect().width + hidden;
}

function Control({ icon, label, hint, detail, toggle }: { icon: ReactNode; label: string; hint: string; detail: string; toggle: Toggle }) {
  return (
    <button type="button" className="view-control" aria-pressed={toggle.on} aria-label={label} title={`${detail} (${hint})`} onClick={toggle.onToggle}>
      {icon}
      <span className="view-control-label">{label}</span>
    </button>
  );
}
