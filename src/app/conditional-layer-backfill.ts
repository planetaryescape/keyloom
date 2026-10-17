// A stored layout whose kept code holds a conditional layer gets it read into the model once, at startup, as one revision (D-390). It runs
// right after the layer-number backfill (D-378) and has the same safety rules: the parsers run outside the transaction, the write is one
// `appendRevision` inside it that checks the head hasn't moved, a layout it can't read is left as it is with a logged reason, and a
// layout it has read, or that holds nothing it can read, is not written again.
//
// It moves code, so the generated firmware is equivalent rather than the same bytes: the model writes `layer_state_set_user`, or a
// `conditional_layers` container, in its own place and form. The sync engine reads that step as the same build (`sameBuild`), so the
// keyboard's running firmware isn't called behind and nothing is flashed.
import { generateQmkSource } from "../firmware/qmk/generate.ts";
import { readTriLayerCalls } from "../firmware/qmk/keymap-c.ts";
import { defineBodies, parseDts } from "../firmware/zmk/dts.ts";
import { generateZmkSource } from "../firmware/zmk/generate.ts";
import { importConditionalLayer } from "../firmware/zmk/import-conditional.ts";
import { stringOf } from "../firmware/zmk/props.ts";
import { type ConditionalLayer, type Layout, LayoutSchema } from "../layout/schema.ts";
import { isConditionalBackfill, isKeptConditional } from "../layout/conditional-backfill.ts";
import { newConditionalLayerId } from "../layout/conditional-layers.ts";
import { deepEqual } from "../layout/equal.ts";
import { withLayerNumbers } from "../layout/layer-refs.ts";
import { appendRevision } from "../persistence/revisions.ts";
import { transact } from "../persistence/transaction.ts";
import { documentRules } from "../validation/rules.ts";
import type { App } from "./context.ts";
import { getLayout, listLayouts } from "./layouts.ts";

export const CONDITIONAL_BACKFILL_SUMMARY = "Read the conditional layers in the kept code";

export type ConditionalBackfillOutcome = { layoutId: string; name: string; status: "written" | "unchanged" | "failed" | "head moved"; reason?: string };

const issueKey = (i: { code: string; message: string }) => `${i.code}:${i.message}`;

/** The conditions the kept blocks say, and which blocks they replace; null when there is nothing a reading could replace whole. */
async function readKept(layout: Layout): Promise<{ conditions: ConditionalLayer[]; replaced: Set<number> } | null> {
  // The numbers in kept code as the layers are ordered now (D-360); a block whose numbers were never read can't be trusted.
  const numbered = withLayerNumbers(layout);
  const layerIds = layout.layers.map((l) => l.id);
  const conditions: ConditionalLayer[] = [...layout.conditionalLayers];
  const replaced = new Set<number>();
  const add = (ids: readonly [string, string, string], id?: string): boolean => {
    const [a, b, c] = ids;
    if (a === b || c === a || c === b) return false;
    if (!conditions.some((x) => x.thenLayerId === c && x.ifLayerIds.includes(a) && x.ifLayerIds.includes(b))) {
      conditions.push({ id: id ?? newConditionalLayerId({ conditionalLayers: conditions }, c), ifLayerIds: [a, b], thenLayerId: c });
    }
    return true;
  };

  if (layout.firmware === "qmk") {
    const at = layout.passthrough.findIndex(isKeptConditional);
    const kept = layout.passthrough[at];
    if (kept === undefined || kept.layerRefs === undefined || (kept.unprovable ?? []).length > 0) return null;
    const calls = await readTriLayerCalls((numbered.passthrough[at] as NonNullable<typeof kept>).source);
    // Layers are numbers here: a keymap that named them (`_LOWER`) lost the enum on import, so there is nothing to resolve them against.
    const ids = calls?.map((args) => args.map((e) => (e.kind === "num" ? layerIds[e.value] : undefined)));
    if (ids === undefined || !ids.every((c) => c.every((id) => id !== undefined) && add(c as unknown as [string, string, string]))) return null;
    replaced.add(at);
    return { conditions, replaced };
  }

  if (layout.firmware === "zmk") {
    const defines = new Map<string, string>();
    for (const p of numbered.passthrough) {
      if (!p.anchor.startsWith("define:")) continue;
      for (const d of await defineBodies(p.source)) if (!d.fn) defines.set(d.name, d.body);
    }
    for (const [at, p] of layout.passthrough.entries()) {
      if (!isKeptConditional(p)) continue;
      if (p.layerRefs === undefined || (p.unprovable ?? []).length > 0) return null;
      const items = await parseDts((numbered.passthrough[at] as NonNullable<typeof p>).source);
      const node = items.length === 1 && items[0]?.kind === "node" ? items[0].node : undefined;
      if (node === undefined || stringOf(node, "compatible") !== "zmk,conditional-layers" || node.props.some((x) => x.name !== "compatible") || node.children.length === 0) return null;
      const taken = new Set(conditions.map((c) => c.id));
      for (const child of node.children) {
        const r = importConditionalLayer(child, layerIds, defines, taken);
        if (typeof r === "string" || !add([...r.conditionalLayer.ifLayerIds, r.conditionalLayer.thenLayerId] as unknown as [string, string, string], r.conditionalLayer.id)) return null;
        taken.add(r.conditionalLayer.id);
      }
      replaced.add(at);
    }
    return replaced.size === 0 ? null : { conditions, replaced };
  }
  return null;
}

