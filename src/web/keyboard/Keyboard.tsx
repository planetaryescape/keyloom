import { useImperativeHandle, useRef, type CSSProperties, type KeyboardEvent, type Ref } from "react";
import type { GeometryKey } from "../../boards/schema.ts";
import type { KeyDescription } from "../../layout/describe.ts";
import { Cap } from "./Cap.tsx";
import { MoveArrows } from "./MoveArrows.tsx";
import { boardBounds, keyRect, type Bounds, type KeyRect } from "./geometry.ts";
import { neighbour, type Direction } from "./navigate.ts";
import { useFitUnit } from "./useFitUnit.ts";
import "./keyboard.css";

// Space between neighbouring caps, and the margin around the board, in key units.
const GAP = 0.09;
const MARGIN = 0.3;
// Vertical room the header, tabs, inspector and page padding take (px), so the board and the
// inspector fit in one window.
const RESERVED_HEIGHT = 380;

const ARROWS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

export interface KeyboardHandle {
  focusKey: (index: number) => void;
}

interface KeyboardProps {
  /** Already has display rotation applied, so keys[i] is the i-th binding's key. */
  keys: readonly GeometryKey[];
  hands: { left: readonly number[]; right: readonly number[] };
  /** One description per key, for the current layer. */
  descriptions: readonly (KeyDescription | null)[];
  /** Finger names by key position, for accessible names. */
  fingers: Readonly<Record<string, string>>;
  layerName: string;
  selected: number | null;
  /** Keys that are chord partners of the inspected key. */
  partners: ReadonlySet<number>;
  /** Keys that belong to a combo active on this layer. */
  comboKeys: ReadonlySet<number>;
  onSelect: (index: number | null) => void;
  onHover: (index: number | null) => void;
  /** Enter or a double-click on a key: open it for editing. */
  onActivate?: (index: number) => void;
  /** The key whose draft is not applied yet, drawn with a pending mark. */
  pendingIndex?: number | null;
  /** The key just changed by an apply, which pulses once. */
  appliedIndex?: number | null;
  /** Keys clicked to be sent with the next chat message (D-012); a click toggles one. */
  chatSelected?: ReadonlySet<number>;
  onToggle?: (index: number) => void;
  /** Keys a hovered proposal changes, and where a displaced function lands. */
  marks?: ReadonlyMap<number, "changed" | "home">;
  /** Arrows from a displaced function's old key to its new home, for the hovered proposal. */
  arrows?: ReadonlyArray<{ from: number; to: number }>;
  handle?: Ref<KeyboardHandle>;
}

function ariaLabel(index: number, description: KeyDescription, finger: string | undefined, pending: boolean, mark: "changed" | "home" | undefined): string {
  // The headline carries the meaning in words; the printed legend can be a symbol a screen
  // reader says badly.
  const parts = [`Key ${index + 1}`, description.headline];
  if (finger !== undefined) parts.push(`${finger.replace("-", " ")} finger`);
  const combos = description.combos.filter((combo) => combo.activeHere).map((combo) => combo.name);
  if (combos.length > 0) parts.push(`In ${combos.join(", ")}`);
  if (pending) parts.push("Draft change, not applied yet");
  if (mark === "changed") parts.push("Proposed change, not applied yet");
  if (mark === "home") parts.push("Where a moved function would go");
  return parts.join(". ");
}

