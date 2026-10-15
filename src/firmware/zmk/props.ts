// Reading devicetree properties as the plain values keyloom stores.
import type { DtNode, DtProp } from "./dts.ts";
import { type Defines, evalInt } from "./defines.ts";
import { tokens } from "./cells.ts";

export const propOf = (n: DtNode, name: string): DtProp | undefined => n.props.find((p) => p.name === name);

/** The property when it is exactly one string. */
export function stringOf(n: DtNode, name: string): string | undefined {
  const v = propOf(n, name)?.values;
  return v?.length === 1 && v[0]?.kind === "string" ? v[0].value : undefined;
}

/** The text inside each `<...>` of a property. */
export function cellsOf(n: DtNode, name: string): string[] {
  return (propOf(n, name)?.values ?? []).flatMap((v) => (v.kind === "cells" ? [v.text] : []));
}

/** Integers inside one `<...>`, or undefined if any cell is not a plain integer once the file's defines are expanded. */
export function intsOf(cells: string, defines: Defines): number[] | undefined {
  const out: number[] = [];
  for (const t of tokens(cells)) {
    const n = evalInt(t, defines);
    if (n === undefined) return undefined;
    out.push(n);
  }
  return out;
}

export type OptionValue = number | boolean | string | number[];

// Properties that are lists of positions even when a node lists one.
const LIST_PROPS = new Set(["hold-trigger-key-positions", "key-positions", "layers"]);

/** A property as a hold-tap option: a flag, a string, a number or a list of numbers. Undefined for anything else. */
export function optionOf(p: DtProp, defines: Defines): OptionValue | undefined {
  if (p.values.length === 0) return true;
  const [first] = p.values;
  if (p.values.length !== 1 || !first) return undefined;
  if (first.kind === "string") return first.value;
  if (first.kind !== "cells") return undefined;
  const ints = intsOf(first.text, defines);
  if (!ints || ints.length === 0) return undefined;
  return ints.length === 1 && !LIST_PROPS.has(p.name) ? (ints[0] as number) : ints;
}
