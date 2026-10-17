// tree-sitter C through web-tree-sitter (D-041). Both WASM files are imported with
// `type: "file"`, so `bun build --compile` embeds them and they load from the executable (S10).
import { Language, type Node, Parser, type Tree } from "web-tree-sitter";
import cGrammar from "tree-sitter-c/tree-sitter-c.wasm" with { type: "file" };
import runtime from "web-tree-sitter/web-tree-sitter.wasm" with { type: "file" };

let parserPromise: Promise<Parser> | undefined;

/** One shared parser. The promise is cached, not the result, so parallel callers don't init twice. */
function getParser(): Promise<Parser> {
  parserPromise ??= (async () => {
    // Bytes, not paths: an embedded file lives in the executable's virtual filesystem.
    await Parser.init({ wasmBinary: await Bun.file(runtime).arrayBuffer() });
    const parser = new Parser();
    parser.setLanguage(await Language.load(new Uint8Array(await Bun.file(cGrammar).arrayBuffer())));
    return parser;
  })();
  parserPromise.catch(() => {
    parserPromise = undefined; // a failed init must not poison later calls
  });
  return parserPromise;
}

/**
 * Parses `source` and hands the tree to `fn`; the tree's WASM memory is freed afterwards.
 * `PROGMEM` is blanked out first: it is an AVR storage attribute, and the C grammar reads it as
 * the declared name. Same length, so node offsets still index into the original text.
 */
export async function withTree<T>(source: string, fn: (root: Node) => T): Promise<T> {
  const parser = await getParser();
  const tree: Tree | null = parser.parse(source.replace(/\bPROGMEM\b/g, (m) => " ".repeat(m.length)));
  if (!tree) throw new Error("tree-sitter returned no tree");
  try {
    return fn(tree.rootNode);
  } finally {
    tree.delete();
  }
}

/** The part of a C expression keyloom reads: calls, names, numbers, and `a | b`. */
export type Expr =
  | { kind: "id"; name: string; text: string }
  | { kind: "num"; value: number; text: string }
  | { kind: "call"; name: string; args: Expr[]; text: string }
  | { kind: "or"; operands: Expr[]; text: string }
  | { kind: "other"; text: string };

export function toExpr(node: Node): Expr {
  const text = node.text;
  switch (node.type) {
    case "identifier":
      return { kind: "id", name: text, text };
    case "number_literal": {
      const value = Number(text.replace(/[uUlL]+$/, ""));
      return Number.isFinite(value) ? { kind: "num", value, text } : { kind: "other", text };
    }
    case "parenthesized_expression": {
      const inner = node.namedChildren[0];
      return inner ? toExpr(inner) : { kind: "other", text };
    }
    case "call_expression": {
      const fn = node.childForFieldName("function");
      const args = node.childForFieldName("arguments");
      if (fn?.type !== "identifier" || !args) return { kind: "other", text };
      // Hand-written keymaps draw each half in comments inside LAYOUT(...); Oryx's never have any.
      return { kind: "call", name: fn.text, args: args.namedChildren.filter((n) => n.type !== "comment").map(toExpr), text };
    }
    case "binary_expression": {
      if (node.childForFieldName("operator")?.text !== "|") return { kind: "other", text };
      const left = node.childForFieldName("left");
      const right = node.childForFieldName("right");
      if (!left || !right) return { kind: "other", text };
      const l = toExpr(left);
      const r = toExpr(right);
      return { kind: "or", operands: [...(l.kind === "or" ? l.operands : [l]), ...(r.kind === "or" ? r.operands : [r])], text };
    }
    default:
      return { kind: "other", text };
  }
}

/** The identifier a (possibly array) declarator declares: `combo0` in `combo0[]`. */
function declaredName(declarator: Node | null): string | undefined {
  let d = declarator;
  while (d && d.type !== "identifier") d = d.childForFieldName("declarator");
  return d?.text;
}

/** `name[...] = { ... }` anywhere in the tree. PROGMEM makes tree-sitter emit an ERROR node, but the declarator survives. */
export function findInitializer(root: Node, name: string): Node | undefined {
  for (const decl of root.descendantsOfType("init_declarator")) {
    if (decl && declaredName(decl.childForFieldName("declarator")) === name) return decl.childForFieldName("value") ?? undefined;
  }
  return undefined;
}

export function functionName(node: Node): string | undefined {
  return declaredName(node.childForFieldName("declarator")?.childForFieldName("declarator") ?? null);
}

export function findFunction(root: Node, name: string): Node | undefined {
  return root.namedChildren.find((c) => c.type === "function_definition" && functionName(c) === name);
}

/** A constant integer expression as an enum value may write it: a number, an earlier constant, parentheses, `+` and `-`. */
function constantValue(node: Node, known: ReadonlyMap<string, number>): number | undefined {
  switch (node.type) {
    case "number_literal": {
      const v = Number(node.text.replace(/[uUlL]+$/, ""));
      return Number.isInteger(v) ? v : undefined;
    }
    case "identifier":
      return known.get(node.text);
    case "parenthesized_expression": {
      const inner = node.namedChildren[0];
      return inner ? constantValue(inner, known) : undefined;
    }
    case "binary_expression": {
      const op = node.childForFieldName("operator")?.text;
      const l = node.childForFieldName("left");
      const r = node.childForFieldName("right");
      const a = l ? constantValue(l, known) : undefined;
      const b = r ? constantValue(r, known) : undefined;
      if (a === undefined || b === undefined) return undefined;
      return op === "+" ? a + b : op === "-" ? a - b : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Every enum member keyloom can give a number, in file order: `enum layers { BASE, NAV = 2, _SYM }` is BASE 0, NAV 2, _SYM 3. A member
 * whose value is an expression keyloom doesn't evaluate (`SAFE_RANGE`) has none, and neither do the implicit members after it until the next explicit value.
 */
export function enumConstants(root: Node): Map<string, number> {
  const known = new Map<string, number>();
  for (const spec of root.descendantsOfType("enum_specifier")) {
    const body = spec?.childForFieldName("body");
    let next: number | undefined = 0;
    for (const member of body?.namedChildren ?? []) {
      if (member.type !== "enumerator") continue;
      const name = member.childForFieldName("name")?.text;
      const valueNode = member.childForFieldName("value");
      const value: number | undefined = valueNode ? constantValue(valueNode, known) : next;
      if (name && value !== undefined) known.set(name, value);
      next = value === undefined ? undefined : value + 1;
    }
  }
  return known;
}
