// From "this argument is in a layer position" to the number literals that can be renumbered (D-360). The importers find the
// positions with their language's parser; the rules for what is provable are the same for both, so they live here. Pure.
import type { LayerRef, UnprovableLine } from "./schema.ts";

/** An argument in a position that takes a layer. `site` is the kept source it is in; "" is code keyloom models, which only counts as a use. */
export type LayerArg = { site: string; start: number; line: number; text: string; kind: "int" | "name" | "other" };
/** An object-like `#define NAME <integer>`. */
export type LayerDefine = { name: string; site: string; start: number; end: number; line: number; value: number };
/** Any other occurrence of an identifier that has a define of that name. */
export type NameUse = { name: string; site: string; start: number; line: number };
export type Resolved = { layerRefs: LayerRef[]; unprovable: UnprovableLine[] };

export type ResolveInput = {
  layerIds: readonly string[];
  args: readonly LayerArg[];
  /** Layer numbers used in a way that can't be rewritten (arithmetic, a bitmask, a comparison by order). */
  unprovable: readonly { site: string; line: number }[];
  defines: readonly LayerDefine[];
  uses: readonly NameUse[];
  /** Each kept source's text, to quote the line a refusal names. */
  sources: ReadonlyMap<string, string>;
};

const SHOWN = 100;

export function resolveLayerRefs(input: ResolveInput): Map<string, Resolved> {
  const out = new Map<string, Resolved>();
  const at = (site: string): Resolved => {
    let r = out.get(site);
    if (r === undefined) out.set(site, (r = { layerRefs: [], unprovable: [] }));
    return r;
  };
  const refuse = (site: string, line: number): void => {
    if (site === "") return;
    const r = at(site);
    if (r.unprovable.some((u) => u.line === line)) return;
    const text = (input.sources.get(site)?.split("\n")[line - 1] ?? "").trim();
    r.unprovable.push({ line, text: text.length > SHOWN ? `${text.slice(0, SHOWN)}...` : text });
  };
  const ref = (site: string, start: number, end: number, value: number, line: number): void => {
    const layerId = input.layerIds[value];
    if (site === "") return;
    if (layerId === undefined) refuse(site, line);
    else at(site).layerRefs.push({ start, end, layerId });
  };

  const defineOf = new Map(input.defines.map((d) => [d.name, d]));
  const layerUse = new Set<string>();
  const usedAsLayer = new Map<string, LayerArg[]>();
  for (const a of input.args) {
    if (a.kind === "int") {
      const value = Number(a.text);
      if (Number.isInteger(value)) ref(a.site, a.start, a.start + a.text.length, value, a.line);
      else refuse(a.site, a.line);
    } else if (a.kind === "name" && defineOf.has(a.text)) {
      layerUse.add(`${a.site}:${a.start}`);
      usedAsLayer.set(a.text, [...(usedAsLayer.get(a.text) ?? []), a]);
    } else refuse(a.site, a.line);
  }
  for (const d of input.defines) {
    const named = usedAsLayer.get(d.name);
    if (named === undefined) continue;
    const others = input.uses.filter((u) => u.name === d.name && !layerUse.has(`${u.site}:${u.start}`));
    const layerId = input.layerIds[d.value];
    if (others.length === 0 && layerId !== undefined) {
      ref(d.site, d.start, d.end, d.value, d.line);
      // A kept use of the name keeps the name: the define is the number, and renumbering writes the define, not the use (D-360).
      for (const a of named) if (a.site !== "") at(a.site).layerRefs.push({ start: a.start, end: a.start + a.text.length, layerId });
    } else {
      // The number is also something else, or no layer has it, so it can't follow the layer it names: every use of it is refused.
      for (const u of others) refuse(u.site, u.line);
      for (const a of named) refuse(a.site, a.line);
      refuse(d.site, d.line);
    }
  }
  for (const u of input.unprovable) refuse(u.site, u.line);
  return out;
}
