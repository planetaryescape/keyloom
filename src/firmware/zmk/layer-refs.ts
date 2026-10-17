// Which numbers in kept ZMK source are layer numbers (D-360). Read with the devicetree grammar through dts.ts: a number counts
// as a layer number only as the layer parameter of a layer behaviour, in a `layers`-style property, or as a `#define` used
// only as one. The rules for what is provable are in layout/layer-ref-resolve.ts.
import {
  type LayerArg, type LayerDefine, type NameUse, type Resolved, resolveLayerRefs,
} from "../../layout/layer-ref-resolve.ts";
import type { Binding, Layout, Passthrough } from "../../layout/schema.ts";
import { type BehaviorCall, parseCalls } from "./cells.ts";
import { type CellArray, cellArrays, defineBodies, parseDts } from "./dts.ts";
import { KEYMAP_FILE } from "./files.ts";
import { cellsOf, stringOf } from "./props.ts";

/** ZMK's own layer behaviours, and MoErgo's `&magic` and `&layer_on_hold`, with the position of the layer in their parameters. */
const BASE_LAYER_BEHAVIOURS: ReadonlyArray<readonly [string, number]> = [
  ["mo", 0], ["to", 0], ["tog", 0], ["sl", 0], ["lt", 0], ["magic", 0], ["layer_on_hold", 0],
];
/** Properties whose cells are layer numbers: a combo's `layers`, and a conditional layer's `if-layers` and `then-layer`. */
const LAYER_PROPERTIES = new Set(["layers", "if-layers", "then-layer"]);

export type ZmkLayerContext = {
  layerIds: readonly string[];
  /** Behaviours the keymap itself defines that take a layer, by name: modelled layer hold-taps and kept ones that hold with `&mo`. */
  layerBehaviours: ReadonlyMap<string, number>;
  /** Every binding of the original keymap, modelled or not: a `#define` the modelled keys use as a layer is a layer number. */
  keymapCalls: readonly BehaviorCall[];
  defines: ReadonlyMap<string, string>;
};

type Parts = Pick<Layout, "layers" | "combos" | "passthrough">;

class Collector {
  args: LayerArg[] = [];
  defines: LayerDefine[] = [];
  uses: NameUse[] = [];
  unprovable: { site: string; line: number }[] = [];
  constructor(private readonly behaviours: ReadonlyMap<string, number>) {}

  array(site: string, a: CellArray, shift: number, rows: number): void {
    const line = (n: number) => n + rows;
    const arg = (c: CellArray["leading"][number]): LayerArg => ({ site, start: c.start + shift, line: line(c.line), text: c.text, kind: c.kind });
    const note = (c: CellArray["leading"][number]) => {
      if (c.kind === "name") this.uses.push({ name: c.text, site, start: c.start + shift, line: line(c.line) });
    };
    for (const c of a.leading) {
      note(c);
      // `layers = <(-1)>` means every layer; it names none.
      if (LAYER_PROPERTIES.has(a.prop) && c.text.split("(").join("").split(")").join("").trim() !== "-1") this.args.push(arg(c));
    }
    for (const call of a.calls) {
      const at = this.behaviours.get(call.name);
      call.params.forEach((c, i) => {
        note(c);
        if (i === at) this.args.push(arg(c));
      });
    }
  }
}

const READABLE_SECTIONS = ["define", "behavior", "macro", "root", "combo", "top"];
const sectionOf = (p: Passthrough): string => p.anchor.slice(0, Math.max(0, p.anchor.indexOf(":")));

/** Whether the importer reads this kept block for layer numbers (includes, `#if` blocks and the .conf are not read). */
export const isReadableZmk = (p: Passthrough): boolean => p.firmware === "zmk" && p.file === KEYMAP_FILE && READABLE_SECTIONS.includes(sectionOf(p));

/**
 * The layer behaviours a stored layout defines, for a layout whose original keymap is gone: hold-tap profiles the model
 * holds with a layer, and kept hold-taps whose first binding is a layer behaviour (the importer reads the same from the file).
 */
