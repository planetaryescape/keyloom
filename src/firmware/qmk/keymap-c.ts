// Reads keymap.c into plain data: layers, combos, process_record_user cases, and the blocks
// keyloom keeps as Passthrough. Everything tree-sitter-specific stays in this file.
import type { Node } from "web-tree-sitter";
import { type Expr, findFunction, findInitializer, functionName, toExpr, withTree } from "./c-parse.ts";
import { ImportError } from "./source.ts";

export type Chunk = { anchor: string; source: string };

export type ParsedKeymap = {
  /** One entry per `[n] = LAYOUT...(...)`, in file order. */
  layers: Expr[][];
  combos: { arrays: Map<string, Expr[]>; entries: Array<{ array: string; output: Expr }>; unsupported: string[] };
  /** `case X:` blocks of process_record_user, verbatim. */
  cases: Array<{ label: string; source: string }>;
  /** Top-level `#define NAME body` in keymap.c that the keymap uses as a keycode. */
  customKeycodes: Map<string, string>;
  chunks: Chunk[];
};

// Which top-level blocks are code keyloom doesn't model. These are the shapes Oryx generates (S3).
const TAP_DANCE = /tap_dance|dance_|DANCE_|SINGLE_TAP|ACTION_TAP_DANCE|is_press_action/;
const RGB = /rgb_matrix|rgblight|ledmap|hsv_to_rgb|rgb_config_t|set_layer_color/;

function declaredName(node: Node): string | undefined {
  let d: Node | null = node.descendantsOfType("init_declarator")[0]?.childForFieldName("declarator") ?? null;
  while (d && d.type !== "identifier") d = d.childForFieldName("declarator");
  return d?.text;
}

function classify(node: Node, used: ReadonlySet<string>, modelled: ReadonlySet<string>): string | null | "comment" {
  const text = node.text;
  switch (node.type) {
    case "comment":
      return "comment";
    case "preproc_def": {
      const name = node.childForFieldName("name")?.text;
      return name && used.has(name) ? `define:${name}` : null;
    }
    case "function_definition": {
      const name = functionName(node);
      if (!name || name === "process_record_user") return null;
      if (RGB.test(text)) return "rgb";
      if (TAP_DANCE.test(text)) return "tap-dance";
      return `function:${name}`;
    }
    case "preproc_include":
    case "preproc_ifdef":
    case "preproc_if":
      return null;
    default: {
      const name = declaredName(node);
      // keymaps[] and the combo arrays mention TD(DANCE_n) and friends but are imported, not kept.
      if (name && modelled.has(name)) return null;
      if (name === "chordal_hold_layout") return "chordal-hold-layout";
      if (text.includes("tap_dance_codes")) return "tap-dance-codes";
      if (TAP_DANCE.test(text)) return "tap-dance";
      if (RGB.test(text)) return "rgb";
      return null;
    }
  }
}

/** Contiguous top-level nodes with the same class become one chunk, with the original text between them. */
function chunksOf(root: Node, source: string, used: ReadonlySet<string>, modelled: ReadonlySet<string>): Chunk[] {
  const chunks: Chunk[] = [];
  const seen = new Map<string, number>();
  let cur: { anchor: string; start: number; end: number } | undefined;
  const flush = () => {
    if (!cur) return;
    const n = (seen.get(cur.anchor) ?? 0) + 1;
    seen.set(cur.anchor, n);
    // tree-sitter leaves the `;` after `enum x {...}` outside the node.
    const semicolon = /^\s*;/.exec(source.slice(cur.end))?.[0].length ?? 0;
    chunks.push({ anchor: n === 1 ? cur.anchor : `${cur.anchor}#${n}`, source: source.slice(cur.start, cur.end + semicolon) });
    cur = undefined;
  };
  for (const node of root.namedChildren) {
    const cls = classify(node, used, modelled);
    if (cls === "comment") continue;
    if (cls === null) {
      flush();
    } else if (cur?.anchor === cls) {
      cur.end = node.endIndex;
    } else {
      flush();
      cur = { anchor: cls, start: node.startIndex, end: node.endIndex };
    }
  }
  flush();
  return chunks;
}

