import type { Mod } from "../../layout/schema.ts";

const SIDES: readonly { side: string; mods: readonly { mod: Mod; label: string }[] }[] = [
  {
    side: "Left",
    mods: [
      { mod: "LCTL", label: "Ctrl" },
      { mod: "LSFT", label: "Shift" },
      { mod: "LALT", label: "Alt" },
      { mod: "LGUI", label: "GUI" },
    ],
  },
  {
    side: "Right",
    mods: [
      { mod: "RCTL", label: "Ctrl" },
      { mod: "RSFT", label: "Shift" },
      { mod: "RALT", label: "Alt" },
      { mod: "RGUI", label: "GUI" },
    ],
  },
];

interface Props {
  legend: string;
  mods: readonly Mod[];
  onToggle: (mod: Mod) => void;
}

// Eight independent toggles, so Shift+1 stays one key with a modifier and never becomes a macro.
export function ModifierToggles({ legend, mods, onToggle }: Props) {
  return (
    <fieldset className="field-group">
      <legend>{legend}</legend>
      <div className="mod-sides">
        {SIDES.map(({ side, mods: sideMods }) => (
          <div key={side} className="mod-side" role="group" aria-label={`${side} modifiers`}>
            <span className="mod-side-name" aria-hidden="true">
              {side}
            </span>
            {sideMods.map(({ mod, label }) => (
              <button
                key={mod}
                type="button"
                className="toggle"
                aria-pressed={mods.includes(mod)}
                aria-label={`${side} ${label}`}
                title={label === "GUI" ? "GUI is Command on a Mac and the Windows key elsewhere" : undefined}
                onClick={() => onToggle(mod)}
              >
                {label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </fieldset>
  );
}
