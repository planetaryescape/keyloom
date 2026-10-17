// Layer numbers inside firmware source keyloom keeps as written (S3, D-024). The importers record which number literals are
// layer numbers (D-360); this renumbers them for the layer order the document has now. Pure: no parsing happens here.
import type { Binding, Layout, LayerRef } from "./schema.ts";

/**
 * `source` with each recorded number replaced by its layer's current index. A number that already reads right is left as it was
 * written, and so is one whose layer is gone: `missingLayerNumbers` reports those, and `passthrough_layer_index` refuses the change.
 */
export function renumber(source: string, refs: readonly LayerRef[] | undefined, layerIds: readonly string[]): string {
  if (refs === undefined || refs.length === 0) return source;
  let out = "";
  let at = 0;
  for (const ref of [...refs].sort((a, b) => a.start - b.start)) {
    const index = layerIds.indexOf(ref.layerId);
    out += source.slice(at, ref.start);
    const written = source.slice(ref.start, ref.end);
    out += index < 0 || Number(written) === index ? written : String(index);
    at = ref.end;
  }
  return out + source.slice(at);
}

/**
 * The layout as firmware should read it: every kept source and kept key with its layer numbers matching the layers' current
 * order. Unchanged layouts come back as the same object.
 */
export function withLayerNumbers(layout: Layout): Layout {
  const ids = layout.layers.map((l) => l.id);
  const native = (b: Binding): Binding => (b.kind === "native" && b.layerRefs?.length ? { ...b, source: renumber(b.source, b.layerRefs, ids) } : b);
  const touched =
    layout.passthrough.some((p) => p.layerRefs?.length) ||
    layout.layers.some((l) => l.bindings.some((b) => b.kind === "native" && b.layerRefs?.length)) ||
    layout.combos.some((c) => c.output.kind === "native" && c.output.layerRefs?.length);
  if (!touched) return layout;
  return {
    ...layout,
    layers: layout.layers.map((l) => ({ ...l, bindings: l.bindings.map(native) })),
    combos: layout.combos.map((c) => ({ ...c, output: native(c.output) })),
    passthrough: layout.passthrough.map((p) => (p.layerRefs?.length ? { ...p, source: renumber(p.source, p.layerRefs, ids) } : p)),
  };
}

/** Layers that kept source or kept keys name by number and the layout no longer has. A generator must not write such a layout. */
export function missingLayerNumbers(layout: Layout): string[] {
  const have = new Set(layout.layers.map((l) => l.id));
  const gone = (refs: readonly LayerRef[] | undefined) => (refs ?? []).filter((r) => !have.has(r.layerId)).map((r) => r.layerId);
  const keys = [...layout.layers.flatMap((l) => l.bindings), ...layout.combos.map((c) => c.output)].flatMap((b) => (b.kind === "native" ? gone(b.layerRefs) : []));
  return [...new Set([...layout.passthrough.flatMap((p) => gone(p.layerRefs)), ...keys])];
}
