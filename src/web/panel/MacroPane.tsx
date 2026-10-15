import { ArrowDown, ArrowUp, Check, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Layout, Macro, Mod } from "../../layout/schema.ts";
import { looksLikeSecret } from "../../layout/secret.ts";
import { tapText } from "../../layout/render-grid.ts";
import { firmwareName, searchKeys } from "../editor/keysearch.ts";
import { macroUsers } from "./change-ops.ts";
import {
  addKey, addText, builderFromMacro, emptyBuilder, generatedName, moveStep, parseChordQuery, removeStep, rename, setStepMods, setWait, summary, toMacro, type Builder,
} from "./macro-builder.ts";

interface Props {
  layout: Layout;
  /** The key being edited, so "every key that uses it" leaves it out of the count. */
  layerId: string;
  position: number;
  /** The macro this slot holds now; the pane opens on it. */
  currentMacroId: string | null;
  /** Macros made in this panel and not saved yet. */
  pending: readonly Macro[];
  autoFocus: boolean;
  /** Done: the macro to put in the slot and save with the change. */
  onDone: (macro: Macro) => void;
  /** A macro from the library, used as it is. */
  onUse: (macroId: string) => void;
}

const MODS: readonly { mod: Mod; glyph: string; word: string }[] = [
  { mod: "LCTL", glyph: "⌃", word: "Control" },
  { mod: "LSFT", glyph: "⇧", word: "Shift" },
  { mod: "LALT", glyph: "⌥", word: "Option" },
  { mod: "LGUI", glyph: "⌘", word: "Command" },
];

const SHOWN = 18;

