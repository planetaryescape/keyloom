import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type Ref } from "react";
import type { BoardDefinition, GeometryKey, KeycapColour } from "../../boards/schema.ts";
import type { Legend } from "../../layout/legend.ts";
import type { KeyDescription } from "../../layout/describe.ts";
import { Cap } from "./Cap.tsx";
import { ComboLines, type ComboLine } from "./ComboLines.tsx";
import { MoveArrows } from "./MoveArrows.tsx";
import { LEGEND_FLOOR_PX } from "./fit.ts";
import { useKeyDrag } from "./useKeyDrag.ts";
import { PHONE, useMediaQuery } from "../shell/useMediaQuery.ts";
import { caseBounds, caseParts } from "./case-shape.ts";
import { frontMode, WIDEST_WITH_SYMBOL, WIDEST_WORD } from "./front-words.ts";
import { measureText } from "./measure.ts";
import { boardBounds, keyCenter, keyRect, type Bounds, type KeyRect } from "./geometry.ts";
import { neighbour, type Direction } from "./navigate.ts";
import { minUnit, useFitUnit } from "./useFitUnit.ts";
import "./keyboard.css";

// Space between neighbouring caps, and the margin around the board, in key units. The margin leaves room for the case, which reaches
// past the keys, and for its shadow.
export const GAP = 0.09;
export const MARGIN = 0.6;
const CASE_MARGIN = 0.3;
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
  /** Physical keycap colours by key position, where a cap is not the usual colour (the Moonlander's red thumb keys). */
  keycaps?: Readonly<Record<string, KeycapColour>> | undefined;
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
  onPress: (index: number, via: "pointer" | "keyboard", extend?: boolean) => void;
  /** The key whose panel is open, drawn with an outline; `selected` still decides the one tab stop. */
  current?: number | null;
  /** Replaces a key's legend, for the Advanced view's firmware names. */
  legendOverrides?: readonly ({ tap: string; hold?: string } | undefined)[] | undefined;
  /** Key position -> the hex its LED shows on this layer (D-192). */
  ledColors?: ReadonlyMap<number, string> | undefined;
  /** The key whose draft is not applied yet, drawn with a pending mark. */
  pendingIndex?: number | null;
  /** The keys just changed by an apply, which press down once together (a proposal can change several). */
  appliedKeys?: ReadonlySet<number>;
  /** Keys changed since the keyboard last had the layout: an amber dot until it does (D-263, P3 review). */
  unsynced?: ReadonlySet<number>;
  /** Counts applies, so applying the same key twice presses it twice (D-268). */
  pressSeq?: number;
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
  /** Lines between the keys of combos, with their outputs (16#combos-are-made-from-a-selection). */
  comboLines?: readonly ComboLine[];
  /** The combo being pointed at, and the keys that makes light up. */
  comboHovered?: string | null;
  comboLit?: ReadonlySet<number>;
  /** Keys the library is pointing at (a macro's or a tap dance's users), drawn with an outline. */
  highlighted?: ReadonlySet<number>;
  onComboHover?: (id: string | null) => void;
  onComboOpen?: (id: string) => void;
  /** Whether a key can be dragged onto another, and what dropping does (swap, or copy with Option). */
  dragEnabled?: boolean;
  onDropKey?: (from: number, to: number, copy: boolean) => void;
  /** The board's display hints: rotation modules and the case's surface. */
  display?: BoardDefinition["display"];
  /** Which layer is on screen; a change of it ripples the legends and the light (D-265). */
  layerKey?: string;
  /** The layer's light as a CSS colour, or null when it is unlit: the underglow (D-263). */
  light?: string | null;
  /** Key position -> the light of the layer that key reaches; null for a layer with none. */
  reach?: ReadonlyMap<number, string | null>;
  /** The key the light change starts from: the key that holds the layer. */
  rippleFrom?: number | null;
  /** A key the person just pressed on the real keyboard, lit for a moment so it can be found. */
  found?: number | null;
  /** Inspect: kinds tinted, inherited legends and combo dots shown (D-264). */
  inspect?: boolean;
  /** How far the board slides sideways to make room for the key card, in px (P2). */
  shiftPx?: number;
  /** The halves part for the key card: which hand slides, and by how far in px (BK: "halves part only when needed"). */
  part?: { hand: "left" | "right"; px: number } | null;
  /** A proposal is on the board: keys it doesn't touch step back, so the change is what's seen (comp d). */
  previewing?: boolean;
  /** The board's scale about its centre, below 1 while a parted board would otherwise run off the stage. */
  scale?: number;
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
  keycaps,
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
  ledColors,
  pendingIndex = null,
  appliedKeys,
  unsynced,
  pressSeq = 0,
  chatSelected,
  marks,
  remembered,
  arrows = [],
  handle,
  half = null,
  onSwipe,
  comboLines = [],
  comboHovered = null,
  comboLit,
  highlighted,
  onComboHover,
  onComboOpen,
  dragEnabled = false,
  onDropKey,
  display,
  layerKey,
  light = null,
  reach,
  rippleFrom = null,
  found = null,
  inspect = false,
  shiftPx = 0,
  part = null,
  scale = 1,
  previewing = false,
}: KeyboardProps) {
  const handOf = useMemo(() => {
    const map = new Map<number, "left" | "right">();
    for (const p of hands.left) map.set(p, "left");
    for (const p of hands.right) map.set(p, "right");
    return map;
  }, [hands]);
  // A phone draws the board small, so its legend floor is 10 px; everywhere else 11 (18#legends-stay-readable).
  const floorPx = useMediaQuery(PHONE) ? PHONE_FLOOR_PX : LEGEND_FLOOR_PX;
  const { drag, onPointerDown: dragStart, wasDrag } = useKeyDrag({ enabled: dragEnabled, onDrop: (from, to, copy) => onDropKey?.(from, to, copy) });
  // One hand's keys, when only one is shown. The canvas, the trays, the caps and the arrow keys all follow it.
  const visible = useMemo(() => (half === null ? null : new Set(hands[half])), [half, hands]);
  const shownKeys = useMemo(() => (visible === null ? keys : keys.filter((_, index) => visible.has(index))), [keys, visible]);
  const bounds = boardBounds(shownKeys);
  const parts = useMemo(() => caseParts(keys, hands, display, half), [keys, hands, display, half]);
  // The margin around the keys holds most cases and their shadow; a case can reach further (the Moonlander's top edge and tenting
  // legs, a laptop's deck), so the canvas also covers the case itself plus room for its shadow.
  const drawnCase = caseBounds(parts);
  const minX = Math.min(bounds.minX - MARGIN, (drawnCase?.minX ?? Infinity) - CASE_MARGIN);
  const minY = Math.min(bounds.minY - MARGIN, (drawnCase?.minY ?? Infinity) - CASE_MARGIN);
  const maxX = Math.max(bounds.minX + bounds.width + MARGIN, (drawnCase?.maxX ?? -Infinity) + CASE_MARGIN);
  const maxY = Math.max(bounds.minY + bounds.height + MARGIN, (drawnCase?.maxY ?? -Infinity) + CASE_MARGIN);
  const canvas: Bounds = { minX, minY, width: maxX - minX, height: maxY - minY };
  const { ref, unit: fitUnit, overflowing } = useFitUnit({ width: canvas.width, height: canvas.height });
  // A parted board that is too wide for the stage is drawn at a smaller unit, never with a CSS scale: every legend is then fitted at
  // the size it is drawn, so the 11 px floor still holds (P2 review).
  // Never below a fingertip's 44 px for a parting (or below the unit the window already gave): smaller keys take the 10 px floor, and
  // the card shouldn't be what shrinks the legends.
  const unit = scale === 1 ? fitUnit : Math.max(Math.min(fitUnit, Math.max(44, minUnit())), Math.floor(fitUnit * scale));
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const shapes = display?.keyShapes;
  const caseId = useId().replace(/:/g, "");
  const { delays, outgoing, origin: rippleOrigin } = useRipple(keys, canvas, layerKey, descriptions, legendOverrides, rippleFrom);
  // Only a board whose case is in two pieces can part; a laptop's keys belong to hands but sit on one deck.
  const parts2 = parts.some((part) => part.hand !== null);
  // Measured once the web font is in, since the fallback font is a different width.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let live = true;
    void document.fonts?.ready.then(() => live && setFontsReady(true));
    return () => {
      live = false;
    };
  }, []);
  // A key under a fingertip's 44 px (a short window with a mouse) allows the phone's 10 px legend floor, so words aren't cut.
  const legendFloor = unit < 44 ? PHONE_FLOOR_PX : floorPx;
  const symbols = useMemo(() => {
    const font = `560 condensed ${Math.max(legendFloor, unit * 0.15)}px "Instrument Sans"`;
    const both = fontsReady ? measureText(WIDEST_WITH_SYMBOL, font) : null;
    const word = fontsReady ? measureText(WIDEST_WORD, font) : null;
    return frontMode(unit, both === null || word === null ? null : { both, word }, GAP, legendFloor);
  }, [unit, legendFloor, fontsReady]);
  // Shift-, Cmd- or Ctrl-click adds a key to the selection. The focus that the press causes must not move the open panel to that key first.
  const extendNext = useRef(false);
  // A phone shows one hand, so a combo is drawn only when all its keys are on it.
  const visibleLines = visible === null ? comboLines : comboLines.filter((line) => line.positions.every((position) => visible.has(position)));
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
      {/* The light is the row's background, not part of the board: a glow larger than the board would make the row scroll. */}
      <Underglow light={light} />
      <div
        className="keyboard"
        data-inspect={inspect}
        data-previewing={previewing}
        data-surface={display?.surface ?? "slab"}
        role="group"
        aria-label={`Keyboard, ${layerName}. Arrow keys move between keys.`}
        data-part={part === null || part.px === 0 ? undefined : part.hand}
        style={{ width: canvas.width * unit, height: canvas.height * unit, transform: shiftPx === 0 ? undefined : `translateX(${shiftPx}px)`, "--part": `${part?.px ?? 0}px`, "--part-units": `${(part?.px ?? 0) / unit}` } as CSSProperties}
      >
        <span className="keyboard-contact" aria-hidden="true" />
        <svg className="keyboard-case" aria-hidden="true" viewBox={`${canvas.minX} ${canvas.minY} ${canvas.width} ${canvas.height}`} data-surface={display?.surface ?? "slab"}>
          {parts.some((part) => part.kind === "grille") ? (
            // A speaker grille's holes, as a pattern in key units: drawn one by one they would be a thousand paths.
            <defs>
              <pattern id={`${caseId}-grille`} width={0.09} height={0.09} patternUnits="userSpaceOnUse">
                <circle className="case-grille-hole" cx={0.045} cy={0.045} r={0.022} />
              </pattern>
            </defs>
          ) : null}
          {parts.map((part, i) => (
            <path key={i} className={`case-${part.kind}`} d={part.d} data-hand={part.hand ?? undefined} style={part.kind === "grille" ? { fill: `url(#${caseId}-grille)` } : undefined} />
          ))}
          {(display?.statusLeds ?? []).map((led, i) => {
            // The LEDs change with the ripple, at the delay a key in their place would have.
            const delay = rippleOrigin === null ? 0 : Math.hypot(led.x - canvas.minX - rippleOrigin.x, led.y - canvas.minY - rippleOrigin.y) * RIPPLE_MS_PER_UNIT;
            const ledHand = parts2 ? statusLedHand(led.x, keys, hands) : null;
            return <circle key={`led-${i}`} data-hand={ledHand ?? undefined} className="case-led" data-lit={light !== null} cx={led.x} cy={led.y} r={0.055} style={{ "--led-colour": light ?? "transparent", "--ripple": `${Math.round(delay)}ms` } as CSSProperties} />;
          })}
        </svg>
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
              {...(keycaps?.[String(index)] === undefined ? {} : { keycap: keycaps[String(index)] as KeycapColour })}
              legend={legendOverrides?.[index] ?? description.legend}
              breakable={legendOverrides?.[index] !== undefined}
              {...(ledColors?.has(index) ? { led: ledColors.get(index) as string } : {})}
              {...(reach?.has(index) ? { reach: reach.get(index) ?? null } : {})}
              outgoing={outgoing?.[index] ?? null}
              frontMode={symbols}
              rippleMs={delays?.[index] ?? 0}
              {...(appliedKeys?.has(index) ? { pressed: pressSeq } : {})}
              pending={pendingIndex === index || marks?.get(index) === "changed"}
              remembered={remembered?.has(index) ?? false}
              title={description.headline}
              unit={unit}
              floorPx={legendFloor}
              width={geometryKey.w}
              {...(shapes?.[String(index)]?.outline === undefined ? {} : { shape: { outline: shapes[String(index)]?.outline ?? [], w: (rect.width - GAP) * unit, h: (rect.height - GAP) * unit } })}
              // The Moonlander's thumbs tilt a little and read fine; the Glove80's fan out to 60 degrees.
              {...(Math.abs(rect.rotate) > UPRIGHT_ABOVE_DEG ? { legendTurn: -rect.rotate, ...uprightBox(rect) } : {})}
              style={keyStyle(rect, unit)}
              tabIndex={index === tabStop ? 0 : -1}
              aria-label={ariaLabel(index, description, fingers[String(index)], pendingIndex === index, marks?.get(index), remembered?.has(index))}
              // Pressed means "in the chat's Asking about chips"; `data-current` is the key whose panel is open.
              aria-pressed={chatSelected?.has(index) ?? false}
              data-current={current === index}
              data-partner={partners.has(index)}
              data-pending={pendingIndex === index || marks?.get(index) === "changed"}
              data-home={marks?.get(index) === "home"}
              data-applied={appliedKeys?.has(index) ?? false}
              data-unsynced={unsynced?.has(index) ?? false}
              data-found={found === index}
              data-key-index={index}
              data-hand={parts2 ? handOf.get(index) : undefined}
              data-combo-hover={comboLit?.has(index) ?? false}
              data-highlight={highlighted?.has(index) ?? false}
              data-dragging={drag?.from === index}
              data-drop={drag !== null && drag.over === index}
              onPointerDown={(event) => {
                extendNext.current = event.shiftKey || event.metaKey || event.ctrlKey;
                dragStart(event, index);
              }}
              onFocus={() => {
                if (!extendNext.current) onSelect(index);
              }}
              onClick={(event) => {
                const extend = extendNext.current || event.shiftKey || event.metaKey || event.ctrlKey;
                extendNext.current = false;
                if (wasDrag()) return;
                // Safari doesn't focus a button on click, so the click selects as well as the focus.
                if (!extend) onSelect(index);
                onPress(index, "pointer", extend);
              }}
              onKeyDown={(event) => {
                extendNext.current = false;
                onKeyDown(event, index);
              }}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") onHover(index);
              }}
              onPointerLeave={() => onHover(null)}
            />
          );
        })}
        <MoveArrows keys={keys} canvas={canvas} unit={unit} arrows={arrows} />
        <ComboLines keys={keys} canvas={canvas} unit={unit} lines={visibleLines} hovered={comboHovered} onHover={(id) => onComboHover?.(id)} onOpen={(id) => onComboOpen?.(id)} />
      </div>
      {drag === null ? null : (
        <div className="key-ghost" role="status" style={{ left: drag.x, top: drag.y }}>
          {drag.over === null ? "Drop on a key" : `${drag.copy ? "Copy to" : "Swap with"} key ${drag.over + 1}`}
        </div>
      )}
    </div>
  );
}

