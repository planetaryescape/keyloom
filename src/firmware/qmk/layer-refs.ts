// Which numbers in kept QMK source are layer numbers (D-360). The C is read with tree-sitter (D-041), never matched as text: a
// number counts as a layer number only where QMK or Oryx's own code puts a layer, and anything else that touches a layer number
// is recorded as a line to refuse. The rules for what is provable are in layout/layer-ref-resolve.ts.
import type { Node } from "web-tree-sitter";
import {
  type LayerArg, type LayerDefine, type NameUse, type Resolved, resolveLayerRefs,
} from "../../layout/layer-ref-resolve.ts";
import type { Binding, Layout, Passthrough } from "../../layout/schema.ts";
import { withTree } from "./c-parse.ts";

/** Calls whose arguments, at these positions, are layer numbers. */
const LAYER_CALLS: Readonly<Record<string, readonly number[]>> = {
  LT: [0], MO: [0], TG: [0], TO: [0], OSL: [0], TT: [0], DF: [0], LM: [0],
  layer_move: [0], layer_on: [0], layer_off: [0], layer_invert: [0], layer_state_is: [0],
  IS_LAYER_ON: [0], IS_LAYER_OFF: [0], set_single_persistent_default_layer: [0],
  layer_state_cmp: [1], IS_LAYER_ON_STATE: [1], IS_LAYER_OFF_STATE: [1],
  update_tri_layer: [0, 1, 2], update_tri_layer_state: [1, 2, 3],
};
/** Calls that take a bitmask of layers; a number in one is a bit position or a mask, which a renumber can't follow. */
const MASK_CALLS = new Set(["layer_state_set", "layer_and", "layer_or", "layer_xor", "default_layer_set", "default_layer_and", "default_layer_or", "default_layer_xor"]);
/** Calls that return the active layer's number. */
const LAYER_GETTERS = new Set(["biton32", "get_highest_layer", "biton"]);
/** Arrays Oryx indexes by layer number. */
const LAYER_ARRAYS = new Set(["ledmap"]);

export type QmkSite = {
  site: string;
  source: string;
  /** "code" is a stretch of keymap.c or config.h, "cases" the `case` blocks of process_record_user, "binding" one key's source. */
  kind: "code" | "cases" | "binding";
};

type Fn = { name: string; params: string[] };
/** An argument read off the tree while it is alive. */
type Arg = Omit<LayerArg, "site">;
type CallSite = { callee: string; args: Arg[]; site: string; fn: Fn | undefined };
type Mapper = { site: string; shift: number; baseOffset: number; baseRow: number };
type Sub = { site: string; text: string; baseOffset: number; baseRow: number };

const WRAP: Record<QmkSite["kind"], [string, string]> = {
  code: ["", ""],
  cases: ["void keyloom_wrap(void){switch(0){", "}}"],
  binding: ["void keyloom_wrap(void){x=", ";}"],
};
// A define's body is a statement, an expression or a few of them, so it is read inside a function.
const BODY: [string, string] = ["void keyloom_wrap(void){", ";}"];

class Collector {
  args: LayerArg[] = [];
  defines: LayerDefine[] = [];
  uses: NameUse[] = [];
  unprovable: { site: string; line: number }[] = [];
  calls: CallSite[] = [];
  /** Functions whose parameter is used as a layer number, by name and parameter position. */
  layerParams = new Map<string, Set<number>>();
  subs: Sub[] = [];

  pos(map: Mapper, n: Node): { start: number; line: number } {
    return { start: n.startIndex - map.shift + map.baseOffset, line: n.startPosition.row + 1 + map.baseRow };
  }

  describe(map: Mapper, n: Node): Arg {
    const e = unwrap(n);
    return { ...this.pos(map, e), text: e.text, kind: e.type === "number_literal" ? "int" : e.type === "identifier" ? "name" : "other" };
  }

  /** The argument is in a layer position. A name that is the enclosing function's own parameter is a forwarded layer, not a literal; true when that is news. */
  layerArg(site: string, a: Arg, fn: Fn | undefined): boolean {
    const k = a.kind === "name" && fn ? fn.params.indexOf(a.text) : -1;
    if (fn && k >= 0) {
      const set = this.layerParams.get(fn.name) ?? new Set<number>();
      if (set.has(k)) return false;
      this.layerParams.set(fn.name, set.add(k));
      return true;
    }
    this.args.push({ site, ...a });
    return false;
  }

  refuse(map: Mapper, n: Node): void {
    this.unprovable.push({ site: map.site, line: this.pos(map, n).line });
  }
}

const declared = (d: Node | null): string | undefined => {
  let cur = d;
  while (cur && cur.type !== "identifier") cur = cur.childForFieldName("declarator");
  return cur?.text;
};

