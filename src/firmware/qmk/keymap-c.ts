// Reads keymap.c into plain data: layers, combos, process_record_user cases, and the blocks
// keyloom keeps as Passthrough. Everything tree-sitter-specific stays in this file.
import type { Node } from "web-tree-sitter";
import { type Expr, enumConstants, findFunction, findInitializer, functionName, toExpr, withTree } from "./c-parse.ts";
import { ImportError } from "./source.ts";

/** Where the keymap's own custom keycodes (`enum custom_keycodes`) are kept as passthrough, one `NAME` or `NAME = value` per line (D-377). */
export const CUSTOM_KEYCODES_ANCHOR = "custom-keycodes";

export type Chunk = { anchor: string; source: string };

export type ParsedKeymap = {
  /** One entry per `[n] = LAYOUT...(...)`, by layer index. */
  layers: Expr[][];
  /**
   * The enum member each layer was written with (`[NAV] = LAYOUT(...)`), by layer index; empty when the keymap indexes by number.
   * Code and keys name layers by these (`MO(NAV)`), so the importer reads them as the layer they stand for (D-375).
   */
  layerNames: string[];
  combos: { arrays: Map<string, Expr[]>; entries: Array<{ array: string; output: Expr }>; unsupported: string[] };
  /**
   * `case X:` blocks of process_record_user, verbatim. `pressedOnly` is set when the switch sits inside `if (record->event.pressed)`,
   * as QMK's own keymaps write it: the case then runs on a press only, which a bare case in a generated switch would not.
   */
  cases: Array<{ label: string; source: string; pressedOnly: boolean }>;
  /** The keymap's own `enum custom_keycodes`, in order: `VRSN = SAFE_RANGE` is `{ name: "VRSN", value: "SAFE_RANGE" }`. */
  keycodeEnum: Array<{ name: string; value?: string }>;
  /**
   * The `update_tri_layer_state(state, A, B, C)` calls of a `layer_state_set_user` whose whole body is a chain of them, in order, as the
   * three layer arguments of each; null when the function is absent or does anything else (D-387). Such a function stays kept code.
   */
  triLayerCalls: Expr[][] | null;
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
      // The three blocks Oryx's layer colours are made of get their own chunks so the importer can model them (import-lighting.ts).
      if (name === "set_layer_color") return "rgb-set-layer-color";
      if (name === "rgb_matrix_indicators_user") return "rgb-indicators";
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
      if (name === "ledmap") return "rgb-ledmap";
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

function parseLayers(root: Node): { layers: Expr[][]; layerNames: string[] } {
  const init = findInitializer(root, "keymaps");
  if (!init) throw new ImportError("keymap.c has no `keymaps[]` array");
  const constants = enumConstants(root);
  const found: Array<{ index: number; name: string | undefined; args: Expr[] }> = [];
  for (const pair of init.namedChildren) {
    if (pair.type === "comment") continue;
    const value = pair.type === "initializer_pair" ? pair.childForFieldName("value") : null;
    const expr = value ? toExpr(value) : undefined;
    if (expr?.kind !== "call" || !expr.name.startsWith("LAYOUT")) {
      throw new ImportError(`keymaps[] entry ${found.length} is not a LAYOUT...(...) call`);
    }
    const designator = pair.childForFieldName("designator")?.text.trim();
    const written = /^\[\s*([^\]]+?)\s*\]$/.exec(designator ?? "")?.[1];
    const numeric = written !== undefined && /^\d+$/.test(written) ? Number(written) : undefined;
    const named = written !== undefined && numeric === undefined ? constants.get(written) : undefined;
    const index = numeric ?? named;
    if (index === undefined) {
      throw new ImportError(
        written !== undefined && numeric === undefined && /^[A-Za-z_]\w*$/.test(written)
          ? `keymaps[] entry ${found.length} is written ${designator}, and keyloom can't find a value for ${written} in an enum of keymap.c`
          : `keymaps[] entry ${found.length} is written ${designator ?? "without an index"}; keyloom reads layers indexed by a number or an enum member`,
      );
    }
    found.push({ index, name: numeric === undefined ? written : undefined, args: expr.args });
  }
  if (found.length === 0) throw new ImportError("keymaps[] has no layers");
  const byIndex = [...found].sort((a, b) => a.index - b.index);
  byIndex.forEach((l, i) => {
    if (l.index !== i) {
      throw new ImportError(i > 0 && byIndex[i - 1]?.index === l.index ? `keymaps[] has two layers numbered ${l.index}` : `keymaps[] has no layer ${i}; its layers must be numbered 0 to ${found.length - 1} with no gaps`);
    }
  });
  const layerNames = byIndex.every((l) => l.name !== undefined) ? byIndex.map((l) => l.name as string) : [];
  return { layers: byIndex.map((l) => l.args), layerNames };
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
  // Only a guard that wraps nothing but the switch counts: anything else beside it is code keyloom doesn't keep.
  let guard: Node | null = sw?.parent ?? null;
  while (guard && guard.type === "compound_statement" && guard.namedChildren.length === 1) guard = guard.parent;
  const pressedOnly = guard?.type === "if_statement" && /^\(\s*record\s*->\s*event\.pressed\s*\)$/.test(guard.childForFieldName("condition")?.text.trim() ?? "");
  for (const c of body?.namedChildren ?? []) {
    if (c.type !== "case_statement") continue;
    const text = source.slice(c.startIndex, c.endIndex);
    const label = /^(?:case\s+([^:]+?)|default)\s*:/.exec(text)?.[1]?.replace(/\s+/g, " ");
    cases.push({ label: label ?? "default", source: text, pressedOnly });
  }
  return cases;
}

