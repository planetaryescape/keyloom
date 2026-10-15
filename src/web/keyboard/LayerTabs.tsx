import { Plus } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { Slot } from "../../layout/change.ts";
import { countKind, layerColorOf, layerReferences, niceLayerName } from "../../layout/layer-ops.ts";
import type { Layout } from "../../layout/schema.ts";
import type { ChangeOutcome } from "../editor/useChange.ts";
import { DeleteLayerDialog } from "../layers/DeleteLayerDialog.tsx";
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
  /** Absent while the layout can't be changed from here. */
  actions?: LayerActions;
  /** The layer whose name is being edited; the owner sets it so a new layer opens with its name ready. */
  renamingId: string | null;
  onRenaming: (id: string | null) => void;
}

export function LayerTabs({ layout, selectedId, onSelect, marked, actions, renamingId, onRenaming }: LayerTabsProps) {
  const layers = layout.layers;
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const selectedIndex = Math.max(0, layers.findIndex((layer) => layer.id === selectedId));
  const selected = layers[selectedIndex];

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
      <div className="layer-tabs" role="tablist" aria-label="Layers">
        {layers.map((layer, index) => {
          const isSelected = layer.id === selectedId;
          const dot = <span className="layer-dot" aria-hidden="true" style={{ background: `var(--layer-${layerColorOf(layers, index)})` }} />;
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
              title={isSelected && actions !== undefined ? "Click again to rename" : undefined}
              draggable={draggable}
              onClick={() => (isSelected && actions !== undefined && actions.blockedReason === null ? onRenaming(layer.id) : onSelect(layer.id))}
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
              {dot}
              {niceLayerName(layer.name)}
              {isSelected ? <span className="layer-tab-label" aria-hidden="true">{layer.shortLabel ?? ""}</span> : null}
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
            <LayerMenu
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
            />
          )}
        </div>
      )}
      {deleting === null || actions === undefined ? null : (
        <DeleteLayerDialog
          layerName={niceLayerName(layers.find((layer) => layer.id === deleting)?.name ?? "this layer")}
          references={layerReferences(layout, deleting)}
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
