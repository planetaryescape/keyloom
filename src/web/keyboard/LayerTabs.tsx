import { useRef, type KeyboardEvent } from "react";
import type { Layer } from "../../layout/schema.ts";

interface LayerTabsProps {
  layers: readonly Layer[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export function LayerTabs({ layers, selectedId, onSelect }: LayerTabsProps) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

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

  return (
    <div className="layer-tabs" role="tablist" aria-label="Layers">
      {layers.map((layer, index) => {
        const selected = layer.id === selectedId;
        return (
          <button
            key={layer.id}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="layer-tab"
            onClick={() => onSelect(layer.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {layer.name}
          </button>
        );
      })}
    </div>
  );
}
