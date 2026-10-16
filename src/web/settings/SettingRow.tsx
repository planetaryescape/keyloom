import { RotateCcw } from "lucide-react";
import { useId } from "react";
import type { OptionSpec } from "../../layout/firmware-options.ts";

interface Props {
  spec: OptionSpec;
  value: number | boolean;
  /** What the firmware does with no setting from keyloom. */
  baseline: number | boolean;
  /** Written in words when the option can't do anything yet, such as Caps Word's timeout with Caps Word off. */
  blockedBy: string | null;
  changed: boolean;
  /** Changed here and not applied yet: the amber dot (D-263). */
  staged?: boolean;
  /** The firmware's own name, shown in the Advanced view. */
  advanced: boolean;
  /** Hold-tap profiles that keep their own value for this option after the change. */
  keptOwn: string[];
  /** The option is set in the source to something that isn't a plain number or switch; it is shown, not edited. */
  sourceText?: string | undefined;
  onChange: (value: number | boolean) => void;
}

const show = (spec: OptionSpec, value: number | boolean): string => {
  if (spec.kind === "flag") return value === true ? "On" : "Off";
  if (value === 0 && spec.zero !== undefined) return spec.zero;
  return `${value}${spec.unit === "" ? "" : ` ${spec.unit}`}`;
};

// One option: its name and default, a switch or a slider, and when to change it (D-103). Nothing is saved from here:
// the page's footer applies every staged option as one change set.
export function SettingRow({ spec, value, baseline, blockedBy, changed, staged = false, advanced, keptOwn, sourceText, onChange }: Props) {
  const id = useId();
  const dependent = blockedBy !== null || sourceText !== undefined;
  // One line of plain words; the rest of the explanation opens on request (P4 review).
  const cut = spec.words.indexOf(". ");
  const lead = cut < 0 ? spec.words : spec.words.slice(0, cut + 1);
  const more = cut < 0 ? "" : spec.words.slice(cut + 2);
  return (
    <div className="setting" data-changed={changed} data-staged={staged} data-blocked={dependent}>
      <div className="setting-head">
        <label htmlFor={id}>{spec.label}</label>
        <span className="setting-value" aria-hidden={spec.kind === "flag" && sourceText === undefined}>{sourceText !== undefined ? sourceText : spec.kind === "flag" ? null : show(spec, Number(value))}</span>
        {spec.kind === "flag" ? (
          <input id={id} type="checkbox" role="switch" className="switch" checked={value === true} disabled={dependent} onChange={(event) => onChange(event.target.checked)} />
        ) : null}
      </div>
      {spec.kind === "number" ? (
        <input
          id={id}
          type="range"
          className="slider"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={Number(value)}
          disabled={dependent}
          aria-valuetext={show(spec, Number(value))}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      ) : null}
      {changed ? (
        <p className="setting-default muted">
          <button type="button" className="link-button" onClick={() => onChange(baseline)}>
            <RotateCcw size={12} aria-hidden="true" />
            Back to the default, {show(spec, baseline)}
          </button>
        </p>
      ) : null}
      <p className="setting-words muted">{lead}</p>
      {more === "" && !advanced ? null : (
        <details className="setting-more">
          <summary>More</summary>
          <p className="muted">{more}</p>
          <p className="setting-default muted">
            Default: {show(spec, baseline)}
            {advanced ? <span className="setting-key"> · {spec.key}</span> : null}
          </p>
        </details>
      )}
      {blockedBy === null ? null : <p className="setting-note">{blockedBy}</p>}
      {sourceText === undefined ? null : <p className="setting-note">This is set to {sourceText} in your source, which the sliders can't show. Ask the chat to change it.</p>}
      {keptOwn.length === 0 ? null : (
        <p className="setting-note">
          {keptOwn.join(" and ")} {keptOwn.length === 1 ? "keeps" : "keep"} its own value for this, so keys that use {keptOwn.length === 1 ? "it" : "them"} won&rsquo;t follow the change. Tune that from one of its keys.
        </p>
      )}
    </div>
  );
}
