// The ZMK behaviours and macros keyloom kept as written (passthrough, anchored `behavior:<label>` or `macro:<label>`), read into
// the calls they make, so a native binding that uses one can be understood. The source is a devicetree node; this reads only the
// two properties that matter here, `compatible` and `bindings`. Pure.
import type { Passthrough } from "./schema.ts";

/** One behaviour call: `&sk LSHFT` is { name: "sk", params: ["LSHFT"] }. */
export type KeptCall = { name: string; params: string[] };

/**
 * A kept node: its `compatible`, its `bindings` (one cell per `<...>`, with the calls in that cell), and its `#binding-cells`, which is
 * how many parameters a call of it takes. Undefined when the node doesn't declare one, so no call of it reads.
 */
export type KeptDefinition = { compatible: string | undefined; cells: KeptCall[][]; bindingCells: number | undefined; tappingTermMs?: number };

/** Labels defined twice (behaviour and macro, or two of one kind) map to null: nothing resolves through an ambiguous name. */
export function keptDefinitions(passthrough: readonly Passthrough[]): ReadonlyMap<string, KeptDefinition | null> {
  const out = new Map<string, KeptDefinition | null>();
  for (const p of passthrough) {
    if (p.firmware !== "zmk") continue;
    const m = /^(?:behavior|macro):(.+)$/.exec(p.anchor);
    if (m?.[1] === undefined) continue;
    const label = m[1];
    const parsed = parseKeptNode(p.source);
    out.set(label, out.has(label) || parsed === null ? null : parsed);
  }
  return out;
}

/** Null when a cell can't be read as calls, so nothing resolves through a node keyloom can't read whole. */
export function parseKeptNode(source: string): KeptDefinition | null {
  const text = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, " ");
  const compatible = /compatible\s*=\s*"([^"]*)"/.exec(text)?.[1];
  const bindings = /bindings\s*=\s*([^;]*);/.exec(text)?.[1] ?? "";
  const cells: KeptCall[][] = [];
  for (const m of bindings.matchAll(/<([^>]*)>/g)) {
    const calls = parseCalls(m[1] ?? "");
    if (calls === undefined) return null;
    cells.push(calls);
  }
  const declared = /#binding-cells\s*=\s*<\s*(\d+)\s*>/.exec(text)?.[1];
  const terms = [...text.matchAll(/\btapping-term-ms\s*=\s*<\s*(\d+)\s*>\s*;/g)];
  const definition: KeptDefinition = { compatible, cells, bindingCells: declared === undefined ? undefined : Number(declared) };
  if (terms.length === 1) definition.tappingTermMs = Number(terms[0]![1]);
  return definition;
}

/**
 * The calls in a `bindings` cell: each `&name` starts one, and the words after it up to the next `&` are its parameters. Undefined when
 * there is text before the first `&`, or a name that isn't an identifier, since a call keyloom can't read must not be read as another.
 */
export function parseCalls(text: string): KeptCall[] | undefined {
  const [head = "", ...pieces] = text.split("&");
  if (head.trim() !== "") return undefined;
  const calls: KeptCall[] = [];
  for (const piece of pieces) {
    const [name, ...params] = piece.trim().split(/\s+/);
    if (name === undefined || !/^[A-Za-z_]\w*$/.test(name)) return undefined;
    calls.push({ name, params });
  }
  return calls;
}
