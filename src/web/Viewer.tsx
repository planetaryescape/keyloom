import { useMemo, useState } from "react";
import type { GeometryKey } from "../boards/schema.ts";
import type { LayoutDetail } from "../api/http.ts";
import { describeKey, type KeyDescription } from "../layout/describe.ts";
import { Inspector } from "./inspector/Inspector.tsx";
import { Legend } from "./inspector/Legend.tsx";
import { Keyboard } from "./keyboard/Keyboard.tsx";
import { LayerTabs } from "./keyboard/LayerTabs.tsx";

interface ViewerProps {
  detail: LayoutDetail;
  /** Geometry with the board's display rotation already applied. */
  keys: readonly GeometryKey[];
}

// The selected key survives a layer change, so flipping layers shows what the same key does on each.
export function Viewer({ detail, keys }: ViewerProps) {
  const { document: layout, board } = detail;
  const [layerId, setLayerId] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const layerIndex = Math.max(
    0,
    layout.layers.findIndex((candidate) => candidate.id === layerId),
  );
  const layer = layout.layers[layerIndex];

  const descriptions = useMemo(
    () => keys.map((_, index) => describeKey(layout, layerIndex, index)),
    [layout, layerIndex, keys],
  );

  const inspected = hovered ?? selected;
  const description: KeyDescription | null = inspected === null ? null : (descriptions[inspected] ?? null);

  const { partners, comboKeys } = useMemo(() => {
    const active = layout.combos.filter(
      (combo) => combo.layerIds === "all" || (layer !== undefined && combo.layerIds.includes(layer.id)),
    );
    const partnerSet = new Set<number>();
    for (const combo of active) {
      if (inspected !== null && combo.positions.includes(inspected)) {
        for (const position of combo.positions) if (position !== inspected) partnerSet.add(position);
      }
    }
    return { partners: partnerSet, comboKeys: new Set(active.flatMap((combo) => combo.positions)) };
  }, [layout.combos, layer, inspected]);

  if (layer === undefined) return null;

  return (
    <>
      <section className="stage" aria-label="Layout">
        <div className="stage-bar">
          <LayerTabs layers={layout.layers} selectedId={layer.id} onSelect={setLayerId} />
        </div>
        <Keyboard
          keys={keys}
          hands={board.hands}
          descriptions={descriptions}
          fingers={board.fingers}
          layerName={layer.name}
          selected={selected}
          partners={partners}
          comboKeys={comboKeys}
          onSelect={setSelected}
          onHover={setHovered}
        />
        <Legend firmware={layout.firmware} />
      </section>
      <Inspector
        description={description}
        position={inspected}
        finger={inspected === null ? undefined : board.fingers[String(inspected)]}
        layerName={layer.name}
        tapAt={(position) => descriptions[position]?.legend.tap || "empty"}
        onOpenLayer={setLayerId}
      />
    </>
  );
}