export async function storedLayerBehaviours(layout: Layout): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const l of layout.layers) for (const b of l.bindings) if (b.kind === "holdTap" && "layerId" in b.hold) out.set(b.profileId, 0);
  for (const p of layout.passthrough) {
    if (!isReadableZmk(p) || sectionOf(p) !== "behavior") continue;
    for (const item of await parseDts(p.source)) {
      if (item.kind !== "node" || stringOf(item.node, "compatible") !== "zmk,behavior-hold-tap") continue;
      const first = cellsOf(item.node, "bindings").flatMap((c) => parseCalls(c).calls)[0]?.name ?? "";
      if (["mo", "to", "tog", "sl", "lt"].includes(first) && item.node.label !== undefined) out.set(item.node.label, 0);
    }
  }
  return out;
}

export type ZmkSite = { site: string; source: string; kind: "node" | "define" | "binding" };

export async function readZmkLayerRefs(sites: readonly ZmkSite[], ctx: ZmkLayerContext): Promise<Map<string, Resolved>> {
  const behaviours = new Map([...BASE_LAYER_BEHAVIOURS, ...ctx.layerBehaviours]);
  const c = new Collector(behaviours);
  for (const s of sites) {
    if (s.kind === "define") {
      for (const d of await defineBodies(s.source)) {
        const value = Number(d.body);
        if (!d.fn && d.body !== "" && Number.isInteger(value) && value >= 0) {
          c.defines.push({ name: d.name, site: s.site, start: d.start, end: d.end, line: d.line, value });
        } else {
          for (const a of await cellArrays(d.body, true)) c.array(s.site, a, d.start, d.line - 1);
        }
      }
    } else for (const a of await cellArrays(s.source, s.kind === "binding")) c.array(s.site, a, 0, 0);
  }
  // Keys keyloom models are written out by number, so they don't need renumbering, but a define they use as a layer is still one.
  // Each gets its own start, so one use is never taken for another.
  let n = 0;
  for (const call of ctx.keymapCalls) {
    const at = behaviours.get(call.name);
    call.params.forEach((text, i) => {
      if (!ctx.defines.has(text)) return;
      const start = n++;
      if (i === at) c.args.push({ site: "", start, line: 0, text, kind: "name" });
      c.uses.push({ name: text, site: "", start, line: 0 });
    });
  }
  return resolveLayerRefs({
    layerIds: ctx.layerIds, args: c.args, unprovable: c.unprovable, defines: c.defines, uses: c.uses,
    sources: new Map(sites.map((s) => [s.site, s.source])),
  });
}

/** Writes what `readZmkLayerRefs` found onto the kept source and kept keys of a layout being imported. */
export async function annotateZmkLayerRefs(parts: Parts, ctx: ZmkLayerContext): Promise<Parts> {
  const sites: ZmkSite[] = [];
  parts.passthrough.forEach((p, i) => {
    if (!isReadableZmk(p)) return;
    sites.push({ site: `p${i}`, source: p.source, kind: sectionOf(p) === "define" ? "define" : "node" });
  });
  const nativeAt = (b: Binding, site: string): void => {
    if (b.kind === "native" && b.firmware === "zmk") sites.push({ site, source: b.source, kind: "binding" });
  };
  parts.layers.forEach((l, li) => l.bindings.forEach((b, i) => nativeAt(b, `k${li}.${i}`)));
  parts.combos.forEach((cb, i) => nativeAt(cb.output, `c${i}`));

  const found = await readZmkLayerRefs(sites, ctx);
  const read = new Set(sites.map((s) => s.site));
  const withRefs = <T extends Binding>(b: T, site: string): T => {
    if (!read.has(site)) return b;
    const r = found.get(site);
    return { ...b, ...(r && r.layerRefs.length > 0 ? { layerRefs: r.layerRefs } : {}), ...(r && r.unprovable.length > 0 ? { unprovable: r.unprovable } : {}) };
  };
  return {
    layers: parts.layers.map((l, li) => ({ ...l, bindings: l.bindings.map((b, i) => withRefs(b, `k${li}.${i}`)) })),
    combos: parts.combos.map((cb, i) => ({ ...cb, output: withRefs(cb.output, `c${i}`) })),
    passthrough: parts.passthrough.map((p, i) => {
      if (!read.has(`p${i}`)) return p;
      const r = found.get(`p${i}`);
      const layerRefs = r?.layerRefs ?? [];
      const unprovable = r?.unprovable ?? [];
      return { ...p, refersToLayerIndices: layerRefs.length > 0 || unprovable.length > 0, layerRefs, ...(unprovable.length > 0 ? { unprovable } : {}) };
    }),
  };
}
