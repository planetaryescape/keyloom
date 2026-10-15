import type { BoardDefinition } from "../../boards/schema.ts";

export type Half = "left" | "right";

interface Props {
  value: Half;
  onChange: (half: Half) => void;
  hands: BoardDefinition["hands"];
}

// On a phone a split board shows one hand at a time (18#phones). A radio group gives the two halves the same
// keyboard behaviour as the theme toggle, and the board's swipe does the same job by touch.
export function HalfSwitcher({ value, onChange, hands }: Props) {
  return (
    <div className="half-switcher" role="radiogroup" aria-label="Which half of the keyboard to show">
      {(["left", "right"] as const).map((half) => (
        <button key={half} type="button" role="radio" aria-checked={value === half} onClick={() => onChange(half)}>
          {half === "left" ? "Left" : "Right"}
          <span className="half-count"> · {hands[half].length} keys</span>
        </button>
      ))}
    </div>
  );
}
