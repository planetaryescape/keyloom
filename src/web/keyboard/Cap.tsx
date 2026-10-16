import { Bookmark, Check } from "lucide-react";
import { animate } from "motion";
import { useEffect, useRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode, type Ref } from "react";
import type { Legend } from "../../layout/legend.ts";
import type { KeycapColour } from "../../boards/schema.ts";
import { fitLegend, HOLD_SIZE, isCondensed, tapRange } from "./fit.ts";
import { frontWords, type FrontMode } from "./front-words.ts";

export type Tone = Legend["kind"];
type CapLegend = Pick<Legend, "tap" | "hold" | "double" | "tapHold">;

interface CapProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> {
  tone: Tone;
  legend: CapLegend;
  /** Pixels per key unit. */
  unit: number;
  /** The smallest legend, in px; phones allow 10 (18#legends-stay-readable). */
  floorPx?: number;
  /** Key width in units; wider caps give their legend more room. */
  width: number;
  /** Which kind of element to draw: a real button on the board, a plain swatch elsewhere. */
  as?: "button" | "span";
  /** Degrees to turn the legend back by, so a steeply rotated key still reads upright. */
  legendTurn?: number;
  /** The key's LED colour on this layer as a hex: it bleeds onto the plate under the cap and tints the skirt (D-263). */
  led?: string;
  /** The physical keycap's colour (the Moonlander's red thumb keys). */
  keycap?: KeycapColour;
  /** For a key that reaches a layer: that layer's light, drawn as a dot on the front print. Null is a layer with no light. */
  reach?: string | null;
  /** The legend this key showed on the layer before, cross-faded out over `rippleMs` (D-265). */
  outgoing?: CapLegend | null;
  /** When this key's legend and light change after a layer switch, in ms, so the change ripples from the key that holds the layer. */
  rippleMs?: number;
  /** How a held modifier is printed on the front ("⌥ option", "option" or "⌥"): one choice for the whole board. */
  frontMode?: FrontMode;
  /** Change counter for the press: each new value presses the key down once (D-268). */
  pressed?: number;
  /** The draft mark: this key's change is not applied yet. */
  pending?: boolean;
  /** The remembered mark: keyloom keeps a reason for this key. */
  remembered?: boolean;
  /** Firmware names can be long (KC_BSPC), so Advanced view may break them at underscores. */
  breakable?: boolean;
  style?: CSSProperties;
  ref?: Ref<HTMLButtonElement>;
}

