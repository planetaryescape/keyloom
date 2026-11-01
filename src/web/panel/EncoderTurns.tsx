import { RotateCcw, RotateCw } from "lucide-react";
import type { BoardDefinition } from "../../boards/schema.ts";
import { boardSensorDefaults, effectiveSensors } from "../../boards/sensors.ts";
import { KEYCODES, keyCodeLabel } from "../../layout/keycodes.ts";
import type { Binding, Layer, SensorBinding } from "../../layout/schema.ts";
import { deepEqual } from "../../layout/equal.ts";
import "./encoder-turns.css";

type Action = Extract<SensorBinding, { kind: "rotation" }>["clockwise"];
const MOUSE: Action[] = [
  ...["RIGHT", "LEFT", "DOWN", "UP"].map((direction): Action => ({ kind: "native", firmware: "zmk", source: `&mmv MOVE_${direction}`, label: `Mouse ${direction.toLowerCase()}` })),
  ...["UP", "DOWN", "LEFT", "RIGHT"].map((direction): Action => ({ kind: "native", firmware: "zmk", source: `&msc SCRL_${direction}`, label: `Scroll ${direction.toLowerCase()}` })),
];
const valueOf = (a: Action) => a.kind === "key" ? `key:${a.code}${a.mods?.length ? `:${a.mods.join("+")}` : ""}` : a.kind === "native" ? a.source : "none";
export const turnActionWords = (a: Binding): string => a.kind === "key" ? keyCodeLabel(a.code) : a.kind === "native" ? a.label : "Nothing";

export function EncoderTurns({ board, layer, position, draft, onChange }: {
  board: BoardDefinition; layer: Layer; position: number; draft: SensorBinding[] | null | undefined; onChange: (sensors: SensorBinding[] | null) => void;
}) {
  const indices = (board.sensorPositions ?? []).flatMap((p, i) => p === position ? [i] : []);
  if (indices.length === 0) return null;
  const sensors = draft === undefined ? effectiveSensors(board, layer) : draft === null ? boardSensorDefaults(board) : draft;
  const current = sensors[indices[0]!];
  if (!current) return null;
  const setAction = (direction: "clockwise" | "counterclockwise", action: Action) => {
    const rotation = current.kind === "rotation" ? current : { kind: "rotation" as const, clockwise: { kind: "none" as const }, counterclockwise: { kind: "none" as const } };
    onChange(sensors.map((s, i) => indices.includes(i) ? { ...rotation, [direction]: action } : s));
  };
  return (
    <section className="encoder-turns" aria-label="Encoder turns">
      <p className="card-note">Turns on {layer.name}. Edit the press below.</p>
      {(["clockwise", "counterclockwise"] as const).map((direction) => {
        const action = current.kind === "rotation" ? current[direction] : null;
        const value = action === null ? "custom" : valueOf(action);
        const Icon = direction === "clockwise" ? RotateCw : RotateCcw;
        const custom = action !== null && ((action.kind === "key" && (action.mods?.length ?? 0) > 0) || (action.kind === "native" && !MOUSE.some((m) => valueOf(m) === value)));
        return <label className="encoder-turn" key={direction}>
          <span><Icon size={15} aria-hidden="true" />{direction === "clockwise" ? "Clockwise" : "Counterclockwise"}</span>
          <select aria-label={direction === "clockwise" ? "Clockwise turn" : "Counterclockwise turn"} value={value} onChange={(event) => {
            const selected = event.target.value;
            const mouse = MOUSE.find((a) => valueOf(a) === selected);
            setAction(direction, mouse ?? (selected === "none" ? { kind: "none" } : { kind: "key", code: selected.slice(4) }));
          }}>
            {action === null ? <option value="custom" disabled>Custom encoder behaviour</option> : custom ? <option value={value} disabled>{turnActionWords(action)}</option> : null}
            <option value="none">Nothing</option>
            <optgroup label="Mouse">{MOUSE.map((a) => <option value={valueOf(a)} key={valueOf(a)}>{turnActionWords(a)}</option>)}</optgroup>
            <optgroup label="Keys">{KEYCODES.map((k) => <option value={`key:${k.name}`} key={k.name}>{k.label}</option>)}</optgroup>
          </select>
        </label>;
      })}
      {deepEqual(sensors, boardSensorDefaults(board)) ? null : <button type="button" className="link-button" onClick={() => onChange(null)}>Use board defaults on this layer</button>}
    </section>
  );
}
