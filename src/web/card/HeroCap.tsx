import type { CSSProperties, ReactNode } from "react";
import type { KeycapColour } from "../../boards/schema.ts";
import type { Legend } from "../../layout/legend.ts";
import { frontWords } from "../keyboard/front-words.ts";

export type HeroSlot = "tap" | "hold" | "doubleTap" | "tapThenHold";

interface Region {
  /** What the slot prints now, or null when it is empty. */
  text: string | null;
  /** What an empty slot says, faintly ("hold…"); absent when the key can't take that slot. */
  ghost?: string;
  /** The slot's name for a screen reader ("When held"). */
  name: string;
}

interface Props {
  legend: Pick<Legend, "tap" | "hold" | "double" | "tapHold">;
  tone: Legend["kind"];
  /** The physical cap's colour, so the Moonlander's red thumb keys look red here too. */
  keycap?: KeycapColour | undefined;
  /** The key's LED colour on this layer. */
  led?: string | undefined;
  /** For a key that reaches a layer: that layer's light, as the dot on the front print. */
  reach?: string | null | undefined;
  hold: Region | null;
  /** A front print that isn't a slot the card edits (a layer key's action, a firmware key's hold), shown as printed. */
  staticFront?: string | null;
  doubleTap: Region | null;
  tapThenHold: Region | null;
  /** The slot whose picker is open, drawn with a ring. */
  open: HeroSlot | null;
  /** A change is waiting. */
  draft: boolean;
  /** The slots the change touches: only those are lit amber (P2 review), not the whole cap. */
  changed?: ReadonlySet<HeroSlot>;
  onOpen: (slot: HeroSlot) => void;
  /** Words under the cap for a screen reader: what the key does now. */
  label: string;
  size?: number;
}

const withSpaceMark = (text: string): ReactNode[] =>
  text.split("␣").flatMap((part, i) => (i === 0 ? [part] : [<span key={i} className="spc" aria-hidden="true" />, part]));

// The card's hero (23#the-key-card): the key drawn large, in the same five layers as on the board. Its parts are its slots: the top face
// is what a tap sends, the front skirt what a hold does, the top corners a double tap and a tap-then-hold. An empty slot is a faint word
// on the cap, never a row of dashed boxes. Each part is a button that opens that slot's picker under the cap.
export function HeroCap({ legend, tone, keycap, led, reach, hold, staticFront = null, doubleTap, tapThenHold, open, draft, changed, onOpen, label, size = 112 }: Props) {
  const tapSize = [...legend.tap].length <= 1 ? 0.42 : [...legend.tap].length <= 3 ? 0.32 : 0.22;
  const region = (slot: HeroSlot, value: Region | null, className: string, children: ReactNode) =>
    value === null ? null : (
      <button
        type="button"
        className={`hero-region ${className}`}
        data-open={open === slot}
        data-changed={changed?.has(slot) === true}
        data-empty={value.text === null}
        aria-label={`${value.name}: ${value.text ?? "nothing yet"}. ${value.text === null ? "Add" : "Change"}`}
        aria-expanded={open === slot}
        onClick={() => onOpen(slot)}
      >
        {children}
      </button>
    );
  const cornerText = (value: Region | null) => (value === null ? null : value.text === null ? <span className="hero-ghost">{value.ghost}</span> : withSpaceMark(value.text));
  return (
    <div className="hero-cap cap" data-tone={tone} data-keycap={keycap} data-led={led !== undefined} data-draft={draft} style={{ "--u": `${size}px`, width: size, height: size, ...(led === undefined ? {} : { "--led": led }) } as CSSProperties}>
      <span className="sr-only">{label}</span>
      <span className="cap-bleed" aria-hidden="true" />
      <span className="cap-body">
        <span className="cap-top" aria-hidden="true" />
        {region("tap", { text: legend.tap, name: "When tapped" }, "hero-tap", <span className="cap-tap" style={{ fontSize: size * tapSize }}>{withSpaceMark(legend.tap === "" ? "·" : legend.tap)}</span>)}
        {region(
          "hold",
          hold,
          "hero-front",
          <span className="cap-front">
            {hold?.text !== null && reach !== undefined ? <i className="cap-dot" data-unlit={reach === null} style={reach === null ? undefined : ({ "--dot": reach } as CSSProperties)} /> : null}
            {hold === null ? null : hold.text === null ? <span className="hero-ghost">{hold.ghost}</span> : withSpaceMark(frontWords(hold.text, "both"))}
          </span>,
        )}
        {hold === null && staticFront !== null ? (
          <span className="hero-front hero-front-static">
            <span className="cap-front">
              {reach === undefined ? null : <i className="cap-dot" data-unlit={reach === null} style={reach === null ? undefined : ({ "--dot": reach } as CSSProperties)} />}
              {withSpaceMark(staticFront)}
            </span>
          </span>
        ) : null}
        {region("tapThenHold", tapThenHold, "hero-corner hero-corner-start", cornerText(tapThenHold))}
        {region("doubleTap", doubleTap, "hero-corner hero-corner-end", cornerText(doubleTap))}
      </span>
      {draft ? <span className="cap-mark cap-mark-draft" aria-hidden="true" /> : null}
    </div>
  );
}
