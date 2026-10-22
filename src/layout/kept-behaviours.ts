// The ZMK behaviours and macros keyloom kept as written (passthrough, anchored `behavior:<label>` or `macro:<label>`), read into
// the calls they make, so a native binding that uses one can be understood. The source is a devicetree node; this reads only the
// two properties that matter here, `compatible` and `bindings`. Pure.
import type { Passthrough } from "./schema.ts";

/** One behaviour call: `&sk LSHFT` is { name: "sk", params: ["LSHFT"] }. */
export type KeptCall = { name: string; params: string[] };

/** A kept node: its `compatible`, and its `bindings`, one cell per `<...>` with the calls in that cell. */
export type KeptDefinition = { compatible: string | undefined; cells: KeptCall[][] };

/** Labels defined twice (behaviour and macro, or two of one kind) map to null: nothing resolves through an ambiguous name. */
export function keptDefinitions(passthrough: readonly Passthrough[]): ReadonlyMap<string, KeptDefinition | null> {
  const out = new Map<string, KeptDefinition | null>();
  for (const p of passthrough) {
    if (p.firmware !== "zmk") continue;
    const m = /^(?:behavior|macro):(.+)$/.exec(p.anchor);
    if (m?.[1] === undefined) continue;
    const label = m[1];
    out.set(label, out.has(label) ? null : parseKeptNode(p.source));
  }
  return out;
}

export function parseKeptNode(source: string): KeptDefinition {
  const text = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, " ");
  const compatible = /compatible\s*=\s*"([^"]*)"/.exec(text)?.[1];
  const bindings = /bindings\s*=\s*([^;]*);/.exec(text)?.[1] ?? "";
  const cells = [...bindings.matchAll(/<([^>]*)>/g)].map((m) => parseCalls(m[1] ?? ""));
  return { compatible, cells };
}

/** The calls in a `bindings` cell: each `&name` starts one, and the words after it up to the next `&` are its parameters. */
export function parseCalls(text: string): KeptCall[] {
  const calls: KeptCall[] = [];
  for (const piece of text.split("&").slice(1)) {
    const [name, ...params] = piece.trim().split(/\s+/);
    if (name !== undefined && name !== "") calls.push({ name, params });
  }
  return calls;
}
