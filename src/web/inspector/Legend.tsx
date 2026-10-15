import { Cap, type Tone } from "../keyboard/Cap.tsx";
import "./inspector.css";

interface Entry {
  tone: Tone;
  tap: string;
  hold?: string;
  name: string;
  note: string;
  combo?: boolean;
}

function entries(firmware: string): Entry[] {
  return [
    { tone: "key", tap: "A", name: "Key", note: "Sends one key" },
    { tone: "modifier", tap: "⇧", name: "Modifier", note: "Held while pressed" },
    { tone: "holdTap", tap: "S", hold: "⌥", name: "Hold-tap", note: "Tap and hold do different things" },
    { tone: "layer", tap: "L1", hold: "hold", name: "Layer", note: "Switches layer" },
    { tone: "macro", tap: "M0", hold: "macro", name: "Macro", note: "Runs a sequence of keys" },
    {
      tone: "native",
      tap: "TD0",
      name: "Native",
      note: `A ${firmware.toUpperCase()} code keyloom passes through`,
    },
    { tone: "transparent", tap: "A", name: "Transparent", note: "Uses the key beneath it, shown faded" },
    { tone: "key", tap: "D", name: "Combo", note: "Pressed together with another key", combo: true },
  ];
}

const GLYPHS: readonly (readonly [string, string])[] = [
  ["⌃", "Ctrl"],
  ["⌥", "Alt"],
  ["⇧", "Shift"],
  ["⌘", "GUI"],
  ["r", "right-hand"],
  ["Hyp", "⌃⇧⌥⌘"],
  ["Meh", "⌃⇧⌥"],
];

export function Legend({ firmware }: { firmware: string }) {
  return (
    <footer className="legend" aria-label="Legend">
      <ul className="legend-list">
        {entries(firmware).map((entry) => (
          <li key={entry.name} className="legend-item">
            <Cap
              as="span"
              tone={entry.tone}
              legend={{ tap: entry.tap, ...(entry.hold === undefined ? {} : { hold: entry.hold }) }}
              unit={36}
              width={1}
              combo={entry.combo === true}
              style={{ width: 32, height: 32 }}
            />
            <span className="legend-name">
              {entry.name}
              <span className="sr-only">: {entry.note}</span>
            </span>
          </li>
        ))}
      </ul>
      <dl className="glyphs">
        {GLYPHS.map(([glyph, meaning]) => (
          <div key={glyph}>
            <dt>{glyph}</dt>
            <dd>{meaning}</dd>
          </div>
        ))}
      </dl>
    </footer>
  );
}
