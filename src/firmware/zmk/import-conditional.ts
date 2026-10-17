// `zmk,conditional-layers` children -> ConditionalLayer (D-387). Each child is `if-layers = <A B>; then-layer = <C>;`: C is on while
// A and B both are. A child with anything else (three layers, a property keyloom has no field for) is returned as a reason and kept
// as written, inside a container the generator writes around the kept ones.
import type { ConditionalLayer } from "../../layout/schema.ts";
import { tokens } from "./cells.ts";
import type { Defines } from "./defines.ts";
import type { DtNode } from "./dts.ts";
import { cellsOf, intsOf, propOf } from "./props.ts";
import { slug } from "./slug.ts";

const KNOWN = new Set(["if-layers", "then-layer"]);
export const CONDITIONAL_COMPATIBLE = "zmk,conditional-layers";

export type ImportedCondition = {
  conditionalLayer: ConditionalLayer;
  /** The layer cells as written (`LOWER`, `2`): a `#define` used only here is still a layer number, so the importer counts them as uses. */
  written: string[];
};

export function importConditionalLayer(n: DtNode, layerIds: readonly string[], defines: Defines, takenIds: ReadonlySet<string>): ImportedCondition | string {
  const extra = n.props.find((p) => !KNOWN.has(p.name) && p.name !== "status");
  if (extra) return `it sets ${extra.name}, which keyloom doesn't model`;
  if (propOf(n, "status") !== undefined) return "it sets status, which keyloom doesn't model";
  const ifCells = cellsOf(n, "if-layers");
  const thenCells = cellsOf(n, "then-layer");
  if (ifCells.length !== 1 || thenCells.length !== 1) return "its if-layers and then-layer aren't one list of layers each";
  const ifs = intsOf(ifCells[0] as string, defines);
  const then = intsOf(thenCells[0] as string, defines);
  if (!ifs || !then || then.length !== 1) return "its layers aren't plain layer numbers";
  if (ifs.length !== 2) return `it waits for ${ifs.length} layers, and keyloom models a condition on two`;
  const ids = [...ifs, ...then].map((i) => layerIds[i]);
  if (ids.some((i) => i === undefined)) return "it names a layer that doesn't exist";
  const [a, b, c] = ids as [string, string, string];
  if (a === b || c === a || c === b) return "it names the same layer twice";
  return {
    conditionalLayer: { id: slug(n.name, takenIds), ifLayerIds: [a, b], thenLayerId: c },
    written: [...tokens(ifCells[0] as string), ...tokens(thenCells[0] as string)],
  };
}
