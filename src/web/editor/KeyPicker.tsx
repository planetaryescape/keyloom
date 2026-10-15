import { Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Firmware } from "../../layout/schema.ts";
import { neighbour, type Direction } from "../keyboard/navigate.ts";
import { firmwareName, searchKeys } from "./keysearch.ts";

interface KeyPickerProps {
  label: string;
  firmware: Firmware;
  /** The chosen key's keyloom name, or null when none is chosen yet. */
  value: string | null;
  onChange: (code: string) => void;
  /** Only keys a QMK mod-tap can tap (8-bit keycodes). Ignored for ZMK. */
  qmkBasicOnly?: boolean;
  autoFocus?: boolean;
}

const ARROWS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

// A search box over an always-open listbox of key tiles (the ARIA combobox pattern with a
// listbox that doesn't pop up). Focus stays in the box; the arrow keys move a cursor through the
// tiles, and Enter takes the one under it.
export function KeyPicker({ label, firmware, value, onChange, qmkBasicOnly = false, autoFocus = false }: KeyPickerProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const groups = useMemo(
    () => searchKeys({ text: query, firmware, qmkBasicOnly }),
    [query, firmware, qmkBasicOnly],
  );
  const flat = useMemo(() => groups.flatMap((group) => group.keys), [groups]);
  const [cursor, setCursor] = useState(() => Math.max(0, flat.findIndex((key) => key.name === value)));
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const optionId = (name: string) => `${id}-${name}`;
  const active = flat[cursor];

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  // On open, the chosen key's whole group is brought to the top, so it reads as a row of tiles
  // under its heading and not a slice. Inside the list only: scrollIntoView would move the page too.
  useEffect(() => {
    const container = list.current;
    const tile = value === null ? null : container?.querySelector<HTMLElement>(`[id="${optionId(value)}"]`);
    const group = tile?.closest<HTMLElement>(".picker-group");
    if (container !== null && container !== undefined && group !== null && group !== undefined) {
      container.scrollTop = group.offsetTop;
    }
    // Only on mount: later changes of `value` come from the person's own clicks, which are in view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the cursor tile in view as the arrow keys move it.
  useEffect(() => {
    const container = list.current;
    const tile = active === undefined ? null : container?.querySelector<HTMLElement>(`[id="${optionId(active.name)}"]`);
    if (container === null || container === undefined || tile === null || tile === undefined) return;
    // The list is the tiles' offset parent, so offsetTop is already measured inside it.
    const top = tile.offsetTop;
    if (top < container.scrollTop + 28) container.scrollTop = Math.max(0, top - 36);
    else if (top + tile.offsetHeight > container.scrollTop + container.clientHeight) {
      container.scrollTop = top + tile.offsetHeight - container.clientHeight + 8;
    }
  }, [active?.name]);

  function search(text: string) {
    setQuery(text);
    // The best match leads, so Enter after typing takes it.
    setCursor(0);
  }

  function move(direction: Direction): boolean {
    const tiles = [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    // Reuses the board's arrow-key rule: the nearest tile that is clearly ahead.
    const rects = tiles.map((tile) => {
      const box = tile.getBoundingClientRect();
      return { x: box.left, y: box.top, w: box.width, h: box.height, r: 0, rx: 0, ry: 0 };
    });
    const next = neighbour(rects, cursor, direction);
    if (next === null) return false;
    setCursor(next);
    return true;
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const target = event.currentTarget;
    if (event.key === "Enter") {
      event.preventDefault();
      if (active !== undefined) onChange(active.name);
      return;
    }
    if (event.key === "Escape" && query !== "") {
      // The first Escape clears the search; the editor closes only on the next one.
      event.stopPropagation();
      search("");
      return;
    }
    const direction = ARROWS[event.key];
    if (direction === undefined) return;
    const sideways = direction === "left" || direction === "right";
    // Left and right belong to the text caret until it reaches an end of the text.
    if (sideways && (target.selectionStart !== target.selectionEnd || (direction === "left" ? target.selectionStart !== 0 : target.selectionStart !== target.value.length))) {
      return;
    }
    event.preventDefault();
    if (!move(direction) && sideways) {
      setCursor((current) => Math.min(flat.length - 1, Math.max(0, current + (direction === "right" ? 1 : -1))));
    }
  }

  return (
    <div className="picker">
      <label className="picker-search">
        <span className="sr-only">{label}</span>
        <Search size={16} aria-hidden="true" />
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={active === undefined ? undefined : optionId(active.name)}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          placeholder={`${label}: try enter, f17 or volume`}
          value={query}
          onChange={(event) => search(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {query === "" ? null : (
          <button type="button" className="icon-button" aria-label="Clear search" onClick={() => { search(""); input.current?.focus(); }}>
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </label>
      <div ref={list} id={`${id}-list`} className="picker-list" role="listbox" aria-label={label} tabIndex={-1}>
        {groups.map((group) => (
          <div key={group.id} role="group" aria-label={group.title} className="picker-group">
            <h4 aria-hidden="true">{group.title}</h4>
            <div className="picker-tiles">
              {group.keys.map((key) => (
                <div
                  key={key.name}
                  id={optionId(key.name)}
                  role="option"
                  aria-selected={key.name === value}
                  className="picker-tile"
                  title={`${key.label} (${firmwareName(key, firmware)})`}
                  data-cursor={key.name === active?.name}
                  // Mouse-down would pull focus out of the search box and end the keyboard flow.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(key.name);
                    setCursor(flat.findIndex((candidate) => candidate.name === key.name));
                  }}
                >
                  <span className="picker-tile-label">{key.label}</span>
                  <span className="picker-tile-code">{firmwareName(key, firmware)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 ? (
          <p className="picker-empty">
            No key matches &ldquo;{query}&rdquo;. Try its label (Enter), a firmware code (KC_ENT) or a group (media).
          </p>
        ) : null}
      </div>
    </div>
  );
}
