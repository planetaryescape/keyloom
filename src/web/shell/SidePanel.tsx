import { ChevronDown, ChevronUp } from "lucide-react";
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { clampSheet, nearestSize, shorter, taller, type SheetSize } from "./sheet.ts";

export type PanelMode = "summary" | "key" | "chat" | "repeat" | "history";

interface Props {
  mode: PanelMode;
  summary: ReactNode;
  key_: ReactNode;
  chat: ReactNode;
  repeat: ReactNode;
  history: ReactNode;
  /** The sheet's height on a narrow screen, and the window's height it is measured against. */
  size: SheetSize;
  viewportHeight: number;
  onSize: (size: SheetSize) => void;
}

const NAMES: Record<SheetSize, string> = { peek: "peeking", half: "half height", full: "full height" };

// One thing at a time (18#the-board-stays-in-view). The column keeps its width in every mode, so
// opening a panel never changes the stage beside it. The chat stays mounted while hidden, so a
// reply that is streaming or a draft that was typed survives a look at a key. On a narrow screen the
// same panel is a bottom sheet: the grabber and the two buttons in its bar (hidden on a wide screen) set its height.
export function SidePanel({ mode, summary, key_, chat, repeat, history, size, viewportHeight, onSize }: Props) {
  const drag = useRef<{ startY: number; startHeight: number; pointer: number } | null>(null);
  const side = useRef<HTMLElement>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);

  function start(event: PointerEvent<HTMLDivElement>) {
    if (side.current === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startHeight: side.current.getBoundingClientRect().height, pointer: event.pointerId };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d === null || d.pointer !== event.pointerId) return;
    setDragHeight(clampSheet(d.startHeight + (d.startY - event.clientY), viewportHeight));
  }
  function end(event: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d === null || d.pointer !== event.pointerId) return;
    drag.current = null;
    const height = clampSheet(d.startHeight + (d.startY - event.clientY), viewportHeight);
    setDragHeight(null);
    // A tap on the grabber, with no drag, steps to the next height and wraps from full to half.
    if (Math.abs(event.clientY - d.startY) < 4) onSize(size === "full" ? "half" : taller(size));
    else onSize(nearestSize(height, viewportHeight));
  }
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    const next = event.key === "ArrowUp" ? taller(size) : event.key === "ArrowDown" ? shorter(size) : event.key === "Home" ? "full" : event.key === "End" ? "peek" : null;
    if (next === null) return;
    event.preventDefault();
    onSize(next);
  }

  const style = dragHeight === null ? undefined : ({ "--sheet-h": `${dragHeight}px` } as CSSProperties);
  return (
    <aside ref={side} className="side" data-mode={mode} data-size={size} data-dragging={dragHeight !== null} aria-label="Side panel" style={style}>
      <div className="sheet-bar">
        <div
          className="sheet-grabber"
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Resize the panel, now ${NAMES[size]}. Drag, or use the arrow keys.`}
          aria-valuemin={0}
          aria-valuemax={2}
          aria-valuenow={["peek", "half", "full"].indexOf(size)}
          aria-valuetext={NAMES[size]}
          tabIndex={0}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={() => {
            drag.current = null;
            setDragHeight(null);
          }}
          onKeyDown={onKey}
        >
          <span aria-hidden="true" />
        </div>
        <button type="button" className="icon-button" aria-label="Make the panel shorter" disabled={size === "peek"} onClick={() => onSize(shorter(size))}>
          <ChevronDown size={18} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" aria-label="Make the panel taller" disabled={size === "full"} onClick={() => onSize(taller(size))}>
          <ChevronUp size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="side-pane" hidden={mode !== "summary"}>{summary}</div>
      <div className="side-pane" hidden={mode !== "key"}>{key_}</div>
      <div id="side-chat" className="side-pane" hidden={mode !== "chat"}>{chat}</div>
      <div className="side-pane" hidden={mode !== "repeat"}>{repeat}</div>
      <div className="side-pane" hidden={mode !== "history"}>{history}</div>
    </aside>
  );
}
