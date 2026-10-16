import type { Mod } from "../../layout/schema.ts";

// The four modifiers, in Apple's order, as one toggle each (23#the-key-card). Either side's counts as on; the left one is added. Advanced
// view keeps the eight side-by-side toggles for people who need a specific side.
const CARD_MODS: readonly { mark: string; left: Mod; right: Mod; word: string }[] = [
  { mark: "⌘", left: "LGUI", right: "RGUI", word: "Command" },
  { mark: "⌥", left: "LALT", right: "RALT", word: "Option" },
  { mark: "⌃", left: "LCTL", right: "RCTL", word: "Control" },
  { mark: "⇧", left: "LSFT", right: "RSFT", word: "Shift" },
];

export function CardMods({ mods, onToggle, label, row = false }: { mods: readonly Mod[]; onToggle: (mod: Mod) => void; label: string; row?: boolean }) {
  return (
    <div className="card-mods" data-row={row} role="group" aria-label={label}>
      {CARD_MODS.map(({ mark, left, right, word }) => (
        <button
          key={mark}
          type="button"
          className="card-mod"
          aria-pressed={mods.includes(left) || mods.includes(right)}
          aria-label={word}
          title={word}
          onClick={() => onToggle(mods.includes(right) ? right : left)}
        >
          {mark}
        </button>
      ))}
    </div>
  );
}
