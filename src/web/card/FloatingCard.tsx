import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { placeCard, type Box } from "./card-place.ts";

interface Props {
  /** The stage the card floats in, and the board's keys inside it. */
  stage: RefObject<HTMLElement | null>;
  /** The key the card belongs to; a combo's card belongs to its first key and keeps all of `alsoKeep` clear too. */
  position: number;
  alsoKeep?: readonly number[];
  /** Changes when the key or its layer does, so the card is placed again. */
  placeKey: string;
  /** How far the board is slid aside now, in px, and how to slide it. */
  shift: number;
  onShift: (px: number) => void;
  children: ReactNode;
}

// How far around the key the card keeps clear, in key widths: the key and the keys a finger reaches from it.
const NEIGHBOURS = 1.6;

const box = (rect: DOMRect, origin: DOMRect, dx = 0): Box => ({ x: rect.left - origin.left - dx, y: rect.top - origin.top, w: rect.width, h: rect.height });

// The key card floats beside its key (23#the-key-card), never over it or its neighbours; the board slides aside only when the card can't
// fit (P2). A spotlight dims the rest of the board, and the card springs in from the key's side.
export function FloatingCard({ stage, position, alsoKeep = [], placeKey, shift, onShift, children }: Props) {
  const card = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number; from: number; spot: { x: number; y: number } } | null>(null);
  const reduce = useReducedMotion() === true;
  const kept = useRef<{ key: string; x: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const root = stage.current;
      const element = card.current;
      const key = root?.querySelector<HTMLElement>(`.keyboard button.cap[data-key-index="${position}"]`);
      if (root === null || root === undefined || element === null || key === null || key === undefined) return;
      const origin = root.getBoundingClientRect();
      // Measured where the key would be with the board unshifted, so the decision doesn't feed on itself.
      const k = box(key.getBoundingClientRect(), origin, shift);
      const cx = k.x + k.w / 2;
      const cy = k.y + k.h / 2;
      const caps = [...root.querySelectorAll<HTMLElement>(".keyboard button.cap[data-key-index]")].map((cap) => ({ index: Number(cap.dataset.keyIndex), at: box(cap.getBoundingClientRect(), origin, shift) }));
      const near = ({ index, at: b }: { index: number; at: Box }) => alsoKeep.includes(index) || Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy) <= k.w * NEIGHBOURS;
      const placed = placeCard({ stage: { x: 0, y: 0, w: origin.width, h: origin.height }, key: k, keep: caps.filter(near).map((c) => c.at), others: caps.filter((c) => !near(c)).map((c) => c.at), card: { w: element.offsetWidth, h: element.offsetHeight }, ...(kept.current?.key === placeKey ? { prefer: kept.current.x } : {}) });
      kept.current = { key: placeKey, x: placed.x };
      setAt({ x: placed.x, y: placed.y, from: placed.x > cx ? -12 : 12, spot: { x: cx + placed.shift, y: cy } });
      if (Math.abs(placed.shift - shift) > 0.5) onShift(placed.shift);
    };
    place();
    const observer = new ResizeObserver(place);
    if (stage.current !== null) observer.observe(stage.current);
    if (card.current !== null) observer.observe(card.current);
    return () => observer.disconnect();
    // Placed again when the key, its layer or the slide changes; the observer covers size changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey, shift]);

  return (
    <>
      <div className="card-spotlight" aria-hidden="true" style={at === null ? { opacity: 0 } : ({ "--sx": `${at.spot.x}px`, "--sy": `${at.spot.y}px` } as CSSProperties)} />
      <motion.div
        ref={card}
        className="floating-card"
        style={{ left: at?.x ?? 0, top: at?.y ?? 0, visibility: at === null ? "hidden" : "visible" }}
        initial={reduce ? false : { opacity: 0, scale: 0.97, x: at?.from ?? 0 }}
        animate={{ opacity: 1, scale: 1, x: 0 }}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 34, mass: 0.8 }}
      >
        {children}
      </motion.div>
    </>
  );
}