function parseKeycodeEnum(root: Node): ParsedKeymap["keycodeEnum"] {
  const members: ParsedKeymap["keycodeEnum"] = [];
  for (const spec of root.descendantsOfType("enum_specifier")) {
    if (spec?.childForFieldName("name")?.text !== "custom_keycodes") continue;
    for (const m of spec.childForFieldName("body")?.namedChildren ?? []) {
      if (m.type !== "enumerator") continue;
      const name = m.childForFieldName("name")?.text;
      const value = m.childForFieldName("value")?.text.replace(/\s+/g, " ").trim();
      if (name) members.push(value === undefined ? { name } : { name, value });
    }
  }
  return members;
}

/** The anchor the function gets as a kept chunk, and the one the importer drops when it models the function. */
export const LAYER_STATE_ANCHOR = "function:layer_state_set_user";

const TRI_LAYER_CALL = "update_tri_layer_state";

/** `p = update_tri_layer_state(p, A, B, C)` or `return update_tri_layer_state(p, A, B, C)`: the call's layer arguments, else null. */
function triCall(expr: Node | null, param: string): Expr[] | null {
  if (expr === null) return null;
  const e = toExpr(expr);
  if (e.kind !== "call" || e.name !== TRI_LAYER_CALL || e.args.length !== 4) return null;
  const [state, ...layers] = e.args as [Expr, Expr, Expr, Expr];
  return state.kind === "id" && state.name === param ? layers : null;
}

/**
 * `layer_state_t layer_state_set_user(layer_state_t state) { state = update_tri_layer_state(state, 1, 2, 3); return state; }` and the
 * forms QMK's docs write: a chain of assignments then `return state;`, or ending in `return update_tri_layer_state(state, ...);`.
 * Any other statement means the function does something keyloom doesn't model, so none of it is read.
 */
function parseTriLayerCalls(root: Node): Expr[][] | null {
  const fn = findFunction(root, "layer_state_set_user");
  const params = (fn?.childForFieldName("declarator")?.childForFieldName("parameters")?.namedChildren ?? []).filter((c) => c.type === "parameter_declaration");
  const body = fn?.childForFieldName("body");
  const param = params.length === 1 ? declaredParam(params[0] as Node) : undefined;
  if (!fn || !body || param === undefined) return null;
  const calls: Expr[][] = [];
  let returned = false;
  for (const stmt of body.namedChildren) {
    if (stmt.type === "comment") continue;
    if (returned) return null;
    if (stmt.type === "return_statement") {
      const value = stmt.namedChildren.find((c) => c.type !== "comment") ?? null;
      const call = triCall(value, param);
      if (call !== null) calls.push(call);
      else if (!(value?.type === "identifier" && value.text === param)) return null;
      returned = true;
    } else if (stmt.type === "expression_statement") {
      const assign = stmt.namedChildren[0];
      const left = assign?.type === "assignment_expression" ? assign.childForFieldName("left") : null;
      const call = left?.type === "identifier" && left.text === param && assign?.childForFieldName("operator")?.text === "=" ? triCall(assign.childForFieldName("right"), param) : null;
      if (call === null) return null;
      calls.push(call);
    } else return null;
  }
  return returned && calls.length > 0 ? calls : null;
}

function declaredParam(decl: Node): string | undefined {
  let d: Node | null = decl.childForFieldName("declarator");
  while (d && d.type !== "identifier") d = d.childForFieldName("declarator");
  return d?.text;
}

/** The condition calls of a kept `layer_state_set_user` on its own, as `parseKeymapC` reads them from a whole keymap (D-390). */
export const readTriLayerCalls = (source: string): Promise<Expr[][] | null> => withTree(source, parseTriLayerCalls);

export function parseKeymapC(source: string): Promise<ParsedKeymap> {
  return withTree(source, (root) => {
    const { layers, layerNames } = parseLayers(root);
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
      layerNames,
      combos,
      cases: parseCases(root, source),
      keycodeEnum: parseKeycodeEnum(root),
      triLayerCalls: parseTriLayerCalls(root),
      customKeycodes,
      chunks: chunksOf(root, source, new Set(customKeycodes.keys()), modelled),
    };
  });
}
