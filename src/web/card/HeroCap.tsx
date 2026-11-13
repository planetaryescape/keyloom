import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { KeycapColour } from "../../boards/schema.ts";
import type { Legend } from "../../layout/legend.ts";
import { frontWords } from "../keyboard/front-words.ts";
import { CAP_INSET, fitLegend, isCondensed } from "../keyboard/fit.ts";

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
  /** The plain legend when the firmware spelling needs more room than the cap has. */
  compactTap?: string;
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
export function HeroCap({ legend, compactTap, tone, keycap, led, reach, hold, staticFront = null, doubleTap, tapThenHold, open, draft, changed, onOpen, label, size = 112 }: Props) {
  const probe = useRef<HTMLSpanElement>(null);
  const compactProbe = useRef<HTMLSpanElement>(null);
  const [needsCaption, setNeedsCaption] = useState(false);
  const [compactFits, setCompactFits] = useState(true);
  const hasCorners = doubleTap?.text != null || tapThenHold?.text != null;
  const letters = [...legend.tap].length;
  const preferredSize = letters <= 1 ? 0.42 : letters <= 3 ? 0.32 : 0.22;
  // Filled corners leave room for one symbol or two lines of text above the 24px hold target.
  const faceHeight = size - (hasCorners ? Math.max(size * 0.34, 32) : size * 0.04) - Math.max(size * 0.2, 26);
  const tapSize = Math.min(preferredSize, faceHeight / size / (letters > 3 ? 2.6 : 1.3));
  // The face is 0.85u wide. Match its real inset instead of fitting against the whole cap.
  const tapFit = fitLegend(legend.tap, 0.85 + CAP_INSET, { max: tapSize, min: 0.1 }, { unit: size }, isCondensed(legend.tap));
  const shortTap = compactTap ?? "Tap";
  const shortRange = { max: Math.min(0.32, faceHeight / size / 1.3), min: 0.1 };
  const shortFit = fitLegend(shortTap, 0.85 + CAP_INSET, shortRange, { unit: size }, isCondensed(shortTap));
  const tapFallbackFit = fitLegend("Tap", 0.85 + CAP_INSET, shortRange, { unit: size });
  // Measure the full label even when the cap shows its short form. Font loading and preview resizing can change the line count.
  useLayoutEffect(() => {
    const text = probe.current;
    const compact = compactProbe.current;
    const region = text?.parentElement;
    if (text == null || compact == null || region == null) return;
    const fits = (element: HTMLElement) => element.getBoundingClientRect().height + 1 <= region.clientHeight && element.scrollWidth <= region.clientWidth + 1;
    const check = () => { setNeedsCaption(!fits(text)); setCompactFits(fits(compact)); };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(text);
    observer.observe(compact);
    observer.observe(region);
    return () => observer.disconnect();
  }, [legend.tap, compactTap, size, hasCorners, tapFit.size, shortFit.size]);
  const visibleTap = needsCaption ? compactFits ? shortTap : "Tap" : legend.tap;
  const visibleFit = needsCaption ? compactFits ? shortFit : tapFallbackFit : tapFit;
  const print = (text: string) => withSpaceMark(text.replace(/[_+(]/g, (seam) => `${seam}\u200b`));
  const capStyle: CSSProperties & { "--u": string; "--led"?: string } = { "--u": `${size}px`, width: size, height: size };
  if (led !== undefined) capStyle["--led"] = led;
  const region = (slot: HeroSlot, value: Region | null, className: string, children: ReactNode) =>
    value === null ? null : (
      <button
        type="button"
        className={`hero-region ${className}`}
        data-open={open === slot}
        data-changed={changed?.has(slot) === true}
        data-empty={value.text === null}
        title={`${value.name}: ${value.text ?? "nothing yet"}`}
        aria-label={`${value.name}: ${value.text ?? "nothing yet"}. ${value.text === null ? "Add" : "Change"}`}
        aria-expanded={open === slot}
        onClick={() => onOpen(slot)}
      >
        {children}
      </button>
    );
  return (
    <>
    <div className="hero-cap cap" data-tone={tone} data-keycap={keycap} data-led={led !== undefined} data-draft={draft} style={capStyle}>
      <span className="sr-only">{label}</span>
      <span className="cap-bleed" aria-hidden="true" />
      <span className="cap-body" data-corners={hasCorners}>
        <span className="cap-top" aria-hidden="true" />
        {region("tap", { text: legend.tap, name: "When tapped" }, "hero-tap", <>
          <span ref={probe} className="cap-tap hero-fit-probe" aria-hidden="true" data-stretch={isCondensed(legend.tap) ? "condensed" : undefined} style={{ fontSize: size * tapFit.size }}>{print(legend.tap === "" ? "·" : legend.tap)}</span>
          <span ref={compactProbe} className="cap-tap hero-fit-probe" aria-hidden="true" data-stretch={isCondensed(shortTap) ? "condensed" : undefined} style={{ fontSize: size * shortFit.size }}>{print(shortTap)}</span>
          <span className="cap-tap" data-stretch={isCondensed(visibleTap) ? "condensed" : undefined} style={{ fontSize: size * visibleFit.size }}>{print(visibleTap === "" ? "·" : visibleTap)}</span>
        </>)}
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
        {region("tapThenHold", tapThenHold, "hero-corner hero-corner-start", <span aria-hidden="true">1×⇣</span>)}
        {region("doubleTap", doubleTap, "hero-corner hero-corner-end", <span aria-hidden="true">2×</span>)}
      </span>
      {draft ? <span className="cap-mark cap-mark-draft" aria-hidden="true" /> : null}
    </div>
    {needsCaption ? <p className="hero-source">When tapped: <span>{legend.tap}</span></p> : null}
    </>
  );
}