// The Macro tab (16#macros-are-made-in-the-picker-and-each-pick-adds-a-step, D-088). A pick adds a step and the
// search stays open, so a three-key macro is: the Macros tab, three picks, Done. A chord is one pick when it is
// typed ("cmd tab"), and the modifier buttons above the search are there for the mouse.
export function MacroPane({ layout, layerId, position, currentMacroId, pending, autoFocus, onDone, onUse }: Props) {
  const id = useId();
  const known = (macroId: string | null) => (macroId === null ? undefined : (pending.find((m) => m.id === macroId) ?? layout.macros.find((m) => m.id === macroId)));
  const start = known(currentMacroId);
  const opened = start === undefined ? null : builderFromMacro(start);
  const [builder, setBuilder] = useState<Builder>(opened ?? emptyBuilder());
  // A macro with press or release steps is shown in words and used as it is.
  const readOnly = start !== undefined && opened === null;
  const [mods, setMods] = useState<readonly Mod[]>([]);
  const [query, setQuery] = useState("");
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [asking, setAsking] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (autoFocus) search.current?.focus();
  }, [autoFocus]);

  const chord = useMemo(() => parseChordQuery(query), [query]);
  const allMods = useMemo(() => [...new Set([...mods, ...chord.mods])], [mods, chord.mods]);
  const keys = useMemo(
    () => (chord.rest === "" ? [] : searchKeys({ text: chord.rest, firmware: layout.firmware, qmkBasicOnly: false }).flatMap((group) => group.keys).slice(0, SHOWN)),
    [chord.rest, layout.firmware],
  );
  useEffect(() => setCursor(0), [chord.rest]);

  const slotRef = { layerId, position };
  const original = known(builder.id);
  const others = builder.id === null ? [] : macroUsers(layout, builder.id, slotRef);
  const done = toMacro(builder, layout, pending);
  const edited = original !== undefined && done !== null && JSON.stringify({ name: done.name, steps: done.steps }) !== JSON.stringify({ name: original.name, steps: original.steps });
  const secret = builder.steps.some((step) => step.kind === "text" && looksLikeSecret(step.text));

  function addPick(code: string) {
    setBuilder((b) => addKey(b, code, allMods));
    setQuery("");
    search.current?.focus();
    // The new step scrolls into view at the end of the list.
    window.requestAnimationFrame(() => list.current?.lastElementChild?.scrollIntoView({ block: "nearest" }));
  }

  function finish(forAll: boolean) {
    const macro = toMacro(builder, layout, pending, forAll || builder.id === null ? builder.id : null);
    if (macro !== null) onDone(macro);
  }

  function onDoneClick() {
    if (done === null) return;
    // Changing a macro other keys use asks first; a new one, or one only this key uses, doesn't.
    if (builder.id !== null && edited && others.length > 0) setAsking(true);
    else finish(true);
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const key = keys[cursor];
      if (key !== undefined) addPick(key.name);
      else if (query.trim() === "" && done !== null) onDoneClick();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.min(keys.length - 1, Math.max(0, c + (event.key === "ArrowDown" ? 1 : -1))));
    }
    if (event.key === "Escape" && query !== "") {
      event.stopPropagation();
      setQuery("");
    }
  }

  const toggle = (mod: Mod) => setMods((previous) => (previous.includes(mod) ? previous.filter((m) => m !== mod) : [...previous, mod]));
  const generated = generatedName(builder.steps);

  return (
    <div className="macro-pane" role="group" aria-label="Build a macro">
      {readOnly && start !== undefined ? (
        <div className="macro-readonly">
          <p className="form-note">This macro presses and releases keys, which the builder can&apos;t edit yet. Edit it from the CLI, or use it as it is.</p>
          <button type="button" className="button button-primary" onClick={() => onUse(start.id)}>
            Use {start.name}
          </button>
        </div>
      ) : (
        <>
          <div className="macro-add">
            <div className="macro-mods" role="group" aria-label="Modifiers for the next key">
              {MODS.map(({ mod, glyph, word }) => (
                <button key={mod} type="button" className="toggle" aria-pressed={allMods.includes(mod)} aria-label={word} title={word} onMouseDown={(event) => event.preventDefault()} onClick={() => toggle(mod)}>
                  {glyph}
                </button>
              ))}
            </div>
            <label className="picker-search">
              <span className="sr-only">Add a key to the macro</span>
              <Search size={16} aria-hidden="true" />
              <input
                ref={search}
                type="text"
                role="combobox"
                aria-expanded={keys.length > 0}
                aria-controls={`${id}-keys`}
                aria-autocomplete="list"
                autoComplete="off"
                spellCheck={false}
                placeholder="Add a key: c, tab, cmd v"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onSearchKey}
              />
            </label>
          </div>
          {keys.length === 0 ? null : (
            <div id={`${id}-keys`} className="macro-keys" role="listbox" aria-label="Keys to add">
              {keys.map((key, index) => (
                <div
                  key={key.name}
                  role="option"
                  aria-selected={index === cursor}
                  className="picker-tile"
                  data-cursor={index === cursor}
                  title={`${tapText(key.name, allMods)}: ${firmwareName(key, layout.firmware)}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addPick(key.name)}
                >
                  <span className="picker-tile-label">{tapText(key.name, allMods)}</span>
                </div>
              ))}
            </div>
          )}
          <form
            className="macro-text"
            onSubmit={(event) => {
              event.preventDefault();
              setBuilder((b) => addText(b, text));
              setText("");
            }}
          >
            <label>
              <span className="macro-text-label">Type text</span>
              <input type="text" value={text} spellCheck={false} autoComplete="off" placeholder="git status" onChange={(event) => setText(event.target.value)} />
            </label>
            <button type="submit" className="button" disabled={text === ""}>Add</button>
          </form>

          {builder.steps.length === 0 ? null : (
            <ol ref={list} className="macro-steps" aria-label="Steps">
              {builder.steps.map((step, index) => (
                <li key={`${index}-${step.kind}`} className="macro-step">
                  <span className="macro-step-n" aria-hidden="true">{index + 1}</span>
                  <span className="macro-step-what">
                    {step.kind === "text" ? <>Type <q>{step.text}</q></> : tapText(step.code, step.mods)}
                  </span>
                  {step.kind === "key" ? (
                    <span className="macro-step-mods" role="group" aria-label={`Modifiers of step ${index + 1}`}>
                      {MODS.map(({ mod, glyph, word }) => (
                        <button
                          key={mod}
                          type="button"
                          className="toggle"
                          aria-pressed={step.mods.includes(mod)}
                          aria-label={`${word} on step ${index + 1}`}
                          title={word}
                          onClick={() => setBuilder((b) => setStepMods(b, index, step.mods.includes(mod) ? step.mods.filter((m) => m !== mod) : [...step.mods, mod]))}
                        >
                          {glyph}
                        </button>
                      ))}
                    </span>
                  ) : null}
                  <label className="macro-wait">
                    <span>wait</span>
                    <input
                      type="number"
                      min={0}
                      step={10}
                      inputMode="numeric"
                      value={step.waitMs === 0 ? "" : step.waitMs}
                      placeholder="0"
                      aria-label={`Wait after step ${index + 1}, in milliseconds`}
                      onChange={(event) => setBuilder((b) => setWait(b, index, event.target.valueAsNumber))}
                    />
                    <span>ms</span>
                  </label>
                  <span className="macro-step-actions">
                    <button type="button" className="icon-button" aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => setBuilder((b) => moveStep(b, index, -1))}>
                      <ArrowUp size={14} aria-hidden="true" />
                    </button>
                    <button type="button" className="icon-button" aria-label={`Move step ${index + 1} down`} disabled={index === builder.steps.length - 1} onClick={() => setBuilder((b) => moveStep(b, index, 1))}>
                      <ArrowDown size={14} aria-hidden="true" />
                    </button>
                    <button type="button" className="icon-button" aria-label={`Delete step ${index + 1}`} onClick={() => setBuilder((b) => removeStep(b, index))}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="macro-summary" aria-live="polite">{summary(builder.steps)}</p>
          {secret ? (
            <p className="blocked macro-secret" role="alert">
              This text looks like a password. Anyone with your keyboard could replay it.
            </p>
          ) : null}

          {builder.steps.length === 0 ? null : (
            <label className="macro-name">
              <span>Name</span>
              <input type="text" value={builder.nameTouched ? builder.name : ""} placeholder={generated} maxLength={80} onChange={(event) => setBuilder((b) => rename(b, event.target.value))} />
            </label>
          )}

          {asking ? (
            <div className="macro-ask" role="group" aria-label="Who changes">
              <p>
                {others.length} other {others.length === 1 ? "key uses" : "keys use"} this macro. Change it for this key only, or for every key that uses it?
              </p>
              <div className="macro-ask-actions">
                <button type="button" className="button button-primary" onClick={() => finish(false)}>This key only</button>
                <button type="button" className="button" onClick={() => finish(true)}>Every key that uses it</button>
                <button type="button" className="button" onClick={() => setAsking(false)}>Keep editing</button>
              </div>
            </div>
          ) : (
            <div className="macro-foot">
              <button type="button" className="button button-primary" disabled={done === null} onClick={onDoneClick}>
                <Check size={14} aria-hidden="true" />
                Done
              </button>
            </div>
          )}
        </>
      )}

      {layout.macros.length === 0 ? null : (
        <div className="macro-library">
          <h4>From library</h4>
          <ul>
            {layout.macros.map((macro) => (
              <li key={macro.id}>
                <button
                  type="button"
                  className="macro-library-item"
                  title="Use this macro on the key"
                  onClick={() => onUse(macro.id)}
                >
                  <span>{macro.name}</span>
                  <span className="muted">{macro.steps.length} {macro.steps.length === 1 ? "step" : "steps"}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
