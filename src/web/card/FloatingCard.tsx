import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { seatCard, type Box, type Seat } from "./card-seat.ts";

export interface BoardLayout {
  shift: number;
  part: Seat["part"];
  scale: number;
}

interface Props {
  /** The stage the card floats in, with the board's row and keys inside it. */
  stage: RefObject<HTMLElement | null>;
  /** The key the card belongs to. */
  position: number;
  /** Changes when the key or its layer does, so the card is seated again. */
  placeKey: string;
  /** How the board is moved now, and how to move it. */
  layout: BoardLayout;
  onLayout: (layout: BoardLayout) => void;
  children: ReactNode;
}

const px = (value: string): number => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

interface BoardMotion {
  /** The board's rendered centre, its slide and its scale, read from computed style. */
  cx: number;
  cy: number;
  tx: number;
  scale: number;
  /** Key units to px for the case's own translate, unscaled. */
  caseUnit: number;
}

// Each element's box where it would be with the board unmoved: its rendered box with the board's slide, scale and its half's parting
// taken off, all read from computed style so an animation in flight doesn't feed back into the decision.
function unmoved(element: Element, origin: DOMRect, m: BoardMotion): Box {
  const rect = element.getBoundingClientRect();
  const translate = getComputedStyle(element).translate;
  const own = translate === "none" || translate === "" ? 0 : px(translate.split(" ")[0] ?? "0") * (element instanceof SVGElement ? m.caseUnit : 1);
  const x = m.cx - m.tx + (rect.left - m.cx) / m.scale - own;
  const y = m.cy + (rect.top - m.cy) / m.scale;
  return { x: x - origin.left, y: y - origin.top, w: rect.width / m.scale, h: rect.height / m.scale };
}

