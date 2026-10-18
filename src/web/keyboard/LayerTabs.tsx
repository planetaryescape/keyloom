import { Plus } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { ChangeOp, Slot } from "../../layout/change.ts";
import { countKind, layerReferences, niceLayerName } from "../../layout/layer-ops.ts";
import type { Layout } from "../../layout/schema.ts";
import type { GeometryKey } from "../../boards/schema.ts";
import { boardBounds } from "./geometry.ts";
import type { ChangeOutcome } from "../editor/useChange.ts";
import { DeleteLayerDialog } from "../layers/DeleteLayerDialog.tsx";
import { alsoOnWords, goingWithLayer, turnedOnBy } from "../layers/conditional-ops.ts";
import { LayerMenu } from "../layers/LayerMenu.tsx";
import "../layers/layers.css";

/** What the tabs can do to the layout; each one is a single change set (D-090). */
export interface LayerActions {
  /** Why layer changes are off right now (a key's draft is open), or null. */
  blockedReason: string | null;
  add: () => void;
  rename: (layerId: string, name: string) => void;
  duplicate: (layerId: string) => void;
  move: (layerId: string, toIndex: number) => void;
  style: (layerId: string, label: string | null, color: number | null) => void;
  convert: (layerId: string, from: "transparent" | "none", to: "transparent" | "none") => void;
  remove: (layerId: string, drops: readonly string[]) => Promise<ChangeOutcome>;
  /** Changes the conditional layers; the outcome comes back so the menu can show a refusal where the person made the choice. */
  condition: (ops: ChangeOp[], summary: string) => Promise<ChangeOutcome>;
  nameFunction: (fn: string) => string;
  openKey: (slot: Slot) => void;
  notify: (message: string) => void;
}

interface LayerTabsProps {
  layout: Layout;
  selectedId: string;
  onSelect: (id: string) => void;
  /** Layers that carry a mark from the previewed proposal while another layer is showing. */
  marked?: ReadonlySet<string>;
  /** Layers a board review problem is about (D-340): a rose dot on the tab. */
  reviewed?: ReadonlySet<string>;
  /** Absent while the layout can't be changed from here. */
  actions?: LayerActions;
  /** The layer whose name is being edited; the owner sets it so a new layer opens with its name ready. */
  renamingId: string | null;
  onRenaming: (id: string | null) => void;
  /** The board's keys, display rotation applied, for each layer's lit miniature. */
  keys?: readonly GeometryKey[];
  /** Each layer's light (a CSS colour) or null, by layer index. */
  lights?: readonly (string | null)[];
  /** Each layer's LED colour by key position, or null for a layer that sets none. */
  leds?: readonly (readonly (string | null)[] | null)[];
}

// One layer as a small lit board (23#the-layer-strip): its own keys bright, keys that pass through faint, lit keys in their LED colour.
function Miniature({ keys, layer, leds }: { keys: readonly GeometryKey[]; layer: Layout["layers"][number]; leds: readonly (string | null)[] | null }) {
  const b = boardBounds(keys);
  const pad = 0.3;
  return (
    <svg className="film-mini" viewBox={`${b.minX - pad} ${b.minY - pad} ${b.width + 2 * pad} ${b.height + 2 * pad}`} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      {keys.map((key, i) => {
        const binding = layer.bindings[i];
        const blank = binding === undefined || binding.kind === "transparent" || binding.kind === "none";
        const led = leds?.[i] ?? null;
        return (
          <rect
            key={i}
            x={key.x + 0.09}
            y={key.y + 0.09}
            width={key.w - 0.18}
            height={key.h - 0.18}
            rx={0.2}
            transform={key.r === 0 ? undefined : `rotate(${key.r} ${key.rx} ${key.ry})`}
            fill={led ?? "currentColor"}
            fillOpacity={led !== null ? (blank ? 0.55 : 1) : blank ? 0.16 : 0.6}
          />
        );
      })}
    </svg>
  );
}

