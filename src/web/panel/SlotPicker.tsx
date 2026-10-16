import { Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Binding, Layout } from "../../layout/schema.ts";
import type { LayerAction } from "../editor/draft.ts";
import { neighbour, type Direction } from "../keyboard/navigate.ts";
import { AnyField } from "./AnyField.tsx";
import { pickerSections, tabsFor, TAB_TITLE, type PickerItem, type PickerTab, type SlotName } from "./picker-items.ts";
import type { TapPick } from "./slots.ts";

interface Props {
  slot: SlotName;
  tab: PickerTab;
  onTab: (tab: PickerTab) => void;
  layout: Layout;
  layerId: string;
  /** The tap of a hold-tap takes keys only. */
  keysOnly: boolean;
  advanced: boolean;
  /** Item ids that are what the slot holds now, drawn selected. */
  selectedIds: ReadonlySet<string>;
  initialLayerAction: LayerAction;
  autoFocus: boolean;
  token: string;
  layoutRef: string;
  position: number;
  onPick: (pick: TapPick) => void;
  /** A whole binding read from the Any field. */
  onUseBinding: (binding: Binding) => void;
  /** The Macro tab's builder, which takes the place of the search and the tiles on that tab. */
  macroPane?: ReactNode;
}

const SLOT_TITLE: Record<SlotName, string> = { tap: "When tapped", hold: "When held", doubleTap: "When double-tapped", tapThenHold: "When tapped, then held" };

const ARROWS: Record<string, Direction> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

const LAYER_ACTIONS: readonly { value: LayerAction; label: string; hint: string }[] = [
  { value: "momentary", label: "Hold", hint: "On while the key is held" },
  { value: "toggle", label: "Toggle", hint: "Each press switches it on or off" },
  { value: "to", label: "Go to", hint: "Switches to it and turns the others off" },
  { value: "oneShot", label: "Once", hint: "For the next key press only" },
];