// The key card floats in the stage and never covers the board (BK, P2: the halves part only when needed). A spotlight dims the board
// around the key, a thread runs from the card to the key, and the card springs in as the halves part.
export function FloatingCard({ stage, position, placeKey, layout, onLayout, children }: Props) {
  const card = useRef<HTMLDivElement>(null);
  const [seat, setSeat] = useState<{ x: number; y: number; maxH: number; from: number; key: { x: number; y: number; hw: number; hh: number } } | null>(null);
  const reduce = useReducedMotion() === true;
  const latest = useRef(layout);
  latest.current = layout;

  // The seat last chosen, so the card growing (a picker opening) keeps it instead of choosing again: a new choice moved the card and
  // the board out from under the pointer (BK, 2026-10-16).
  const chosen = useRef<{ x: number; y: number; areaH: number } | null>(null);

  useLayoutEffect(() => {
    chosen.current = null;
    // Only the card changed size: stay put, and rise just enough to keep its foot inside the stage. Its body scrolls past maxH.
    const settle = () => {
      const element = card.current;
      const seated = chosen.current;
      if (!element || !seated) return;
      const margin = 16;
      const y = Math.max(margin, Math.min(seated.y, seated.areaH - element.scrollHeight - margin));
      if (Math.abs(y - seated.y) < 1) return;
      chosen.current = { ...seated, y };
      setSeat((previous) => (previous === null ? previous : { ...previous, y }));
    };
    const place = () => {
      const root = stage.current;
      const element = card.current;
      const well = root?.querySelector<HTMLElement>(".keyboard-well");
      const board = root?.querySelector<HTMLElement>(".keyboard");
      const keyEl = root?.querySelector<HTMLElement>(`.keyboard button.cap[data-key-index="${position}"]`);
      const svg = root?.querySelector<SVGSVGElement>(".keyboard-case");
      if (!root || !element || !well || !board || !keyEl) return;
      const origin = root.getBoundingClientRect();
      const matrix = getComputedStyle(board).transform;
      const dm = matrix === "none" ? null : new DOMMatrixReadOnly(matrix);
      const br = board.getBoundingClientRect();
      const scaleNow = dm === null ? 1 : dm.a;
      const motion: BoardMotion = {
        cx: br.left + br.width / 2,
        cy: br.top + br.height / 2,
        tx: dm === null ? 0 : dm.e,
        scale: scaleNow,
        caseUnit: svg === null || svg === undefined || svg.viewBox.baseVal.width === 0 ? 1 : svg.getBoundingClientRect().width / scaleNow / svg.viewBox.baseVal.width,
      };
      const boardBox = { x: motion.cx - motion.tx - br.width / scaleNow / 2 - origin.left, y: motion.cy - br.height / scaleNow / 2 - origin.top, w: br.width / scaleNow, h: br.height / scaleNow };
      const parts = [...board.querySelectorAll("[data-hand]"), ...board.querySelectorAll(".keyboard-case path:not([data-hand]), button.cap:not([data-hand])")];
      const left: Box[] = [];
      const right: Box[] = [];
      for (const part of parts) (part.getAttribute("data-hand") === "right" ? right : left).push(unmoved(part, origin, motion));
      const key = unmoved(keyEl, origin, motion);
      const w = well.getBoundingClientRect();
      // The card may use the stage's whole height, from under the top bar to the strip: the gap between parted halves is free above
      // and below the board (P2 review). It keeps clear of the layer's title.
      const floor = root.querySelector<HTMLElement>(".stage-floor")?.getBoundingClientRect();
      const bottom = floor?.top ?? w.bottom;
      const area = { x: 0, y: 0, w: origin.width, h: bottom - origin.top };
      const title = root.querySelector<HTMLElement>(".caption")?.getBoundingClientRect();
      const avoid = title === undefined ? [] : [{ x: title.left - origin.left, y: title.top - origin.top, w: title.width, h: title.height }];
      const keyHand = keyEl.getAttribute("data-hand") as "left" | "right" | null;
      // The card's natural height, before any cap, so a short window caps it and its body scrolls.
      const natural = element.scrollHeight;
      const relative = seatCard({ area, key, keyHand, left, right, board: boardBox, avoid, card: { w: element.offsetWidth, h: natural } });
      // The board is drawn at the scale it was given, so a new scale is relative to it; the next pass, on the redrawn board, settles at 1.
      // A redrawn board's unit is whole pixels, so a scale within 3% of the one drawn is that one: it stops the pass from creeping smaller.
      const seated = { ...relative, scale: relative.scale > 0.97 ? latest.current.scale : Math.min(1, latest.current.scale * relative.scale) };
      // Where the key ends up: scaled about the board's centre, slid, and parted with its half.
      const bcx = boardBox.x + boardBox.w / 2;
      const bcy = boardBox.y + boardBox.h / 2;
      const partPx = seated.part !== null && seated.part.hand === keyHand ? seated.part.px * relative.scale : 0;
      const kx = bcx + (key.x + key.w / 2 - bcx) * relative.scale + seated.shift + partPx;
      const ky = bcy + (key.y + key.h / 2 - bcy) * relative.scale;
      setSeat({ x: seated.x, y: seated.y, maxH: area.h - 32, from: seated.x > kx ? -14 : 14, key: { x: kx, y: ky, hw: (key.w * relative.scale) / 2, hh: (key.h * relative.scale) / 2 } });
      chosen.current = { x: seated.x, y: seated.y, areaH: area.h };
      const now = latest.current;
      const samePart = (now.part?.hand ?? null) === (seated.part?.hand ?? null) && Math.abs((now.part?.px ?? 0) - (seated.part?.px ?? 0)) < 1;
      if (!samePart || Math.abs(now.shift - seated.shift) > 1 || Math.abs(now.scale - seated.scale) > 0.005) onLayout({ shift: seated.shift, part: seated.part, scale: seated.scale });
    };
    place();
    const observer = new ResizeObserver((entries) => {
      // The stage resizing (a window change) seats the card afresh; the card alone resizing only settles it.
      if (chosen.current === null || entries.some((entry) => entry.target === stage.current)) place();
      else settle();
    });
    if (stage.current !== null) observer.observe(stage.current);
    if (card.current !== null) observer.observe(card.current);
    return () => observer.disconnect();
    // Seated again when the key or its layer changes, and once more after the board is redrawn at a new scale, on its real geometry.
    // The observer covers size changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey, layout.scale]);

  // The thread runs from the card's near edge to the key.
  const cardW = card.current?.offsetWidth ?? 352;
  const thread =
    seat === null
      ? null
      : (() => {
          const fromX = seat.key.x < seat.x ? seat.x : seat.x + cardW;
          const fromY = Math.max(seat.y + 28, Math.min(seat.key.y, seat.y + 120));
          // It ends at the key's edge, not on its legend (comp b).
          const dx = seat.key.x - fromX;
          const dy = seat.key.y - fromY;
          const reach = Math.max(Math.abs(dx) / Math.max(1, seat.key.hw), Math.abs(dy) / Math.max(1, seat.key.hh), 1);
          return { x1: fromX, y1: fromY, x2: seat.key.x - dx / reach, y2: seat.key.y - dy / reach };
        })();

  return (
    <>
      <div className="card-spotlight" aria-hidden="true" style={seat === null ? { opacity: 0 } : ({ "--sx": `${seat.key.x}px`, "--sy": `${seat.key.y}px` } as CSSProperties)} />
      {thread === null ? null : (
        <svg className="card-thread" aria-hidden="true">
          <motion.line
            x1={thread.x1}
            y1={thread.y1}
            x2={thread.x2}
            y2={thread.y2}
            initial={reduce ? false : { pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={reduce ? { duration: 0 } : { duration: 0.3, delay: 0.12 }}
          />
          <circle cx={thread.x2} cy={thread.y2} r={3} />
        </svg>
      )}
      <motion.div
        ref={card}
        className="floating-card"
        style={{ left: seat?.x ?? 0, top: seat?.y ?? 0, maxHeight: seat?.maxH, visibility: seat === null ? "hidden" : "visible" }}
        initial={reduce ? false : { opacity: 0, scale: 0.97, x: seat?.from ?? 0 }}
        animate={{ opacity: 1, scale: 1, x: 0 }}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 34, mass: 0.8 }}
      >
        {children}
      </motion.div>
    </>
  );
}
