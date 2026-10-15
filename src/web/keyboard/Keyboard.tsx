import { useImperativeHandle, useMemo, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type Ref } from "react";
import type { GeometryKey } from "../../boards/schema.ts";
import type { KeyDescription } from "../../layout/describe.ts";
import { Cap } from "./Cap.tsx";
import { MoveArrows } from "./MoveArrows.tsx";
import { boardBounds, growBounds, handTrays, keyRect, type Bounds, type KeyRect } from "./geometry.ts";
import { neighbour, type Direction } from "./navigate.ts";
import { useFitUnit } from "./useFitUnit.ts";
import "./keyboard.css";

// Space between neighbouring caps, and the margin around the board, in key units.
export const GAP = 0.09;
export const MARGIN = 0.3;
const ARROWS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

export interface KeyboardHandle {
  focusKey: (index: number) => void;
  /** Scrolls a key into view in the stage, leaving room for the bottom sheet (18#phones). */
  scrollKeyIntoView: (index: number) => void;
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
  /** A click or Enter on a key. Whether it opens the key's panel or adds it to the chat is the caller's rule (D-099). */
  onPress: (index: number, via: "pointer" | "keyboard") => void;
  /** The key whose panel is open, drawn with an outline; `selected` still decides the one tab stop. */
  current?: number | null;
  /** Replaces a key's legend, for the Advanced view's firmware names. */
  legendOverrides?: readonly ({ tap: string; hold?: string } | undefined)[] | undefined;
  /** For a layer key, which of the six layer colours its edge takes. */
  layerColors?: ReadonlyMap<number, number>;
  /** The key whose draft is not applied yet, drawn with a pending mark. */
  pendingIndex?: number | null;
  /** The key just changed by an apply, which pulses once. */
  appliedIndex?: number | null;
  /** Keys in the chat's "Asking about" chips. */
  chatSelected?: ReadonlySet<number>;
  /** Keys a hovered proposal changes, and where a displaced function lands. */
  marks?: ReadonlyMap<number, "changed" | "home">;
  /** Keys where keyloom remembers a reason: an earlier decision a previewed change would override, or one being pointed at. */
  remembered?: ReadonlySet<number>;
  /** Arrows from a displaced function's old key to its new home, for the hovered proposal. */
  arrows?: ReadonlyArray<{ from: number; to: number }>;
  handle?: Ref<KeyboardHandle>;
  /** On a phone a split board shows one hand at a time; null or absent shows the whole board. */
  half?: "left" | "right" | null;
  /** A horizontal swipe on the board, for the phone's half switcher. */
  onSwipe?: (direction: "left" | "right") => void;
}