function functionOf(n: Node): Fn | undefined {
  for (let p = n.parent; p; p = p.parent) {
    if (p.type !== "function_definition") continue;
    const fd = p.childForFieldName("declarator");
    const name = declared(fd?.childForFieldName("declarator") ?? null);
    const params = (fd?.childForFieldName("parameters")?.namedChildren ?? []).filter((c) => c.type === "parameter_declaration").map((c) => declared(c.childForFieldName("declarator")) ?? "");
    return name === undefined ? undefined : { name, params };
  }
  return undefined;
}

const unwrap = (n: Node): Node => (n.type === "parenthesized_expression" && n.namedChildren[0] ? unwrap(n.namedChildren[0]) : n);
const isGetter = (n: Node): boolean => {
  const e = unwrap(n);
  return e.type === "call_expression" && LAYER_GETTERS.has(e.childForFieldName("function")?.text ?? "");
};
const argNodes = (call: Node): Node[] => (call.childForFieldName("arguments")?.namedChildren ?? []).filter((c) => c.type !== "comment");

/** Whether `n` holds a number literal outside any call, e.g. the `1 << 3` of a layer mask. */
function bareNumber(n: Node): boolean {
  if (n.type === "number_literal") return true;
  if (n.type === "call_expression") return false;
  return n.namedChildren.some(bareNumber);
}

function read(root: Node, map: Mapper, c: Collector): void {
  for (const n of root.descendantsOfType(["identifier", "call_expression", "case_statement", "binary_expression", "subscript_expression", "init_declarator", "preproc_def", "preproc_function_def"])) {
    if (!n) continue;
    const fn = functionOf(n);
    switch (n.type) {
      case "identifier": {
        const p = n.parent;
        if ((p?.type === "preproc_def" || p?.type === "preproc_function_def") && p.childForFieldName("name")?.id === n.id) break;
        c.uses.push({ name: n.text, site: map.site, ...c.pos(map, n) });
        break;
      }
      case "call_expression": {
        const name = n.childForFieldName("function");
        if (name?.type !== "identifier") break;
        const nodes = argNodes(n);
        const args = nodes.map((a) => c.describe(map, a));
        for (const k of LAYER_CALLS[name.text] ?? []) {
          const a = args[k];
          if (a) c.layerArg(map.site, a, fn);
        }
        if (MASK_CALLS.has(name.text) && nodes.some(bareNumber)) c.refuse(map, n);
        c.calls.push({ callee: name.text, args, site: map.site, fn });
        break;
      }
      case "case_statement": {
        const value = n.childForFieldName("value");
        let sw = n.parent;
        while (sw && sw.type !== "switch_statement") sw = sw.parent;
        const subject = sw?.childForFieldName("condition");
        if (!value || !subject) break;
        if (isGetter(subject)) c.layerArg(map.site, c.describe(map, value), fn);
        // A switch over something called layer that isn't a getter call can't be tied to the layer order.
        else if (subject.descendantsOfType("identifier").some((i) => /layer/i.test(i?.text ?? ""))) c.refuse(map, n);
        break;
      }
      case "binary_expression": {
        const op = n.childForFieldName("operator")?.text;
        const left = n.childForFieldName("left");
        const right = n.childForFieldName("right");
        if (!left || !right || (!isGetter(left) && !isGetter(right))) break;
        if (op === "==" || op === "!=") c.layerArg(map.site, c.describe(map, isGetter(left) ? right : left), fn);
        else if (op === "<" || op === ">" || op === "<=" || op === ">=") c.refuse(map, n);
        break;
      }
      case "subscript_expression": {
        const array = n.childForFieldName("argument");
        const index = n.childForFieldName("index");
        if (array?.type === "identifier" && LAYER_ARRAYS.has(array.text) && index) c.layerArg(map.site, c.describe(map, index), fn);
        break;
      }
      case "init_declarator": {
        if (!LAYER_ARRAYS.has(declared(n.childForFieldName("declarator")) ?? "")) break;
        for (const row of n.childForFieldName("value")?.namedChildren ?? []) {
          const designator = row.type === "initializer_pair" ? row.childForFieldName("designator") : null;
          const index = designator?.type === "subscript_designator" ? designator.namedChildren[0] : undefined;
          if (index) c.layerArg(map.site, c.describe(map, index), fn);
          else if (row.type !== "comment") c.refuse(map, row); // rows by position: their order is the layer order
        }
        break;
      }
      case "preproc_def":
      case "preproc_function_def": {
        const name = n.childForFieldName("name");
        const value = n.childForFieldName("value");
        if (!name || !value) break;
        const body = value.text.trim();
        const start = value.startIndex + (value.text.length - value.text.trimStart().length);
        const literal = Number(body);
        if (n.type === "preproc_def" && body !== "" && Number.isInteger(literal) && literal >= 0) {
          c.defines.push({ name: name.text, site: map.site, start: start - map.shift + map.baseOffset, end: start + body.length - map.shift + map.baseOffset, line: value.startPosition.row + 1 + map.baseRow, value: literal });
        } else if (body !== "") {
          c.subs.push({ site: map.site, text: body, baseOffset: start - map.shift + map.baseOffset, baseRow: value.startPosition.row + map.baseRow });
        }
        break;
      }
    }
  }
}

