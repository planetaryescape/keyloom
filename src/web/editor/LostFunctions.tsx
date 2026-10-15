import { ArrowRight, CircleAlert, CircleCheck, MousePointerClick, X } from "lucide-react";
import type { Layout } from "../../layout/schema.ts";
import { functionName } from "./function-label.ts";
import { type LostFunction, type Placement, keyName, layerReachedBy, placeableBinding } from "./lost-functions.ts";

export interface LostRow {
  lost: LostFunction;
  /** False when dropping it would strand a layer, so the only way forward is to keep it. */
  droppable: boolean;
}

interface Props {
  layout: Layout;
  /** Functions the draft would lose from the keys it touches and nobody has dealt with yet. */
  rows: readonly LostRow[];
  /** Functions that were only on a layer the draft cuts off. They return once its key is kept. */
  strandedCount: number;
  strandedLayers: readonly string[];
  drops: ReadonlySet<string>;
  placements: readonly Placement[];
  /** The function waiting for a key to be clicked on the board. */
  placing: string | null;
  onDrop: (fns: readonly string[]) => void;
  onKeep: (fn: string) => void;
  onPlace: (lost: LostFunction) => void;
  onCancelPlace: () => void;
  onUnplace: (fn: string) => void;
}

// A change that would lose a function asks what to do with it in plain words (D-092) rather than
// showing the validator's text: drop it, or keep it by putting it on another key first.
export function LostFunctions({
  layout, rows, strandedCount, strandedLayers, drops, placements, placing, onDrop, onKeep, onPlace, onCancelPlace, onUnplace,
}: Props) {
  const droppable = rows.filter((row) => row.droppable && row.lost.function !== placing);
  const nothing = rows.length === 0 && drops.size === 0 && placements.length === 0 && strandedCount === 0 && placing === null;
  if (nothing) return null;
  return (
    <div className="lost" role="group" aria-label="Keys that would be lost" aria-live="polite">
      <ul className="lost-list">
        {rows.map(({ lost, droppable: canDrop }) => {
          const name = functionName(lost.function, layout);
          const waiting = placing === lost.function;
          const layerName = canDrop ? null : layerReachedBy(layout, lost);
          return (
            <li key={lost.function} className="lost-row" data-waiting={waiting}>
              {waiting ? <MousePointerClick size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
              <div className="lost-body">
                <p>
                  {waiting
                    ? `Click the key that should get ${name}. Escape cancels.`
                    : layerName === null
                      ? `${name} won't be on your keyboard any more.`
                      : `${name} is the only way to reach ${layerName}, so everything on it would be out of reach.`}
                </p>
                <div className="lost-actions">
                  {waiting ? (
                    <button type="button" className="button" onClick={onCancelPlace}>Cancel</button>
                  ) : (
                    <>
                      {canDrop ? <button type="button" className="button" onClick={() => onDrop([lost.function])}>Drop {name}</button> : null}
                      {placeableBinding(layout, lost) === null ? null : (
                        <button type="button" className="button" onClick={() => onPlace(lost)}>Put {name} somewhere first</button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
        {strandedCount === 0 ? null : (
          <li className="lost-row lost-note">
            <CircleAlert size={16} aria-hidden="true" />
            <p>
              {strandedCount === 1 ? "1 other key" : `${strandedCount} other keys`} on {strandedLayers.join(" and ")} would be out of reach. They come back once a key switches to {strandedLayers.length === 1 ? "that layer" : "those layers"} again.
            </p>
          </li>
        )}
        {placements.map((placement) => (
          <li key={`p:${placement.function}`} className="lost-row lost-done">
            <ArrowRight size={16} aria-hidden="true" />
            <div className="lost-body">
              <p>{functionName(placement.function, layout)} goes on {keyName(layout, placement.slot)}.</p>
              <div className="lost-actions">
                <button type="button" className="button" onClick={() => onUnplace(placement.function)}>Don&apos;t move it</button>
              </div>
            </div>
          </li>
        ))}
        {[...drops].map((fn) => (
          <li key={`d:${fn}`} className="lost-row lost-done">
            <CircleCheck size={16} aria-hidden="true" />
            <div className="lost-body">
              <p>{functionName(fn, layout)} will be dropped.</p>
              <div className="lost-actions">
                <button type="button" className="button" onClick={() => onKeep(fn)}>Keep it</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {droppable.length < 2 ? null : (
        <button type="button" className="button lost-all" onClick={() => onDrop(droppable.map((row) => row.lost.function))}>
          <X size={14} aria-hidden="true" />
          Drop all {droppable.length}
        </button>
      )}
    </div>
  );
}