// A zero-width space after each underscore, plus and bracket lets a firmware name wrap at its own seams.
const breakAtSeams = (text: string) => text.replace(/[_+(]/g, (seam) => `${seam}​`);
// U+2423 is drawn in CSS, so it matches the legend's stroke in any font.
const withSpaceMark = (text: string): ReactNode[] =>
  text.split("␣").flatMap((part, i) => (i === 0 ? [part] : [<span key={i} className="spc" aria-hidden="true" />, part]));

/** The printing on one cap: the tap on the top face, the hold (or a tap dance's double tap) printed on the front skirt. */
function Print({ legend, unit, width, floorPx, reach, breakable, symbols, className }: { legend: CapLegend; unit: number; width: number; floorPx: number | undefined; reach: string | null | undefined; breakable: boolean; symbols: FrontMode; className: string }) {
  const floor = floorPx === undefined ? {} : { floor: floorPx };
  const tap = fitLegend(legend.tap, width, tapRange(legend.tap), { unit, ...floor }, isCondensed(legend.tap));
  const holdText = legend.hold === undefined ? null : frontWords(legend.hold, symbols);
  const doubleText = legend.double === undefined ? null : `2× ${legend.double}`;
  // The front carries the hold; a tap dance with no hold prints its double tap there instead, and with a hold, in the top corner.
  const front = holdText ?? doubleText;
  const corner = holdText !== null && doubleText !== null ? doubleText : null;
  // The layer dot takes about 0.12u beside the words. When the words and the dot don't both fit, the dot goes: the name already says
  // which layer, and a cut-off word says nothing (hotfix v0.22.1).
  const DOT_UNITS = 0.12;
  const withDot = front === null || reach === undefined ? null : fitLegend(front, width - DOT_UNITS, HOLD_SIZE, { unit, ...floor }, true);
  const showDot = withDot !== null && withDot.fits;
  const frontSize = front === null ? 0 : (showDot && withDot !== null ? withDot : fitLegend(front, width, HOLD_SIZE, { unit, ...floor }, true)).size;
  const stretch = isCondensed(legend.tap) ? "condensed" : undefined;
  return (
    <span className={className}>
      <span className="cap-face">
        {legend.tap === "" ? null : (
          <span className="cap-tap" data-stretch={stretch} style={{ fontSize: tap.size * unit }}>
            {breakable ? breakAtSeams(legend.tap) : withSpaceMark(legend.tap)}
          </span>
        )}
        {corner === null ? null : <span className="cap-corner">{withSpaceMark(corner)}</span>}
        {legend.tapHold === true ? <span className="cap-corner cap-corner-start" aria-hidden="true">tap+hold</span> : null}
      </span>
      {front === null ? null : (
        <span className="cap-front" style={{ fontSize: frontSize * unit }}>
          {reach === undefined || !showDot ? null : <i className="cap-dot" data-unlit={reach === null} style={reach === null ? undefined : ({ "--dot": reach } as CSSProperties)} />}
          {breakable ? breakAtSeams(front) : withSpaceMark(front)}
        </span>
      )}
    </span>
  );
}

// One keycap, built in layers like a real one (23#the-keycap): the LED's bleed on the plate, the skirt, the dished top face, and
// the legends printed on the top and the front. Kind is not drawn at rest; Inspect tints the face by kind (D-264). The selection,
// draft and remembered marks are each their own element so they can show together.
export function Cap({
  tone, legend, unit, floorPx, width, as = "button", legendTurn, keycap, led, reach, outgoing = null,
  rippleMs = 0, frontMode = "both", pressed, pending = false, remembered = false, breakable = false, style, ...rest
}: CapProps) {
  const body = useRef<HTMLSpanElement>(null);
  const last = useRef(pressed);
  // Applying presses the key down past rest and lets it spring back, the way a switch moves (D-268).
  useEffect(() => {
    if (pressed === undefined || pressed === last.current) return;
    last.current = pressed;
    const element = body.current;
    if (element === null || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const controls = animate(element, { y: [0, unit * 0.08, 0], scale: [1, 0.96, 1] }, { duration: 0.42, ease: [0.3, 1.4, 0.4, 1] });
    return () => controls.stop();
  }, [pressed, unit]);

  const turn = legendTurn === undefined ? undefined : ({ "--turn": `${legendTurn}deg` } as CSSProperties);
  const print = (value: CapLegend, className: string) => (
    <Print legend={value} unit={unit} width={width} floorPx={floorPx} reach={reach} breakable={breakable} symbols={frontMode} className={className} />
  );
  const selected = rest["aria-pressed"] === true;
  const children = (
    <>
      <span className="cap-bleed" aria-hidden="true" />
      <span ref={body} className="cap-body" style={turn}>
        <span className="cap-top" aria-hidden="true" />
        {outgoing === null ? null : print(outgoing, "cap-print cap-out")}
        {print(legend, outgoing === null ? "cap-print" : "cap-print cap-in")}
        {tone === "macro" ? <span className="cap-kind-mark" aria-hidden="true">▸</span> : null}
      </span>
      {selected ? (
        <span className="cap-mark cap-mark-selected" aria-hidden="true">
          <Check size={10} strokeWidth={3} />
        </span>
      ) : null}
      {pending ? <span className="cap-mark cap-mark-draft" aria-hidden="true" /> : null}
      {remembered ? (
        <span className="cap-mark cap-mark-remembered" aria-hidden="true">
          <Bookmark size={10} strokeWidth={2.5} />
        </span>
      ) : null}
    </>
  );
  const capStyle = { "--u": `${unit}px`, "--ripple": `${Math.round(rippleMs)}ms`, ...(led === undefined ? {} : { "--led": led }), ...style } as CSSProperties;
  if (as === "span") {
    return (
      // A swatch only illustrates; whatever it sits beside carries the words.
      <span className="cap" data-tone={tone} data-led={led !== undefined} data-keycap={keycap} style={capStyle} aria-hidden="true">
        {children}
      </span>
    );
  }
  return (
    <button type="button" className="cap" data-tone={tone} data-led={led !== undefined} data-keycap={keycap} data-upright={legendTurn !== undefined} style={capStyle} {...rest}>
      {children}
    </button>
  );
}
