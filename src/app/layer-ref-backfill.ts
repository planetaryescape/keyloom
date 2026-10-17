// Layouts stored before keyloom read layer numbers in kept code (D-360) get them read once, so Move and Delete work on
// them without a re-import (D-361). Like D-193's upgrade it is one ordinary revision, but it runs at startup: the
// parsers are async, so they run first and the write happens in a synchronous transaction afterwards. It changes no key's
// behaviour (only the numbers recorded on kept keys), and a layout it can't read is left as it is.
import { deepEqual } from "../layout/equal.ts";
import { type Binding, type Layout, LayoutSchema } from "../layout/schema.ts";
import { annotateQmkLayerRefs, isReadableQmk } from "../firmware/qmk/layer-refs.ts";
import { annotateZmkLayerRefs, isReadableZmk, storedLayerBehaviours } from "../firmware/zmk/layer-refs.ts";
import { appendRevision } from "../persistence/revisions.ts";
import { transact } from "../persistence/transaction.ts";
import type { App } from "./context.ts";
import { getLayout, listLayouts } from "./layouts.ts";

export const BACKFILL_SUMMARY = "Read the layer numbers in the kept code";

export type BackfillOutcome = { layoutId: string; name: string; status: "written" | "unchanged" | "failed" | "head moved"; reason?: string };

/** The same layout without the layer numbers recorded on kept keys: what must not change. */
const withoutRefs = (layout: Layout): unknown => {
  const strip = (b: Binding): Binding => {
    if (b.kind !== "native") return b;
    const { layerRefs: _r, unprovable: _u, ...rest } = b;
    return rest;
  };
  return { ...layout, layers: layout.layers.map((l) => ({ ...l, bindings: l.bindings.map(strip) })), combos: layout.combos.map((c) => ({ ...c, output: strip(c.output) })), passthrough: layout.passthrough.map(({ layerRefs: _r, unprovable: _u, refersToLayerIndices: _f, ...rest }) => rest) };
};

async function read(layout: Layout): Promise<Layout | null> {
  const ids = layout.layers.map((l) => l.id);
  const parts = { layers: layout.layers, combos: layout.combos, passthrough: layout.passthrough };
  if (layout.firmware === "qmk") return { ...layout, ...(await annotateQmkLayerRefs(parts, ids)) };
  if (layout.firmware === "zmk") {
    // The original keymap is gone, so which defines the modelled keys use is not known; a define only they use has no kept code to renumber.
    return { ...layout, ...(await annotateZmkLayerRefs(parts, { layerIds: ids, layerBehaviours: await storedLayerBehaviours(layout), keymapCalls: [], defines: new Map() })) };
  }
  return null;
}

/** A stored head that no importer has read yet: a readable block without `layerRefs`, or, with none, a kept key that may name a layer. */
function needsReading(layout: Layout): boolean {
  const readable = layout.passthrough.filter((p) => (layout.firmware === "qmk" ? isReadableQmk(p) : isReadableZmk(p)));
  if (readable.length > 0) return readable.some((p) => p.layerRefs === undefined);
  return [...layout.layers.flatMap((l) => l.bindings), ...layout.combos.map((c) => c.output)].some((b) => b.kind === "native");
}

/**
 * Reads the layer numbers of every layout whose head hasn't had them read, as one revision each. Idempotent: a layout that
 * has been read, or whose reading changes nothing, is not written. A failure is logged and leaves that layout alone.
 */
export async function backfillLayerRefs(app: App, log: (message: string) => void = (m) => console.error(m)): Promise<BackfillOutcome[]> {
  const out: BackfillOutcome[] = [];
  for (const row of listLayouts(app)) {
    const outcome = (status: BackfillOutcome["status"], reason?: string): void => {
      out.push({ layoutId: row.id, name: row.name, status, ...(reason === undefined ? {} : { reason }) });
      if (status === "failed") log(`keyloom: layer numbers in "${row.name}" were not read: ${reason}`);
    };
    try {
      const view = getLayout(app, row.id);
      if (!needsReading(view.document)) {
        outcome("unchanged");
        continue;
      }
      const next = await read(view.document);
      if (next === null || deepEqual(next, view.document)) {
        outcome("unchanged");
        continue;
      }
      if (!LayoutSchema.safeParse(next).success) throw new Error("the result doesn't parse");
      if (!deepEqual(withoutRefs(next), withoutRefs(view.document))) throw new Error("reading would have changed a key");
      const moved = transact(app.db, () => {
        // Parsing took time; if the head moved meanwhile, the next start reads the new one.
        if (getLayout(app, row.id).revision.id !== view.revision.id) return true;
        appendRevision(app.db, { layoutId: row.id, expectedHeadId: view.revision.id, layout: next, origin: "editor", summary: BACKFILL_SUMMARY });
        return false;
      });
      outcome(moved ? "head moved" : "written");
    } catch (error) {
      outcome("failed", error instanceof Error ? error.message : String(error));
    }
  }
  return out;
}
