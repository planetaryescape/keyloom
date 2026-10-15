import type { CSSProperties } from "react";
import type { GeometryKey } from "../../boards/schema.ts";
import type { Layout } from "../../layout/schema.ts";
import { Key } from "./Key.tsx";
import { boardBounds, keyRect, type KeyRect } from "./geometry.ts";
import { keyLabelAt } from "./labels.ts";

// Pixels per key unit, and the gap left between neighbouring keys.
const UNIT = 60;
const GAP = 6;

interface KeyboardProps {
  layout: Layout;
  layerIndex: number;
  // Already has display rotation applied, so keys[i] is the i-th binding's key.
  keys: readonly GeometryKey[];
}

export function Keyboard({ layout, layerIndex, keys }: KeyboardProps) {
  const bounds = boardBounds(keys);
  const canvasStyle: CSSProperties = {
    width: bounds.width * UNIT + GAP,
    height: bounds.height * UNIT + GAP,
  };

  return (
    <div className="keyboard" role="group" aria-label="Keyboard" style={canvasStyle}>
      {keys.map((geometryKey, index) => (
        <Key
          key={index}
          style={keyStyle(keyRect(geometryKey, bounds))}
          label={keyLabelAt(layout, layerIndex, index)}
        />
      ))}
    </div>
  );
}

// The gap shrinks each box and keeps the rotation origin on the same point, because the
// origin is measured from the box's top-left.
function keyStyle(rect: KeyRect): CSSProperties {
  return {
    left: rect.left * UNIT + GAP / 2,
    top: rect.top * UNIT + GAP / 2,
    width: rect.width * UNIT - GAP,
    height: rect.height * UNIT - GAP,
    transform: `rotate(${rect.rotate}deg)`,
    transformOrigin: `${rect.originX * UNIT - GAP / 2}px ${rect.originY * UNIT - GAP / 2}px`,
  };
}