// One picker for every slot (D-087): search first, then category tabs and Any. Focus stays in the
// search box and the arrow keys move a cursor through the tiles (the ARIA combobox pattern over a
// listbox that doesn't pop up); Enter takes the tile under the cursor.
export function SlotPicker({
  slot, tab, onTab, layout, layerId, keysOnly, advanced, selectedIds, initialLayerAction, autoFocus, token, layoutRef, position, onPick, onUseBinding, macroPane,
}: Props) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [layerAction, setLayerAction] = useState<LayerAction>(initialLayerAction);
  const [cursor, setCursor] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const tabs = tabsFor(slot, keysOnly);

  const sections = useMemo(
    () => pickerSections({ text: query, tab, slot, keysOnly, layout, firmware: layout.firmware, layerId, layerAction }),
    [query, tab, slot, keysOnly, layout, layerId, layerAction],
  );
  const flat = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const searching = query.trim() !== "";
  const active = flat[cursor];
  const optionId = (item: PickerItem) => `${id}-${item.id}`;

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  // A new tab or search starts the cursor at the first tile, which is what Enter takes.
  useEffect(() => setCursor(0), [tab, query, layerAction]);

  useEffect(() => {
    const container = list.current;
    const tile = active === undefined ? null : container?.querySelector<HTMLElement>(`[id="${optionId(active)}"]`);
    if (container === null || container === undefined || tile === null || tile === undefined) return;
    const top = tile.offsetTop;
    if (top < container.scrollTop + 24) container.scrollTop = Math.max(0, top - 32);
    else if (top + tile.offsetHeight > container.scrollTop + container.clientHeight) container.scrollTop = top + tile.offsetHeight - container.clientHeight + 8;
    // optionId only closes over the stable id; the cursor tile is what moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  function move(direction: Direction): boolean {
    const tiles = [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const rects = tiles.map((tile) => {
      const box = tile.getBoundingClientRect();
      return { x: box.left, y: box.top, w: box.width, h: box.height, r: 0, rx: 0, ry: 0 };
    });
    const next = neighbour(rects, cursor, direction);
    if (next === null) return false;
    setCursor(next);
    return true;
  }

  function choose(item: PickerItem | undefined) {
    if (item === undefined || item.disabled === true) return;
    onPick(item.pick);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const target = event.currentTarget;
    if (event.key === "Enter") {
      // The picker's Enter takes a tile; the panel's Enter (apply) must not also fire.
      event.preventDefault();
      event.stopPropagation();
      choose(active);
      return;
    }
    if (event.key === "Escape" && query !== "") {
      // The first Escape clears the search; the next one leaves the picker.
      event.stopPropagation();
      setQuery("");
      return;
    }
    const direction = ARROWS[event.key];
    if (direction === undefined) return;
    const sideways = direction === "left" || direction === "right";
    // Left and right belong to the text caret until it reaches an end of the text.
    if (sideways && (target.selectionStart !== target.selectionEnd || (direction === "left" ? target.selectionStart !== 0 : target.selectionStart !== target.value.length))) return;
    event.preventDefault();
    if (!move(direction) && sideways) setCursor((current) => Math.min(flat.length - 1, Math.max(0, current + (direction === "right" ? 1 : -1))));
  }

  const title = SLOT_TITLE[slot];
  const layersShown = (tab === "layers" || searching) && tabs.includes("layers");
  const building = tab === "macro" && macroPane !== undefined;

  return (
    <div className="picker" data-slot={slot}>
      <label className="picker-search" hidden={building}>
        <span className="sr-only">Search keys for {title.toLowerCase()}</span>
        <Search size={16} aria-hidden="true" />
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={active === undefined ? undefined : optionId(active)}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          placeholder={slot === "hold" ? "Search modifiers and layers" : "Search, or press a key"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {query === "" ? null : (
          <button type="button" className="icon-button" aria-label="Clear search" onClick={() => { setQuery(""); input.current?.focus(); }}>
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </label>

      <div className="picker-tabs" role="tablist" aria-label="Categories">
        {tabs.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={!searching && tab === name}
            tabIndex={-1}
            className="picker-tab"
            // Mouse-down would pull focus out of the search box and end the keyboard flow.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuery("");
              onTab(name);
            }}
          >
            {TAB_TITLE[name]}
          </button>
        ))}
      </div>

      {building ? (
        macroPane
      ) : tab === "any" && !searching ? (
        <AnyField token={token} layoutRef={layoutRef} layout={layout} firmware={layout.firmware} position={position} autoFocus onUse={onUseBinding} />
      ) : (
        <>
          {layersShown && slot !== "hold" ? (
            <div className="layer-actions" role="radiogroup" aria-label="What the layer key does">
              {LAYER_ACTIONS.map((action) => (
                <button
                  key={action.value}
                  type="button"
                  role="radio"
                  aria-checked={layerAction === action.value}
                  title={action.hint}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setLayerAction(action.value)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
          <div ref={list} id={`${id}-list`} className="picker-list" role="listbox" aria-label={`${title} choices`} tabIndex={-1}>
            {sections.map((section) => (
              <div key={section.id} role="group" aria-label={section.title} className="picker-group">
                <h4 aria-hidden="true">{section.title}</h4>
                <div className="picker-tiles">
                  {section.items.map((item) => (
                    <div
                      key={item.id}
                      id={optionId(item)}
                      role="option"
                      aria-selected={selectedIds.has(item.id)}
                      aria-disabled={item.disabled === true}
                      className="picker-tile"
                      title={item.detail === undefined ? item.label : `${item.label}: ${item.detail}`}
                      data-cursor={item.id === active?.id}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        choose(item);
                        setCursor(flat.findIndex((candidate) => candidate.id === item.id));
                      }}
                    >
                      <span className="picker-tile-label">{item.label}</span>
                      {item.detail === undefined ? null : <span className="picker-tile-detail">{item.detail}</span>}
                      {advanced && item.code !== undefined ? <span className="picker-tile-code">{item.code}</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {sections.length === 0 ? (
              <p className="picker-empty">
                {searching ? <>No key matches &ldquo;{query}&rdquo;. Try its name, such as &ldquo;volume&rdquo;, or open the Any tab to type a firmware keycode.</> : tab === "dance" ? "This layout has no tap dances yet. Fill When double-tapped on a key to make one." : "Nothing here."}
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
