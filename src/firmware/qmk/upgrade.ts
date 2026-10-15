// Oryx code a layout stored by an earlier keyloom still holds as passthrough and native keys, read into the model the way a
// fresh import would read it (D-193). Both readings are only trusted when keyloom's own generator writes the same code back:
// the layer colours by the re-render check in import-lighting.ts, the tap dances by the one in import-tap-dance.ts.
// Pure: it returns the new document, or null when there is nothing to read. The app decides whether to save it.
import type { BoardDefinition } from "../../boards/schema.ts";
import type { Binding, Layout } from "../../layout/schema.ts";
import { type MapContext } from "./bindings.ts";
import { macroNames } from "./emit-macros.ts";
import { upgradeLegacyLighting } from "./import-lighting.ts";
import { importTapDances } from "./import-tap-dance.ts";

export type Upgrade = { layout: Layout; colours: boolean; tapDances: boolean };

const NATIVE_DANCE = /^TD\(\s*DANCE_(\d+)\s*\)$/;

function upgradeTapDances(layout: Layout, board: BoardDefinition): Layout | null {
  // A layout that already has tap dances has been through this, or was made by a keyloom that read them.
  if (layout.tapDances.length > 0) return null;
  const chunks = layout.passthrough.filter((p) => p.file === "keymap.c").map((p) => ({ anchor: p.anchor, source: p.source }));
  const layerIds = layout.layers.map((l) => l.id);
  const names = macroNames(layout.macros);
  const home = new Set(board.rows.home ?? []);
  const keyCtx: MapContext = {
    layerIds, isHomeRow: (p) => home.has(p), customKeycodes: new Set(),
    macroIds: new Map([...names].map(([id, name]) => [name, id])),
  };
  const read = importTapDances(chunks, { layerIds, macros: layout.macros, macroNames: names, keyCtx });
  if (read.tapDances.length === 0) return null;
  const ids = new Map(read.tapDances.map((t, i) => [`DANCE_${i}`, t.id]));
  const swap = (b: Binding): Binding => {
    const n = b.kind === "native" && b.firmware === "qmk" ? NATIVE_DANCE.exec(b.source)?.[1] : undefined;
    const id = n === undefined ? undefined : ids.get(`DANCE_${n}`);
    return id === undefined ? b : { kind: "tapDance", tapDanceId: id };
  };
  const next: Layout = {
    ...layout,
    tapDances: read.tapDances,
    layers: layout.layers.map((l) => ({ ...l, bindings: l.bindings.map(swap) })),
    combos: layout.combos.map((c) => ({ ...c, output: swap(c.output) })),
    passthrough: layout.passthrough.filter((p) => !(p.file === "keymap.c" && read.consumed.has(p.anchor))),
  };
  // A native TD() that no entry replaced would point at a dance the regenerated code no longer has.
  const dangling = next.layers.some((l) => l.bindings.some((b) => b.kind === "native" && NATIVE_DANCE.test(b.source)));
  return dangling ? null : next;
}

export function upgradeStoredOryx(layout: Layout, board: BoardDefinition): Upgrade | null {
  if (layout.firmware !== "qmk" || board.firmware !== "qmk") return null;
  const lit = board.lighting === undefined ? null : upgradeLegacyLighting(layout, board.lighting.ledPositions);
  const danced = upgradeTapDances(lit ?? layout, board);
  if (lit === null && danced === null) return null;
  return { layout: danced ?? (lit as Layout), colours: lit !== null, tapDances: danced !== null };
}

/** "Read colours and tap dances from the Oryx code": the revision's summary, naming only what applied. */
export const upgradeSummary = (u: Pick<Upgrade, "colours" | "tapDances">): string =>
  `Read ${u.colours && u.tapDances ? "colours and tap dances" : u.colours ? "colours" : "tap dances"} from the Oryx code`;
