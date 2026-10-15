// `zmk,combos` children -> Combo (06). A combo with a property keyloom has no field for
// (`slow-release`, `require-prior-idle-ms`...) is returned as a reason and kept verbatim.
import type { Combo } from "../../layout/schema.ts";
import { parseCalls } from "./cells.ts";
import type { Defines } from "./defines.ts";
import type { DtNode } from "./dts.ts";
import { type MapContext, mapBinding } from "./bindings.ts";
import { cellsOf, intsOf, propOf } from "./props.ts";
import { slug } from "./slug.ts";

const KNOWN = new Set(["key-positions", "bindings", "timeout-ms", "layers"]);

export function importCombo(n: DtNode, keyCount: number, ctx: MapContext, defines: Defines, takenIds: ReadonlySet<string>): Combo | string {
  const extra = n.props.find((p) => !KNOWN.has(p.name));
  if (extra) return `it sets ${extra.name}, which keyloom doesn't model`;

  const positions = cellsOf(n, "key-positions").length === 1 ? intsOf(cellsOf(n, "key-positions")[0] as string, defines) : undefined;
  if (!positions || positions.length < 2) return "its key-positions aren't a list of at least two numbers";
  if (new Set(positions).size !== positions.length) return "its key-positions repeat a key";
  if (positions.some((p) => p < 0 || p >= keyCount)) return `its key-positions go past the ${keyCount} keys`;

  const bindings = cellsOf(n, "bindings");
  const calls = bindings.length === 1 ? parseCalls(bindings[0] as string).calls : [];
  const call = calls[0];
  if (calls.length !== 1 || !call) return "its bindings aren't a single behaviour";
  const mapped = mapBinding(call, ctx);
  // A combo can't output a hold-tap (07).
  const output = mapped.binding.kind === "holdTap" ? ({ kind: "native", firmware: "zmk", source: `&${call.name} ${call.params.join(" ")}`.trim(), label: call.params.join(" ") || call.name } as const) : mapped.binding;

  let layerIds: Combo["layerIds"];
  const layersProp = propOf(n, "layers");
  if (!layersProp) {
    // No `layers` means every layer: combo.c treats an empty layer mask as "active everywhere" (moergo-sc/zmk
    // ce69e85 app/src/combo.c:151, and upstream 4dd95d7 the same), whatever older guides say.
    layerIds = "all";
  } else {
    const ints = cellsOf(n, "layers").length === 1 ? intsOf(cellsOf(n, "layers")[0] as string, defines) : undefined;
    if (!ints || ints.length === 0) return "its layers aren't a list of numbers";
    // `<(-1)>` is how newer ZMK spells "all"; this firmware can't compile it (BIT(-1)), so it is read but never written.
    if (ints.includes(-1)) layerIds = "all";
    else {
      const ids = ints.map((i) => ctx.layerIds[i]);
      if (ids.some((i) => i === undefined)) return "its layers name a layer that doesn't exist";
      layerIds = ids as string[];
    }
  }

  const timeout = cellsOf(n, "timeout-ms")[0] === undefined ? undefined : intsOf(cellsOf(n, "timeout-ms")[0] as string, defines)?.[0];
  if (propOf(n, "timeout-ms") && (timeout === undefined || timeout <= 0)) return "its timeout-ms isn't a positive number";

  return {
    id: slug(n.name, takenIds), name: n.name, positions, layerIds, output,
    ...(timeout === undefined ? {} : { timeoutMs: timeout }),
  };
}