async function collect(sites: readonly QmkSite[]): Promise<Collector> {
  const c = new Collector();
  const run = (site: string, text: string, [pre, post]: [string, string], baseOffset: number, baseRow: number) =>
    withTree(`${pre}${text}${post}`, (root) => read(root, { site, shift: pre.length, baseOffset, baseRow }, c));
  for (const s of sites) await run(s.site, s.source, WRAP[s.kind], 0, 0);
  // A define's body is read as code once its name is known; bodies inside those are not followed.
  for (const sub of c.subs.splice(0)) await run(sub.site, sub.text, BODY, sub.baseOffset, sub.baseRow);
  return c;
}

/**
 * The layer numbers in each site: the literals to renumber when layers move, and the lines that name a layer in a way keyloom
 * can't rewrite. A call to a function whose parameter indexes a layer array (Oryx's `set_layer_color(2)`) counts as naming a layer.
 */
export async function readQmkLayerRefs(sites: readonly QmkSite[], layerIds: readonly string[]): Promise<Map<string, Resolved>> {
  const c = await collect(sites);
  // A function that passes its own layer parameter on makes its callers' arguments layer numbers too.
  for (let changed = true; changed; ) {
    changed = false;
    for (const call of c.calls) {
      for (const k of c.layerParams.get(call.callee) ?? []) {
        const a = call.args[k];
        if (a && c.layerArg(call.site, a, call.fn)) changed = true;
      }
    }
  }
  return resolveLayerRefs({
    layerIds, args: dedupe(c.args), unprovable: c.unprovable, defines: c.defines, uses: c.uses,
    sources: new Map(sites.map((s) => [s.site, s.source])),
  });
}

/** The fixpoint pass sees each call argument again; one entry per position is enough. */
function dedupe(args: LayerArg[]): LayerArg[] {
  const seen = new Set<string>();
  return args.filter((a) => {
    const key = `${a.site}:${a.start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type Parts = Pick<Layout, "layers" | "combos" | "passthrough">;

/** Whether the importer reads this kept block for layer numbers (the rest is not C). */
export const isReadableQmk = (p: Passthrough): boolean => p.firmware === "qmk" && (p.file === "keymap.c" || p.file === "config.h");

/** Writes what `readQmkLayerRefs` found onto the kept source and kept keys of a layout being imported. */
export async function annotateQmkLayerRefs(parts: Parts, layerIds: readonly string[]): Promise<Parts> {
  const sites: QmkSite[] = [];
  parts.passthrough.forEach((p, i) => {
    if (isReadableQmk(p)) sites.push({ site: `p${i}`, source: p.source, kind: p.anchor.startsWith("process_record_user:") ? "cases" : "code" });
  });
  const nativeAt = (b: Binding, site: string): void => {
    if (b.kind === "native" && b.firmware === "qmk") sites.push({ site, source: b.source, kind: "binding" });
  };
  parts.layers.forEach((l, li) => l.bindings.forEach((b, i) => nativeAt(b, `k${li}.${i}`)));
  parts.combos.forEach((c, i) => nativeAt(c.output, `c${i}`));

  const found = await readQmkLayerRefs(sites, layerIds);
  const read = new Set(sites.map((s) => s.site));
  const withRefs = <T extends Binding>(b: T, site: string): T => {
    if (!read.has(site)) return b;
    const r = found.get(site);
    return { ...b, ...(r && r.layerRefs.length > 0 ? { layerRefs: r.layerRefs } : {}), ...(r && r.unprovable.length > 0 ? { unprovable: r.unprovable } : {}) };
  };
  return {
    layers: parts.layers.map((l, li) => ({ ...l, bindings: l.bindings.map((b, i) => withRefs(b, `k${li}.${i}`)) })),
    combos: parts.combos.map((c, i) => ({ ...c, output: withRefs(c.output, `c${i}`) })),
    passthrough: parts.passthrough.map((p, i) => {
      if (!read.has(`p${i}`)) return p;
      const r = found.get(`p${i}`);
      const layerRefs = r?.layerRefs ?? [];
      const unprovable = r?.unprovable ?? [];
      return { ...p, refersToLayerIndices: layerRefs.length > 0 || unprovable.length > 0, layerRefs, ...(unprovable.length > 0 ? { unprovable } : {}) };
    }),
  };
}
