// Hold-tap and macro nodes -> HoldTapProfile and Macro (06). A node keyloom can't model completely
// comes back as a reason, and the importer keeps the node verbatim instead, so nothing is half-read.
import type { HoldTapProfile, Macro, MacroStep } from "../../layout/schema.ts";
import { parseCalls } from "./cells.ts";
import { type Defines, evalInt } from "./defines.ts";
import type { DtNode } from "./dts.ts";
import type { HoldKind } from "./builtins.ts";
import { parseKeyExpr } from "./key-expr.ts";
import { type OptionValue, cellsOf, optionOf, propOf, stringOf } from "./props.ts";

const HOLD_TAP = "zmk,behavior-hold-tap";
const MACRO = "zmk,behavior-macro";

export const isHoldTap = (n: DtNode): boolean => stringOf(n, "compatible") === HOLD_TAP;
export const isMacro = (n: DtNode): boolean => stringOf(n, "compatible") === MACRO;

/** The display name: `display-name`, the older `label`, then the node's own label. */
const nameOf = (n: DtNode): string => stringOf(n, "display-name") ?? stringOf(n, "label") ?? n.label ?? n.name;

const HOLD_TAP_FIXED = new Set(["compatible", "#binding-cells", "label", "display-name", "bindings"]);
const MACRO_FIXED = new Set(["compatible", "#binding-cells", "label", "display-name", "bindings"]);

const hasCells = (n: DtNode, prop: string, value: number, defines: Defines): boolean => {
  const c = cellsOf(n, prop);
  return c.length === 1 && evalInt(c[0] as string, defines) === value;
};

export type ImportedHoldTap = { profile: HoldTapProfile; hold: HoldKind };

export function importHoldTap(n: DtNode, defines: Defines): ImportedHoldTap | string {
  if (!n.label) return "it has no label to refer to it by";
  if (n.label === "mt" || n.label === "lt") return `it replaces the built-in &${n.label}`;
  if (!hasCells(n, "#binding-cells", 2, defines)) return "it doesn't take two parameters";
  const behaviors = cellsOf(n, "bindings").map((c) => parseCalls(c).calls);
  if (behaviors.length !== 2 || behaviors.some((b) => b.length !== 1 || b[0]?.params.length !== 0)) return "its bindings aren't two plain behaviours";
  const [holdName, tapName] = behaviors.map((b) => b[0]?.name);
  if (tapName !== "kp" || (holdName !== "kp" && holdName !== "mo")) return `its bindings are &${holdName} and &${tapName}, and keyloom reads only &kp/&kp and &mo/&kp`;
  const options: Record<string, OptionValue> = { bindings: `&${holdName} &${tapName}` };
  for (const p of n.props) {
    if (HOLD_TAP_FIXED.has(p.name)) continue;
    const v = optionOf(p, defines);
    if (v === undefined) return `the property ${p.name} isn't a plain number, flag, string or list of numbers`;
    options[p.name] = v;
  }
  return { profile: { id: n.label, name: nameOf(n), firmware: "zmk", options }, hold: holdName === "mo" ? "layer" : "mods" };
}

export function importMacro(n: DtNode, defines: Defines): Macro | string {
  if (!n.label) return "it has no label to refer to it by";
  if (!hasCells(n, "#binding-cells", 0, defines)) return "it takes parameters";
  const extra = n.props.find((p) => !MACRO_FIXED.has(p.name));
  if (extra) return `it sets ${extra.name}, which keyloom doesn't model`;
  if (!propOf(n, "bindings")) return "it has no bindings";
  const steps: MacroStep[] = [];
  let mode: "tap" | "press" | "release" = "tap";
  for (const cell of cellsOf(n, "bindings")) {
    const { calls, leading } = parseCalls(cell);
    if (leading.length > 0) return "its bindings contain something other than behaviours";
    for (const c of calls) {
      if (c.name === "macro_tap" || c.name === "macro_press" || c.name === "macro_release") {
        if (c.params.length > 0) return `&${c.name} takes no parameters`;
        mode = c.name.slice("macro_".length) as typeof mode;
      } else if (c.name === "macro_wait_time" && c.params.length === 1) {
        const ms = evalInt(c.params[0] as string, defines);
        if (ms === undefined || ms < 0) return "a wait time isn't a plain number";
        steps.push({ op: "waitMs", ms });
      } else if (c.name === "kp" && c.params.length === 1) {
        const e = parseKeyExpr(c.params[0] as string, defines);
        if (!e) return `&kp ${c.params[0]} isn't a key keyloom models`;
        steps.push({ op: mode, ...(e.key ? { code: e.key.name } : {}), ...(e.mods.length ? { mods: e.mods } : {}) });
      } else return `it uses &${c.name}, which keyloom doesn't model in macros`;
    }
  }
  if (steps.length === 0) return "it has no steps";
  return { id: n.label, name: nameOf(n), steps };
}