const hasKept = (layout: Layout): boolean => layout.passthrough.some(isKeptConditional);

/**
 * Reads the conditional layers out of the kept code of every stored layout that has some, as one revision each. Idempotent. A failure is
 * logged and leaves that layout alone.
 */
export async function backfillConditionalLayers(app: App, log: (message: string) => void = (m) => console.error(m)): Promise<ConditionalBackfillOutcome[]> {
  const out: ConditionalBackfillOutcome[] = [];
  for (const row of listLayouts(app)) {
    const outcome = (status: ConditionalBackfillOutcome["status"], reason?: string): void => {
      out.push({ layoutId: row.id, name: row.name, status, ...(reason === undefined ? {} : { reason }) });
      if (status === "failed") log(`keyloom: conditional layers in "${row.name}" were not read: ${reason}`);
    };
    try {
      const view = getLayout(app, row.id);
      if (!hasKept(view.document)) {
        outcome("unchanged");
        continue;
      }
      const read = await readKept(view.document);
      if (read === null) {
        outcome("unchanged");
        continue;
      }
      const next: Layout = { ...view.document, conditionalLayers: read.conditions, passthrough: view.document.passthrough.filter((_, i) => !read.replaced.has(i)) };
      if (!LayoutSchema.safeParse(next).success) throw new Error("the result doesn't parse");
      if (!isConditionalBackfill(view.document, next)) throw new Error("reading would have changed more than the kept conditional code");
      // It breaks no rule the old one kept, and it still generates.
      const board = view.board.definition;
      const had = new Set(documentRules(board, view.document).map(issueKey));
      const worse = documentRules(board, next).filter((i) => !had.has(issueKey(i)));
      if (worse.length > 0) throw new Error(worse[0]?.message ?? "it breaks a rule");
      if (next.firmware === "qmk") generateQmkSource({ layout: next, board, revisionId: view.revision.id });
      else generateZmkSource({ layout: next, board, geometry: view.board.geometry, revisionId: view.revision.id });
      if (deepEqual(next, view.document)) {
        outcome("unchanged");
        continue;
      }
      const moved = transact(app.db, () => {
        if (getLayout(app, row.id).revision.id !== view.revision.id) return true;
        appendRevision(app.db, { layoutId: row.id, expectedHeadId: view.revision.id, layout: next, origin: "editor", summary: CONDITIONAL_BACKFILL_SUMMARY });
        return false;
      });
      outcome(moved ? "head moved" : "written");
    } catch (error) {
      outcome("failed", error instanceof Error ? error.message : String(error));
    }
  }
  return out;
}