// A status LED belongs to the hand whose keys it sits over, so it parts with that half.
function statusLedHand(x: number, keys: readonly GeometryKey[], hands: { left: readonly number[]; right: readonly number[] }): "left" | "right" | null {
  const xs = (positions: readonly number[]) => positions.flatMap((p) => (keys[p] === undefined ? [] : [(keys[p] as GeometryKey).x]));
  const leftMax = Math.max(...xs(hands.left), Number.NEGATIVE_INFINITY);
  const rightMin = Math.min(...xs(hands.right), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(leftMax) || !Number.isFinite(rightMin)) return null;
  return x <= (leftMax + rightMin + 1) / 2 ? "left" : "right";
}

// A long cap turned steeply (the Moonlander's 1.5u thumbs at 51 degrees) would swing the corners of an upright print out of the cap, and
// the front word with them. Its print gets the widest upright box of PRINT_DEPTH units that fits inside the turned cap instead. A
// square cap keeps its own box: its corners stay close enough (the Glove80's thumbs).
const PRINT_DEPTH = 0.6;
function uprightBox(rect: KeyRect): { printBox?: { w: number; h: number } } {
  const w = rect.width - GAP;
  const h = rect.height - GAP;
  if (Math.abs(w - h) < 0.01) return {};
  const c = Math.abs(Math.cos((rect.rotate * Math.PI) / 180));
  const s = Math.abs(Math.sin((rect.rotate * Math.PI) / 180));
  const across = Math.min(w, h, (w - PRINT_DEPTH * s) / c, (h - PRINT_DEPTH * c) / s);
  return across > 0 ? { printBox: { w: across, h: PRINT_DEPTH } } : {};
}