export function Keyboard({
  keys,
  hands,
  descriptions,
  fingers,
  layerName,
  selected,
  partners,
  comboKeys,
  onSelect,
  onHover,
  onActivate,
  pendingIndex = null,
  appliedIndex = null,
  chatSelected,
  onToggle,
  marks,
  arrows = [],
  handle,
}: KeyboardProps) {
  const bounds = boardBounds(keys);
  const canvas: Bounds = {
    minX: bounds.minX - MARGIN,
    minY: bounds.minY - MARGIN,
    width: bounds.width + 2 * MARGIN,
    height: bounds.height + 2 * MARGIN,
  };
  const { ref, unit, overflowing } = useFitUnit({
    width: canvas.width,
    height: canvas.height,
    reservedHeight: RESERVED_HEIGHT,
  });
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  useImperativeHandle(handle, () => ({ focusKey: (index) => buttons.current[index]?.focus() }), []);

  // One tab stop for the whole board; arrow keys move within it.
  const tabStop = selected ?? 0;

  function onKeyDown(event: KeyboardEvent<HTMLElement>, index: number) {
    if (event.key === "Escape") {
      onSelect(null);
      return;
    }
    if (event.key === "Enter" && onActivate !== undefined) {
      // Stops the button's own click, so Enter opens the editor without a second select.
      event.preventDefault();
      onActivate(index);
      return;
    }
    const direction = ARROWS[event.key];
    if (direction === undefined) return;
    event.preventDefault();
    const next = neighbour(keys, index, direction);
    if (next !== null) buttons.current[next]?.focus();
  }

  return (
    <div ref={ref} className="keyboard-well" data-overflowing={overflowing}>
      {overflowing ? <p className="scroll-hint">Scroll sideways to see the right half.</p> : null}
      <div
        className="keyboard"
        role="group"
        aria-label={`Keyboard, ${layerName}. Arrow keys move between keys.`}
        style={{ width: canvas.width * unit, height: canvas.height * unit }}
      >
        {[hands.left, hands.right].map((positions, side) => (
          <Tray key={side} keys={positions.flatMap((p) => keys[p] ?? [])} canvas={canvas} unit={unit} />
        ))}
        {keys.map((geometryKey, index) => {
          const description = descriptions[index];
          if (description === undefined || description === null) return null;
          const rect = keyRect(geometryKey, canvas);
          return (
            <Cap
              key={index}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              tone={description.kind}
              legend={description.legend}
              unit={unit}
              width={geometryKey.w}
              combo={comboKeys.has(index)}
              // The Moonlander's thumbs tilt a little and read fine; the Glove80's fan out to 60 degrees.
              {...(Math.abs(rect.rotate) > UPRIGHT_ABOVE_DEG ? { legendTurn: -rect.rotate } : {})}
              style={keyStyle(rect, unit)}
              tabIndex={index === tabStop ? 0 : -1}
              aria-label={ariaLabel(index, description, fingers[String(index)], pendingIndex === index, marks?.get(index))}
              // Pressed means "in the chat selection"; `data-current` is the key the inspector shows.
              aria-pressed={chatSelected?.has(index) ?? false}
              data-current={selected === index}
              data-partner={partners.has(index)}
              data-pending={pendingIndex === index || marks?.get(index) === "changed"}
              data-home={marks?.get(index) === "home"}
              data-applied={appliedIndex === index}
              onDoubleClick={() => onActivate?.(index)}
              onFocus={() => onSelect(index)}
              onClick={() => {
                // Safari doesn't focus a button on click, so the click selects as well as the focus.
                onSelect(index);
                onToggle?.(index);
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") onHover(index);
              }}
              onPointerLeave={() => onHover(null)}
            />
          );
        })}
        <MoveArrows keys={keys} canvas={canvas} unit={unit} arrows={arrows} />
      </div>
    </div>
  );
}

// Tray behind one hand: the bounding box of its rotated keys, a little larger.
function Tray({ keys, canvas, unit }: { keys: readonly GeometryKey[]; canvas: Bounds; unit: number }) {
  if (keys.length === 0) return null;
  const hand = boardBounds(keys);
  const pad = MARGIN * 0.6;
  const style: CSSProperties = {
    left: (hand.minX - pad - canvas.minX) * unit,
    top: (hand.minY - pad - canvas.minY) * unit,
    width: (hand.width + 2 * pad) * unit,
    height: (hand.height + 2 * pad) * unit,
    borderRadius: unit * 0.5,
  };
  return <div className="keyboard-half" aria-hidden="true" style={style} />;
}

const UPRIGHT_ABOVE_DEG = 20;

// The gap shrinks each box and keeps the rotation origin on the same point, because the
// origin is measured from the box's top-left.
function keyStyle(rect: KeyRect, unit: number): CSSProperties {
  return {
    position: "absolute",
    left: (rect.left + GAP / 2) * unit,
    top: (rect.top + GAP / 2) * unit,
    width: (rect.width - GAP) * unit,
    height: (rect.height - GAP) * unit,
    transform: rect.rotate === 0 ? undefined : `rotate(${rect.rotate}deg)`,
    transformOrigin: `${(rect.originX - GAP / 2) * unit}px ${(rect.originY - GAP / 2) * unit}px`,
  };
}
