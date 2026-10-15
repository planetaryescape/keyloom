import type { ButtonHTMLAttributes, CSSProperties, Ref } from "react";
import type { Legend } from "../../layout/legend.ts";
import { fitLegend, HOLD_SIZE, TAP_SIZE } from "./fit.ts";

export type Tone = Legend["kind"];

interface CapProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> {
  tone: Tone;
  legend: Pick<Legend, "tap" | "hold">;
  /** Pixels per key unit. */
  unit: number;
  /** Key width in units; wider caps give their legend more room. */
  width: number;
  /** Which kind of element to draw: a real button on the board, a plain swatch elsewhere. */
  as?: "button" | "span";
  combo?: boolean;
  style?: CSSProperties;
  ref?: Ref<HTMLButtonElement>;
}

// One keycap: used on the board as a button and in the legend and inspector as a swatch.
export function Cap({ tone, legend, unit, width, as = "button", combo = false, style, ...rest }: CapProps) {
  const tap = fitLegend(legend.tap, width, TAP_SIZE);
  const hold = legend.hold === undefined ? null : fitLegend(legend.hold, width, HOLD_SIZE);
  const children = (
    <>
      {legend.tap === "" ? null : (
        <span className="cap-tap" data-wrap={!tap.fits} style={{ fontSize: tap.size * unit }}>
          {legend.tap}
        </span>
      )}
      {legend.hold === undefined || hold === null ? null : (
        <span className="cap-hold" style={{ fontSize: hold.size * unit }}>
          {legend.hold}
        </span>
      )}
      {combo ? (
        <span
          className="cap-combo"
          aria-hidden="true"
          style={{ width: unit * 0.11, height: unit * 0.11, top: unit * 0.07, right: unit * 0.07 }}
        />
      ) : null}
    </>
  );
  const capStyle: CSSProperties = { borderRadius: unit * 0.14, ...style };
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