// Real caps print their legends turned with the cap; the Moonlander's 30 degree thumbs read fine that way. Past this, the
// Glove80's fan, the legend is turned back upright.
const UPRIGHT_ABOVE_DEG = 32;
// The ripple's speed, in ms per key unit of distance from the key the layer change starts at (D-265).
const RIPPLE_MS_PER_UNIT = 18;
// How long the outgoing legend is kept, past the last key's delay, for it to fade.
const RIPPLE_TAIL_MS = 320;

type Print = Pick<Legend, "tap" | "hold" | "double" | "tapHold">;

// When the layer changes, each key's new legend and light arrive after a delay that grows with its distance from the key that holds
// the layer, and the old legend fades out at the same moment. Keys never move. With reduced motion every delay is zero.
function useRipple(
  keys: readonly GeometryKey[],
  canvas: Bounds,
  layerKey: string | undefined,
  descriptions: readonly (KeyDescription | null)[],
  overrides: KeyboardProps["legendOverrides"],
  from: number | null,
): { delays: readonly number[] | null; outgoing: readonly (Print | null)[] | null; origin: { x: number; y: number } | null } {
  const shownPrints = descriptions.map((description, index) => overrides?.[index] ?? description?.legend ?? null);
  // What the previous render drew, and for which layer; read before this render's values replace it.
  const last = useRef<{ key: string | undefined; prints: (Print | null)[] }>({ key: layerKey, prints: shownPrints });
  const timer = useRef<number | undefined>(undefined);
  const [ripple, setRipple] = useState<{ delays: number[]; outgoing: (Print | null)[]; origin: { x: number; y: number } } | null>(null);
  useEffect(() => {
    const before = last.current;
    last.current = { key: layerKey, prints: shownPrints };
    if (before.key === layerKey) return;
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const origin = from !== null && keys[from] !== undefined ? keyCenter(keys[from] as GeometryKey, canvas) : { x: canvas.width / 2, y: canvas.height };
    const delays = keys.map((key) => {
      const c = keyCenter(key, canvas);
      return Math.hypot(c.x - origin.x, c.y - origin.y) * RIPPLE_MS_PER_UNIT;
    });
    setRipple({ delays, outgoing: before.prints, origin });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setRipple(null), Math.max(0, ...delays) + RIPPLE_TAIL_MS);
  });
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // The legend a key keeps showing while its delay runs is the one it had; the same legend on both layers needs no fade.
  const outgoing = ripple === null ? null : ripple.outgoing.map((old, i) => (old !== null && !samePrint(old, shownPrints[i] ?? null) ? old : null));
  return { delays: ripple?.delays ?? null, outgoing, origin: ripple?.origin ?? null };
}

const samePrint = (a: Print, b: Print | null) => b !== null && a.tap === b.tap && a.hold === b.hold && a.double === b.double && a.tapHold === b.tapHold;

// The board's own light, cast on the backdrop below it. Two layers cross-fade so one colour gives way to the next.
function Underglow({ light }: { light: string | null }) {
  const [shown, setShown] = useState<{ a: string | null; b: string | null; front: "a" | "b" }>({ a: light, b: null, front: "a" });
  useEffect(() => {
    setShown((current) => {
      const lit = current.front === "a" ? current.a : current.b;
      if (lit === light) return current;
      return current.front === "a" ? { a: current.a, b: light, front: "b" } : { a: light, b: current.b, front: "a" };
    });
  }, [light]);
  return (
    <>
      <span className="keyboard-glow" aria-hidden="true" data-on={shown.front === "a" && shown.a !== null} style={{ "--glow-colour": shown.a ?? "transparent" } as CSSProperties} />
      <span className="keyboard-glow" aria-hidden="true" data-on={shown.front === "b" && shown.b !== null} style={{ "--glow-colour": shown.b ?? "transparent" } as CSSProperties} />
    </>
  );
}
const PHONE_FLOOR_PX = 10;
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
