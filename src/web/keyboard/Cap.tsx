import { Bookmark, Check } from "lucide-react";
import type { ButtonHTMLAttributes, CSSProperties, Ref } from "react";
import type { Legend } from "../../layout/legend.ts";
import { CAP_INSET, fitLegend, HOLD_SIZE, TAP_SIZE, textEm } from "./fit.ts";

export type Tone = Legend["kind"];

interface CapProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> {
  tone: Tone;
  legend: Pick<Legend, "tap" | "hold" | "double" | "tapHold">;
  /** Pixels per key unit. */
  unit: number;
  /** The smallest legend, in px; phones allow 10 (18#legends-stay-readable). */
  floorPx?: number;
  /** Key width in units; wider caps give their legend more room. */
  width: number;
  /** Which kind of element to draw: a real button on the board, a plain swatch elsewhere. */
  as?: "button" | "span";
  combo?: boolean;
  /** Degrees to turn the legend back by, so a steeply rotated key still reads upright. */
  legendTurn?: number;
  /** For a layer key: which of the layer colours (1 to 6) its left edge is drawn in. */
  layerColor?: number;
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
const breakAtSeams = (text: string) => text.replace(/[_+(]/g, (seam) => `${seam}\u200b`);

// One keycap (18#a-keycap-shows-every-slot-it-has). Tap is centred and hold sits bottom-left. Kind
// is carried by shape (a hold-tap's band, a layer key's edge, a macro's mark, a transparent key's
// dashes, a none key's hatching) as well as by fill, and the selection, draft and remembered marks
// are each their own element so they can show together.
export function Cap({
  tone, legend, unit, floorPx, width, as = "button", combo = false, legendTurn, layerColor, pending = false, remembered = false, breakable = false, style, ...rest
}: CapProps) {
  const floor = floorPx === undefined ? {} : { floor: floorPx };
  const tap = fitLegend(legend.tap, width, TAP_SIZE, { unit, ...floor });
  const hold = legend.hold === undefined ? null : fitLegend(legend.hold, width, HOLD_SIZE, { unit, ...floor });
  // A name wider than the cap wraps at its seams (layer_ / td) and nowhere else: a word with no seam stays whole
  // (a "toggl / e" legend broke mid-word on a phone, fixed in rung 15, D-187), so its table entry has to be short enough to fit.
  const wraps = (value: string, size: number) => breakable || (/[_+(]/.test(value) && textEm(value) * size > width - CAP_INSET);
  const tapWraps = wraps(legend.tap, tap.size);
  const double = legend.double === undefined ? null : fitLegend(legend.double, width / 2 + 0.1, HOLD_SIZE, { unit, ...floor });
  const holdWraps = legend.hold !== undefined && hold !== null && wraps(legend.hold, hold.size);
  const words = (
    <>
      {legend.tap === "" ? null : (
        <span className="cap-tap" data-wrap={tapWraps} style={{ fontSize: tap.size * unit }}>
          {tapWraps ? breakAtSeams(legend.tap) : legend.tap}
        </span>
      )}
      {legend.double === undefined || double === null ? null : (
        <span className="cap-double" style={{ fontSize: double.size * unit }}>
          <span className="cap-double-mark" aria-hidden="true">⇈</span>
          {legend.double}
        </span>
      )}
      {legend.tapHold === true ? (
        <span className="cap-dots" aria-hidden="true" style={{ gap: Math.max(2, unit * 0.04) }}>
          <i /><i /><i />
        </span>
      ) : null}
      {legend.hold === undefined || hold === null ? null : (
        <span className="cap-hold" data-wrap={holdWraps} style={{ fontSize: hold.size * unit }}>
          {holdWraps ? breakAtSeams(legend.hold) : legend.hold}
        </span>
      )}
    </>
  );
  const selected = rest["aria-pressed"] === true;
  const children = (
    <>
      {tone === "holdTap" ? <span className="cap-band" aria-hidden="true" /> : null}
      {tone === "layer" ? <span className="cap-edge" aria-hidden="true" style={{ background: `var(--layer-${layerColor ?? 1})` }} /> : null}
      {tone === "macro" ? <span className="cap-glyph" aria-hidden="true" style={{ fontSize: Math.max(11, unit * 0.2) }}>▸</span> : null}
      {legendTurn === undefined ? words : <span className="cap-legend" style={{ transform: `rotate(${legendTurn}deg)` }}>{words}</span>}
      {combo ? (
        <span
          className="cap-combo"
          aria-hidden="true"
          style={{ width: unit * 0.11, height: unit * 0.11, bottom: unit * 0.07, right: unit * 0.07 }}
        />
      ) : null}
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
  const capStyle: CSSProperties = { borderRadius: Math.min(unit * 0.14, 8), ...style };
  if (as === "span") {
    return (
      // A swatch only illustrates; whatever it sits beside carries the words.
      <span className="cap" data-tone={tone} style={capStyle} aria-hidden="true">
        {children}
      </span>
    );
  }
  return (
    <button type="button" className="cap" data-tone={tone} style={capStyle} {...rest}>
      {children}
    </button>
  );
}