function ariaLabel(index: number, description: KeyDescription, finger: string | undefined, pending: boolean, mark: "changed" | "home" | undefined, remembered = false): string {
  // The headline carries the meaning in words; the printed legend can be a symbol a screen
  // reader says badly.
  const parts = [`Key ${index + 1}`, description.headline];
  if (finger !== undefined) parts.push(`${finger.replace("-", " ")} finger`);
  const combos = description.combos.filter((combo) => combo.activeHere).map((combo) => combo.name);
  if (combos.length > 0) parts.push(`In ${combos.join(", ")}`);
  if (pending) parts.push("Draft change, not applied yet");
  if (mark === "changed") parts.push("Proposed change, not applied yet");
  if (mark === "home") parts.push("Where a moved function would go");
  if (remembered) parts.push("keyloom remembers why this key is set up this way");
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
  onPress,
  current = null,
  legendOverrides,
  layerColors,
  pendingIndex = null,
  appliedIndex = null,
  chatSelected,
  marks,
  remembered,
  arrows = [],
  handle,
  half = null,
  onSwipe,
}: KeyboardProps) {
  // One hand's keys, when only one is shown. The canvas, the trays, the caps and the arrow keys all follow it.
  const visible = useMemo(() => (half === null ? null : new Set(hands[half])), [half, hands]);
  const shownKeys = useMemo(() => (visible === null ? keys : keys.filter((_, index) => visible.has(index))), [keys, visible]);
  const bounds = boardBounds(shownKeys);
  const canvas: Bounds = {
    minX: bounds.minX - MARGIN,
    minY: bounds.minY - MARGIN,
    width: bounds.width + 2 * MARGIN,
    height: bounds.height + 2 * MARGIN,
  };
  const { ref, unit, overflowing } = useFitUnit({ width: canvas.width, height: canvas.height });
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  useImperativeHandle(
    handle,
    () => ({
      focusKey: (index) => buttons.current[index]?.focus(),
      scrollKeyIntoView: (index) => buttons.current[index]?.scrollIntoView({ block: "nearest", inline: "nearest" }),
    }),
    [],
  );

  // One tab stop for the whole board; arrow keys move within it. A key on the hand that isn't showing can't be the stop.
  const tabStop = selected !== null && (visible === null || visible.has(selected)) ? selected : (visible === null ? 0 : (hands[half ?? "left"][0] ?? 0));

  // A swipe is a mostly sideways drag of a finger. Mouse drags are left to text selection and the caps' clicks.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swipeStart = (event: PointerEvent) => {
    swipe.current = event.pointerType === "touch" ? { x: event.clientX, y: event.clientY } : null;
  };
  const swipeEnd = (event: PointerEvent) => {
    const from = swipe.current;
    swipe.current = null;
    if (from === null || onSwipe === undefined) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > 2 * Math.abs(dy)) onSwipe(dx < 0 ? "left" : "right");
  };

  function onKeyDown(event: KeyboardEvent<HTMLElement>, index: number) {
    if (event.key === "Enter") {
      // Stops the button's own click, so Enter presses the key once.
      event.preventDefault();
      onPress(index, "keyboard");
      return;
    }
    const direction = ARROWS[event.key];
    if (direction === undefined) return;
    event.preventDefault();
    const next = neighbour(keys, index, direction, visible);
    if (next !== null) buttons.current[next]?.focus();
  }

  return (
    <div ref={ref} className="keyboard-well" data-overflowing={overflowing} data-half={half ?? undefined} onPointerDown={swipeStart} onPointerUp={swipeEnd} onPointerCancel={() => { swipe.current = null; }}>
      <div
        className="keyboard"
        role="group"
        aria-label={`Keyboard, ${layerName}. Arrow keys move between keys.`}
        style={{ width: canvas.width * unit, height: canvas.height * unit }}
      >
        {trays(keys, hands, half).map((tray, side) => (
          <Tray key={side} tray={tray} canvas={canvas} unit={unit} />
        ))}
        {keys.map((geometryKey, index) => {
          const description = descriptions[index];
          if (description === undefined || description === null) return null;
          if (visible !== null && !visible.has(index)) return null;
          const rect = keyRect(geometryKey, canvas);
          return (
            <Cap
              key={index}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              tone={description.kind}
              legend={legendOverrides?.[index] ?? description.legend}
              breakable={legendOverrides?.[index] !== undefined}
              layerColor={layerColors?.get(index) ?? 1}
              pending={pendingIndex === index || marks?.get(index) === "changed"}
              remembered={remembered?.has(index) ?? false}
              title={description.headline}
              unit={unit}
              width={geometryKey.w}
              combo={comboKeys.has(index)}
              // The Moonlander's thumbs tilt a little and read fine; the Glove80's fan out to 60 degrees.
              {...(Math.abs(rect.rotate) > UPRIGHT_ABOVE_DEG ? { legendTurn: -rect.rotate } : {})}
              style={keyStyle(rect, unit)}
              tabIndex={index === tabStop ? 0 : -1}
              aria-label={ariaLabel(index, description, fingers[String(index)], pendingIndex === index, marks?.get(index), remembered?.has(index))}
              // Pressed means "in the chat's Asking about chips"; `data-current` is the key whose panel is open.
              aria-pressed={chatSelected?.has(index) ?? false}
              data-current={current === index}
              data-partner={partners.has(index)}
              data-pending={pendingIndex === index || marks?.get(index) === "changed"}
              data-home={marks?.get(index) === "home"}
              data-applied={appliedIndex === index}
              onFocus={() => onSelect(index)}
              onClick={() => {
                // Safari doesn't focus a button on click, so the click selects as well as the focus.
                onSelect(index);
                onPress(index, "pointer");
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

// Trays behind each hand: the bounding box of its rotated keys, a little larger, kept apart where the halves nearly meet.
function trays(keys: readonly GeometryKey[], hands: { left: readonly number[]; right: readonly number[] }, half: "left" | "right" | null): Bounds[] {
  const pad = MARGIN * 0.6;
  if (half !== null) return [growBounds(boardBounds(hands[half].flatMap((p) => keys[p] ?? [])), pad)];
  const [left, right] = [hands.left, hands.right].map((ps) => ps.flatMap((p) => keys[p] ?? []));
  if (!left?.length || !right?.length) return [left, right].flatMap((k) => (k?.length ? [growBounds(boardBounds(k), pad)] : []));
  return handTrays(boardBounds(left), boardBounds(right), pad, GAP * 2);
}

function Tray({ tray, canvas, unit }: { tray: Bounds; canvas: Bounds; unit: number }) {
  const style: CSSProperties = {
    left: (tray.minX - canvas.minX) * unit,
    top: (tray.minY - canvas.minY) * unit,
    width: tray.width * unit,
    height: tray.height * unit,
    borderRadius: unit * 0.5,
  };
  return <div className="keyboard-half" aria-hidden="true" style={style} />;
}

const UPRIGHT_ABOVE_DEG = 20;
const SWIPE_PX = 48;

// The gap shrinks each box and keeps the rotation origin on the same point, because the
// origin is measured from the box's top-left.
export function keyStyle(rect: KeyRect, unit: number): CSSProperties {
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
