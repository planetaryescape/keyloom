// Hold-tap profiles, macros and combos -> devicetree nodes (06). Each function returns lines with no
// indentation; the caller indents them to where they sit.
import type { Combo, ConditionalLayer, HoldTapProfile, Macro, SlotAction, TapDance } from "../../layout/schema.ts";
import { textKeys } from "../../layout/text-keys.ts";
import type { OptionValue } from "./props.ts";
import { BUILTIN_OPTIONS, BUILTIN_PROFILES, ZMK_MACRO_DEFAULT_WAIT_MS } from "./builtins.ts";
import { type EmitContext, bindingToDts, labelOf } from "./emit-binding.ts";
import { GenerateError } from "./generate-error.ts";
import { keyExprText } from "./key-expr.ts";
import { nodeNameOf } from "./slug.ts";

const quote = (s: string): string => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;

const PROP_NAME = /^[A-Za-z0-9,._+?#-]+$/;

// The properties people tune first come first; the rest follow alphabetically so output is stable.
const PROP_ORDER = ["flavor", "tapping-term-ms", "quick-tap-ms", "require-prior-idle-ms"];

function propLines(options: Readonly<Record<string, OptionValue>>, skip: ReadonlySet<string>): string[] {
  const names = Object.keys(options).filter((k) => !skip.has(k));
  names.sort((a, b) => (PROP_ORDER.indexOf(a) + 1 || 99) - (PROP_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
  return names.flatMap((name) => {
    const v = options[name] as OptionValue;
    if (!PROP_NAME.test(name)) throw new GenerateError(`the option "${name}" isn't a devicetree property name`);
    if (v === false) return [];
    if (v === true) return [`${name};`];
    if (typeof v === "string") return [`${name} = ${quote(v)};`];
    return [`${name} = <${Array.isArray(v) ? v.join(" ") : v}>;`];
  });
}

/** `<&kp>, <&kp>` for a stored `&kp &kp`; a profile made without one is a layer-tap when its holds are layers. */
function bindingsProp(profile: HoldTapProfile, layerHold: boolean): string {
  const stored = profile.options.bindings;
  const names = typeof stored === "string" ? stored.split(/\s+/).filter(Boolean) : layerHold ? ["&mo", "&kp"] : ["&kp", "&kp"];
  if (names.length !== 2 || names.some((n) => !/^&\w+$/.test(n))) throw new GenerateError(`hold-tap "${profile.id}": its bindings option "${String(stored)}" isn't two behaviours like "&kp &kp"`);
  return `bindings = <${names[0]}>, <${names[1]}>;`;
}

export function renderProfile(profile: HoldTapProfile, layerHold: boolean): string[] {
  const label = labelOf(profile.id);
  return [
    `${label}: ${label} {`,
    '    compatible = "zmk,behavior-hold-tap";',
    `    display-name = ${quote(profile.name)};`,
    "    #binding-cells = <2>;",
    `    ${bindingsProp(profile, layerHold)}`,
    ...propLines(profile.options, new Set(["bindings"])).map((l) => `    ${l}`),
    "};",
  ];
}

const same = (a: OptionValue | undefined, b: OptionValue | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);

/** `&mt { tapping-term-ms = <150>; };` for the options of a built-in that differ from ZMK's, or nothing. */
export function renderBuiltinOverride(profile: HoldTapProfile): string[] {
  const defaults = BUILTIN_OPTIONS[profile.id] ?? {};
  const changed: Record<string, OptionValue> = {};
  for (const [k, v] of Object.entries(profile.options)) if (k !== "bindings" && !same(v, defaults[k])) changed[k] = v;
  const lines = propLines(changed, new Set());
  return lines.length === 0 ? [] : [`&${profile.id} {`, ...lines.map((l) => `    ${l}`), "};"];
}

export const isBuiltin = (id: string): boolean => BUILTIN_PROFILES.has(id);

/**
 * `&macro_wait_time N` is not a pause: behavior_macro.c queues every binding with the current wait time as the delay
 * after it, so the setting lasts for everything that follows. A one-off pause of N ms after a binding is therefore
 * `&macro_wait_time N`, that binding, then `&macro_wait_time <default>` (same file, queue_macro, and
 * behavior_queue.c, which sleeps `wait` ms after invoking an item). A pause with no binding before it is carried by
 * a `&none` press, whose only delay is that wait.
 */
export function renderMacro(m: Macro): string[] {
  const label = labelOf(m.id);
  const items: Array<{ cell: string; waitMs?: number }> = [];
  let mode: "tap" | "press" | "release" = "tap";
  for (const s of m.steps) {
    if (s.op === "waitMs") {
      let last = items[items.length - 1];
      if (!last) {
        items.push({ cell: `${mode === "press" ? "" : "&macro_press "}&none` });
        mode = "press";
        last = items[0] as (typeof items)[number];
      }
      last.waitMs = (last.waitMs ?? 0) + s.ms;
      continue;
    }
    if (s.op === "text") {
      // ZMK has no "type this string", so each character is a tap, shifted where the character needs it.
      const typed = textKeys(s.text);
      if (!typed.ok) throw new GenerateError(`macro "${m.id}": "${typed.char}" can't be typed by a text step; keyloom types US-layout letters, digits and punctuation`);
      for (const k of typed.keys) {
        items.push({ cell: `${mode === "tap" ? "" : "&macro_tap "}&kp ${keyExprText({ code: k.code, ...(k.shift ? { mods: ["LSFT" as const] } : {}) })}` });
        mode = "tap";
      }
      continue;
    }
    if (s.code === undefined && (s.mods?.length ?? 0) === 0) throw new GenerateError(`macro "${m.id}" has a ${s.op} step with no key`);
    const switchTo = s.op !== mode ? `&macro_${s.op} ` : "";
    mode = s.op;
    items.push({ cell: `${switchTo}&kp ${keyExprText({ ...(s.code === undefined ? {} : { code: s.code }), ...(s.mods ? { mods: s.mods } : {}) })}` });
  }
  const cells = items.flatMap((i) =>
    i.waitMs === undefined ? [i.cell] : [`&macro_wait_time ${i.waitMs}`, i.cell, `&macro_wait_time ${ZMK_MACRO_DEFAULT_WAIT_MS}`]);
  return [
    `${label}: ${label} {`,
    '    compatible = "zmk,behavior-macro";',
    `    display-name = ${quote(m.name)};`,
    "    #binding-cells = <0>;",
    ...cells.map((c, i) => `    ${i === 0 ? "bindings = " : "           "}<${c}>${i === cells.length - 1 ? ";" : ","}`),
    "};",
  ];
}

const NODE_NAME = /[^A-Za-z0-9_,.+-]/g;
export const comboNodeName = (c: Combo): string => c.name.replace(NODE_NAME, "_");

export function renderCombo(c: Combo, ctx: EmitContext): string[] {
  // Every layer is the absence of `layers`; `<(-1)>` does not compile on moergo-sc/zmk ce69e85 (S6 build, 2026-10-15).
  const layers = c.layerIds === "all" ? undefined : c.layerIds.map((id) => {
    const i = ctx.layerIndex.get(id);
    if (i === undefined) throw new GenerateError(`combo "${c.name}" is on layer "${id}", which doesn't exist`);
    return String(i);
  }).join(" ");
  let output: string;
  try {
    output = bindingToDts(c.output, ctx);
  } catch (err) {
    throw new GenerateError(`combo "${c.name}": ${(err as Error).message}`);
  }
  if (c.output.kind === "holdTap") throw new GenerateError(`combo "${c.name}" outputs a hold-tap, which ZMK combos can't`);
  return [
    `${comboNodeName(c)} {`,
    ...(c.timeoutMs === undefined ? [] : [`    timeout-ms = <${c.timeoutMs}>;`]),
    `    key-positions = <${c.positions.join(" ")}>;`,
    ...(layers === undefined ? [] : [`    layers = <${layers}>;`]),
    `    bindings = <${output}>;`,
    "};",
  ];
}

/** One `zmk,conditional-layers` child: `then-layer` is on while every `if-layers` layer is (D-387). Layers are written by their current index. */
export function renderConditionalLayer(c: ConditionalLayer, ctx: EmitContext): string[] {
  const index = (id: string): number => {
    const i = ctx.layerIndex.get(id);
    if (i === undefined) throw new GenerateError(`conditional layer "${c.id}" names layer "${id}", which doesn't exist`);
    return i;
  };
  const ifs = c.ifLayerIds.map(index);
  const then = index(c.thenLayerId);
  if (new Set([...ifs, then]).size !== 3) throw new GenerateError(`conditional layer "${c.id}" must name three different layers`);
  return [`${nodeNameOf(c.id)} {`, `    if-layers = <${ifs.join(" ")}>;`, `    then-layer = <${then}>;`, "};"];
}

/** The behaviour and parameter a tap dance slot is invoked with, such as `&kp` and `LC(A)`. */
function invocation(a: SlotAction, ctx: EmitContext): { behavior: string; param: string } {
  const text = bindingToDts(a, ctx);
  const [behavior, ...rest] = text.split(/\s+/);
  // A macro takes no parameter; a hold-tap passes one to every behaviour it calls, which the macro ignores.
  return { behavior: behavior as string, param: rest.length === 0 ? "0" : rest.join(" ") };
}

const DEFAULT_TERM_MS = 200;

/**
 * A tap dance's nodes: a `&td`-style behaviour whose first position is the tap, and whose second is the
 * double-tap, with a generated hold-tap in a position that also has a hold (16: ZMK has no tap-then-hold,
 * so it is a hold-tap in the second position). Hold-taps are tap-preferred, which is what QMK's tap dance
 * does: held past the term with nothing pressed in between is a hold, anything else is a tap.
 */
export function renderTapDance(td: TapDance, ctx: EmitContext): string[] {
  const label = labelOf(td.id);
  const term = td.termMs ?? DEFAULT_TERM_MS;
  const nodes: string[][] = [];
  const holdTap = (suffix: string, name: string, hold: SlotAction, tap: SlotAction | undefined): string => {
    const h = invocation(hold, ctx);
    const t = tap ? invocation(tap, ctx) : { behavior: "&none", param: "0" };
    const nodeLabel = `${label}_${suffix}`;
    nodes.push([
      `${nodeLabel}: ${nodeLabel} {`,
      '    compatible = "zmk,behavior-hold-tap";',
      `    display-name = ${quote(name)};`,
      "    #binding-cells = <2>;",
      '    flavor = "tap-preferred";',
      `    tapping-term-ms = <${term}>;`,
      `    bindings = <${h.behavior}>, <${t.behavior}>;`,
      "};",
    ]);
    return `&${nodeLabel} ${h.param} ${t.param}`;
  };
  let first: string;
  let second: string | undefined;
  try {
    first = td.hold ? holdTap("hold", `${td.name} (tap, hold)`, td.hold, td.tap) : bindingToDts(td.tap, ctx);
    if (td.tapThenHold) second = holdTap("tap_hold", `${td.name} (double-tap, hold)`, td.tapThenHold, td.doubleTap);
    else if (td.doubleTap) second = bindingToDts(td.doubleTap, ctx);
  } catch (err) {
    if (err instanceof GenerateError) throw new GenerateError(`tap dance "${td.name}": ${err.message}`);
    throw err;
  }
  const bindings = second === undefined ? [first] : [first, second];
  return [
    ...nodes.flatMap((n) => [...n, ""]),
    `${label}: ${label} {`,
    '    compatible = "zmk,behavior-tap-dance";',
    `    display-name = ${quote(td.name)};`,
    "    #binding-cells = <0>;",
    `    tapping-term-ms = <${term}>;`,
    ...bindings.map((b, i) => `    ${i === 0 ? "bindings = " : "           "}<${b}>${i === bindings.length - 1 ? ";" : ","}`),
    "};",
  ];
}
