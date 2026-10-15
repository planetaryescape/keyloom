// Hold-tap profiles, macros and combos -> devicetree nodes (06). Each function returns lines with no
// indentation; the caller indents them to where they sit.
import type { Combo, HoldTapProfile, Macro } from "../../layout/schema.ts";
import type { OptionValue } from "./props.ts";
import { BUILTIN_OPTIONS, BUILTIN_PROFILES } from "./builtins.ts";
import { type EmitContext, bindingToDts, labelOf } from "./emit-binding.ts";
import { GenerateError } from "./generate-error.ts";
import { keyExprText } from "./key-expr.ts";

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

export function renderMacro(m: Macro): string[] {
  const label = labelOf(m.id);
  const cells: string[] = [];
  let mode: "tap" | "press" | "release" = "tap";
  for (const s of m.steps) {
    if (s.op === "waitMs") {
      cells.push(`&macro_wait_time ${s.ms}`);
      continue;
    }
    if (s.code === undefined && (s.mods?.length ?? 0) === 0) throw new GenerateError(`macro "${m.id}" has a ${s.op} step with no key`);
    const switchTo = s.op !== mode ? `&macro_${s.op} ` : "";
    mode = s.op;
    cells.push(`${switchTo}&kp ${keyExprText({ ...(s.code === undefined ? {} : { code: s.code }), ...(s.mods ? { mods: s.mods } : {}) })}`);
  }
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