function parseLayers(root: Node): Expr[][] {
  const init = findInitializer(root, "keymaps");
  if (!init) throw new ImportError("keymap.c has no `keymaps[]` array");
  const layers: Expr[][] = [];
  for (const pair of init.namedChildren) {
    if (pair.type === "comment") continue;
    const value = pair.type === "initializer_pair" ? pair.childForFieldName("value") : null;
    const expr = value ? toExpr(value) : undefined;
    if (expr?.kind !== "call" || !expr.name.startsWith("LAYOUT")) {
      throw new ImportError(`keymaps[] entry ${layers.length} is not a LAYOUT...(...) call`);
    }
    const designator = pair.childForFieldName("designator")?.text.trim();
    if (designator !== `[${layers.length}]`) {
      throw new ImportError(`keymaps[] entry ${layers.length} is written ${designator ?? "without an index"}; keyloom reads layers indexed [0], [1], ... in order`);
    }
    layers.push(expr.args);
  }
  if (layers.length === 0) throw new ImportError("keymaps[] has no layers");
  return layers;
}

function parseCombos(root: Node): ParsedKeymap["combos"] {
  const arrays = new Map<string, Expr[]>();
  const entries: Array<{ array: string; output: Expr }> = [];
  const unsupported: string[] = [];
  const list = findInitializer(root, "key_combos");
  for (const item of list?.namedChildren ?? []) {
    if (item.type === "comment") continue;
    const e = toExpr(item);
    const arrayName = e.kind === "call" && e.name === "COMBO" && e.args.length === 2 ? e.args[0] : undefined;
    const output = e.kind === "call" ? e.args[1] : undefined;
    if (arrayName?.kind !== "id" || !output) {
      unsupported.push(e.text);
      continue;
    }
    const keys = findInitializer(root, arrayName.name);
    if (!keys) {
      unsupported.push(e.text);
      continue;
    }
    arrays.set(arrayName.name, keys.namedChildren.filter((n) => n.type !== "comment").map(toExpr).filter((k) => !(k.kind === "id" && k.name === "COMBO_END")));
    entries.push({ array: arrayName.name, output });
  }
  return { arrays, entries, unsupported };
}

function parseCases(root: Node, source: string): ParsedKeymap["cases"] {
  const fn = findFunction(root, "process_record_user");
  const sw = fn?.descendantsOfType("switch_statement")[0];
  const body = sw?.childForFieldName("body");
  const cases: ParsedKeymap["cases"] = [];
  for (const c of body?.namedChildren ?? []) {
    if (c.type !== "case_statement") continue;
    const text = source.slice(c.startIndex, c.endIndex);
    const label = /^(?:case\s+([^:]+?)|default)\s*:/.exec(text)?.[1]?.replace(/\s+/g, " ");
    cases.push({ label: label ?? "default", source: text });
  }
  return cases;
}

export function parseKeymapC(source: string): Promise<ParsedKeymap> {
  return withTree(source, (root) => {
    const layers = parseLayers(root);
    const usedIds = new Set<string>();
    for (const layer of layers) for (const e of layer) if (e.kind === "id") usedIds.add(e.name);

    const customKeycodes = new Map<string, string>();
    for (const node of root.namedChildren) {
      if (node.type !== "preproc_def") continue;
      const name = node.childForFieldName("name")?.text;
      const value = node.childForFieldName("value")?.text.trim();
      if (name && value && usedIds.has(name)) customKeycodes.set(name, value);
    }
    const combos = parseCombos(root);
    const modelled = new Set(["keymaps", "key_combos", ...combos.arrays.keys()]);
    return {
      layers,
      combos,
      cases: parseCases(root, source),
      customKeycodes,
      chunks: chunksOf(root, source, new Set(customKeycodes.keys()), modelled),
    };
  });
}
