import type { Layer } from "../../layout/schema.ts";

interface LayerTabsProps {
  layers: readonly Layer[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export function LayerTabs({ layers, selectedId, onSelect }: LayerTabsProps) {
  return (
    <div className="layer-tabs" role="tablist" aria-label="Layers">
      {layers.map((layer) => {
        const selected = layer.id === selectedId;
        return (
          <button
            key={layer.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={selected ? "layer-tab layer-tab-selected" : "layer-tab"}
            onClick={() => onSelect(layer.id)}
          >
            {layer.name}
          </button>
        );
      })}
    </div>
  );
}