export function LayerTabs({ layout, selectedId, onSelect, marked, reviewed, actions, renamingId, onRenaming, keys, lights, leds }: LayerTabsProps) {
  const layers = layout.layers;
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const menuButton = useRef<HTMLSpanElement>(null);
  const selectedIndex = Math.max(0, layers.findIndex((layer) => layer.id === selectedId));
  const selected = layers[selectedIndex];
  const lightOf = (layerId: string): string | null => lights?.[layers.findIndex((l) => l.id === layerId)] ?? null;

  // The chosen layer's tab is always in sight where the strip scrolls (a phone, a narrow stage): whatever chose it, a tab, a key press
  // that found its layer, a board switch or an arrival. Smooth, or at once when motion is reduced.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = strip.current;
    const tab = tabs.current[selectedIndex];
    if (row === null || tab === null || tab === undefined || row.scrollWidth <= row.clientWidth) return;
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    tab.scrollIntoView({ inline: "nearest", block: "nearest", behavior: reduced ? "instant" : "smooth" });
  }, [selectedId, selectedIndex, layers.length]);

  // Arrow keys move between tabs and select as they go, as the tablist pattern asks.
  function onKeyDown(event: KeyboardEvent, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const last = layers.length - 1;
    const target =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : step === 0
            ? null
            : (index + step + layers.length) % layers.length;
    if (target === null) return;
    event.preventDefault();
    const layer = layers[target];
    if (layer === undefined) return;
    onSelect(layer.id);
    tabs.current[target]?.focus();
  }

  function onDrop(event: DragEvent, toIndex: number) {
    event.preventDefault();
    const id = dragId;
    setDragId(null);
    setOverIndex(null);
    if (id !== null && actions !== undefined) actions.move(id, toIndex);
  }

  return (
    <div className="layer-tabs-wrap">
      <div ref={strip} className="layer-tabs" role="tablist" aria-label="Layers">
        {layers.map((layer, index) => {
          const isSelected = layer.id === selectedId;
          const light = lights?.[index] ?? null;
          const dot = <span className="layer-dot" data-unlit={light === null} aria-hidden="true" style={light === null ? undefined : { background: light, boxShadow: `0 0 7px ${light}` }} />;
          if (renamingId === layer.id && actions !== undefined) {
            return (
              <RenameField
                key={layer.id}
                name={layer.name}
                dot={dot}
                onSave={(name) => {
                  onRenaming(null);
                  if (name !== layer.name) actions.rename(layer.id, name);
                  tabs.current[index]?.focus();
                }}
                onCancel={() => onRenaming(null)}
              />
            );
          }
          const draggable = actions !== undefined && index > 0 && actions.blockedReason === null;
          // A layer two others turn on shows their two lights beside its name; the sentence is its name to a screen reader, and the
          // caption says it in full once the layer is chosen (D-389).
          const pair = turnedOnBy(layout, layer.id)[0];
          const also = alsoOnWords(layout, layer.id);
          return (
            <button
              key={layer.id}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              type="button"
              role="tab"
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              className="layer-tab"
              data-dragging={dragId === layer.id}
              data-drop={dragId !== null && overIndex === index && dragId !== layer.id}
              data-review={reviewed?.has(layer.id) ? "problem" : undefined}
              // The full name, since a narrow strip ends it in an ellipsis (D-338).
              title={isSelected && actions !== undefined ? `${niceLayerName(layer.name)}. Click again to rename. Right-click for the layer's actions.` : niceLayerName(layer.name)}
              aria-label={also === null ? undefined : `${niceLayerName(layer.name)}, ${also}`}
              draggable={draggable}
              onClick={() => (isSelected && actions !== undefined && actions.blockedReason === null ? onRenaming(layer.id) : onSelect(layer.id))}
              onContextMenu={(event) => {
                if (actions === undefined) return;
                // Right-click a layer for its actions: it becomes the selected layer, and its menu opens.
                event.preventDefault();
                onSelect(layer.id);
                window.requestAnimationFrame(() => menuButton.current?.querySelector<HTMLButtonElement>("button")?.click());
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
              onDragStart={(event) => {
                setDragId(layer.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", layer.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverIndex(null);
              }}
              onDragOver={(event) => {
                // The base layer stays first, so no tab accepts a drop at index 0.
                if (dragId === null || index === 0) return;
                event.preventDefault();
                setOverIndex(index);
              }}
              onDrop={(event) => onDrop(event, index)}
            >
              {keys === undefined || keys.length === 0 ? null : <Miniature keys={keys} layer={layer} leds={leds?.[index] ?? null} />}
              <span className="layer-tab-name">
                {dot}
                <span className="layer-tab-text">{niceLayerName(layer.name)}</span>
                {pair === undefined ? null : (
                  <span className="layer-pair" aria-hidden="true">
                    {pair.layerIds.map((id) => {
                      const l = lightOf(id);
                      return <i key={id} data-unlit={l === null} style={l === null ? undefined : { background: l }} />;
                    })}
                  </span>
                )}
                {index < 9 ? <span className="layer-tab-key" aria-hidden="true">{index + 1}</span> : null}
              </span>
              {marked?.has(layer.id) && !isSelected ? (
                <>
                  <span className="layer-tab-mark" aria-hidden="true" />
                  <span className="sr-only"> (has keys in the proposal)</span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
      {actions === undefined ? null : (
        <div className="layer-tab-actions">
          <button type="button" className="icon-button" aria-label="Add a layer" title="Add a transparent layer" disabled={actions.blockedReason !== null} onClick={actions.add}>
            <Plus size={16} aria-hidden="true" />
          </button>
          {selected === undefined ? null : (
            <span ref={menuButton} className="layer-menu-slot">
            <LayerMenu
              layout={layout}
              layers={layers}
              index={selectedIndex}
              transparentCount={countKind(selected, "transparent")}
              noneCount={countKind(selected, "none")}
              disabledReason={actions.blockedReason}
              onRename={() => onRenaming(selected.id)}
              onDuplicate={() => actions.duplicate(selected.id)}
              onMove={(toIndex) => actions.move(selected.id, toIndex)}
              onStyle={(label, color) => actions.style(selected.id, label, color)}
              onConvert={(from, to) => actions.convert(selected.id, from, to)}
              onDelete={() => setDeleting(selected.id)}
              onCondition={actions.condition}
              lightOf={lightOf}
            />
            </span>
          )}
        </div>
      )}
      {deleting === null || actions === undefined ? null : (
        <DeleteLayerDialog
          layerName={niceLayerName(layers.find((layer) => layer.id === deleting)?.name ?? "this layer")}
          references={layerReferences(layout, deleting)}
          goesWith={goingWithLayer(layout, deleting)}
          onDelete={(drops) => actions.remove(deleting, drops)}
          nameFunction={actions.nameFunction}
          onOpenKey={actions.openKey}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

// Enter saves, Escape cancels; leaving the field saves too, so a click elsewhere doesn't lose a typed name.
function RenameField({ name, dot, onSave, onCancel }: { name: string; dot: React.ReactNode; onSave: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const trimmed = value.trim();
    if (save && trimmed !== "") onSave(trimmed);
    else onCancel();
  };
  return (
    <form
      className="layer-tab layer-tab-edit"
      onSubmit={(event) => {
        event.preventDefault();
        finish(true);
      }}
    >
      {dot}
      <input
        ref={input}
        value={value}
        aria-label="Layer name"
        maxLength={40}
        size={Math.max(6, Math.min(value.length + 1, 24))}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          }
        }}
      />
    </form>
  );
}
