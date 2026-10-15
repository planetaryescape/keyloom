// A ZMK .keymap as a tree (06#import-reads-the-layout-editors-keymap-export). Parsed with
// tree-sitter-devicetree through web-tree-sitter, the same route keymap-drawer takes (D-037): the
// grammar knows nodes, properties and the C preprocessor lines around them, which is all keyloom
// needs. Everything grammar-specific stays in this file.
import { type Node, Language, Parser, type Tree } from "web-tree-sitter";
import dtsGrammar from "tree-sitter-devicetree/tree-sitter-devicetree.wasm" with { type: "file" };
import runtime from "web-tree-sitter/web-tree-sitter.wasm" with { type: "file" };
import { ZmkImportError } from "./import-error.ts";

export type DtValue = { kind: "cells"; text: string } | { kind: "string"; value: string } | { kind: "other"; text: string };
export type DtProp = { name: string; values: DtValue[] };

export type DtNode = {
  /** `hm` in `hm: homerow_mods { ... }`. */
  label?: string;
  /** `homerow_mods`; empty for a `&label { ... }` override. */
  name: string;
  /** `mt` in `&mt { ... }`. */
  ref?: string;
  props: DtProp[];
  children: DtNode[];
  /** The node as written, comments included, its first line's indentation removed from every line. */
  source: string;
  line: number;
};

export type DtItem =
  | { kind: "include"; text: string }
  | { kind: "define"; name: string; params?: string[]; body: string; text: string }
  /** Any other preprocessor block (`#if`, `#undef`...), kept verbatim. */
  | { kind: "cpp"; text: string; line: number }
  | { kind: "node"; node: DtNode };

let parserPromise: Promise<Parser> | undefined;

function getParser(): Promise<Parser> {
  parserPromise ??= (async () => {
    // Bytes, not paths: an embedded file lives in the executable's virtual filesystem (S10).
    await Parser.init({ wasmBinary: await Bun.file(runtime).arrayBuffer() });
    const parser = new Parser();
    parser.setLanguage(await Language.load(new Uint8Array(await Bun.file(dtsGrammar).arrayBuffer())));
    return parser;
  })();
  parserPromise.catch(() => {
    parserPromise = undefined; // a failed init must not poison later calls
  });
  return parserPromise;
}

/** The first place the grammar gave up, as `line 12: near "..."`. */
function firstError(root: Node): string {
  const bad = root.descendantsOfType("ERROR")[0] ?? root;
  const near = bad.text.split("\n")[0]?.trim().slice(0, 60) ?? "";
  return `line ${bad.startPosition.row + 1}${near ? `: near "${near}"` : ""}`;
}

export async function parseDts(source: string): Promise<DtItem[]> {
  const text = source.replace(/\r\n?/g, "\n");
  const parser = await getParser();
  const tree: Tree | null = parser.parse(text);
  if (!tree) throw new ZmkImportError("tree-sitter returned no tree");
  try {
    if (tree.rootNode.hasError) {
      throw new ZmkImportError(`this isn't a devicetree file keyloom can read (${firstError(tree.rootNode)})`);
    }
    return tree.rootNode.namedChildren.flatMap((n) => toItems(n, text));
  } finally {
    tree.delete();
  }
}

/** The text of `node` with the indentation of its first line taken off every line, so it can be re-indented anywhere. */
function dedented(text: string, node: Node): string {
  const lineStart = text.lastIndexOf("\n", node.startIndex - 1) + 1;
  const before = text.slice(lineStart, node.startIndex);
  const indent = /^[ \t]*$/.test(before) ? before.length : 0;
  return text
    .slice(node.startIndex, node.endIndex)
    .split("\n")
    .map((l, i) => (i === 0 ? l : l.replace(new RegExp(`^[ \\t]{0,${indent}}`), "")))
    .join("\n")
    .trimEnd();
}

function toItems(n: Node, text: string): DtItem[] {
  switch (n.type) {
    case "comment":
      return [];
    case "preproc_include":
      return [{ kind: "include", text: n.text.trim() }];
    case "preproc_def":
    case "preproc_function_def": {
      const name = n.namedChildren.find((c) => c.type === "identifier")?.text;
      if (!name) return [{ kind: "cpp", text: n.text.trim(), line: n.startPosition.row + 1 }];
      const params = n.type === "preproc_function_def" ? (n.namedChildren.find((c) => c.type === "preproc_params")?.namedChildren.map((c) => c.text) ?? []) : undefined;
      const argNode = n.namedChildren.find((c) => c.type === "preproc_arg");
      // A trailing backslash continues the body on the next line; the preprocessor joins them.
      const body = (argNode?.text ?? "").replace(/\\\n/g, " ").trim();
      return [{ kind: "define", name, ...(params ? { params } : {}), body, text: n.text.trim() }];
    }
    case "node":
      return [{ kind: "node", node: toNode(n, text) }];
    default:
      return [{ kind: "cpp", text: dedented(text, n), line: n.startPosition.row + 1 }];
  }
}

function toNode(n: Node, text: string): DtNode {
  const brace = n.children.find((c) => c.type === "{");
  const header = text.slice(n.startIndex, brace ? brace.startIndex : n.endIndex).trim();
  const out: DtNode = { name: "", props: [], children: [], source: dedented(text, n), line: n.startPosition.row + 1 };
  if (header.startsWith("&")) out.ref = header.slice(1).trim();
  else {
    // `/omit-if-no-ref/` and `/delete-node/` style prefixes belong to the source text, not the name.
    const m = /^(?:\/[\w-]+\/\s*)*(?:([A-Za-z_]\w*)\s*:\s*)?(.*)$/s.exec(header);
    if (m?.[1]) out.label = m[1];
    out.name = (m?.[2] ?? header).trim();
  }
  for (const c of n.namedChildren) {
    if (c.type === "property") out.props.push(toProp(c, text));
    else if (c.type === "node") out.children.push(toNode(c, text));
  }
  return out;
}

/** The inside of `<...>` with comments blanked: the Layout Editor and the template draw the keyboard in comments between rows. */
function cellsText(n: Node, text: string): string {
  let out = "";
  let at = n.startIndex;
  for (const c of n.descendantsOfType("comment")) {
    if (!c) continue;
    out += `${text.slice(at, c.startIndex)} `;
    at = c.endIndex;
  }
  out += text.slice(at, n.endIndex);
  return out.replace(/^\s*</, "").replace(/>\s*$/, "").trim();
}

function toProp(n: Node, text: string): DtProp {
  const name = n.namedChildren.find((c) => c.type === "identifier")?.text ?? "";
  const eq = n.children.findIndex((c) => c.type === "=");
  const values: DtValue[] = [];
  if (eq >= 0) {
    for (const c of n.children.slice(eq + 1)) {
      if (c.type === "," || c.type === ";" || c.type === "comment") continue;
      if (c.type === "integer_cells") values.push({ kind: "cells", text: cellsText(c, text) });
      else if (c.type === "string_literal") values.push({ kind: "string", value: unquote(c.text) });
      else values.push({ kind: "other", text: c.text });
    }
  }
  return { name, values };
}

/** `"a\"b"` to `a"b`. Only the escapes devicetree strings use are decoded; an unknown one is kept as written. */
function unquote(literal: string): string {
  return literal.slice(1, -1).replace(/\\(["\\ntr])/g, (_, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c));
}
