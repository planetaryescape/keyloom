// Oryx's tap dance code -> TapDance entries (16#tap-dance-is-a-key-with-a-double-tap-slot, S16).
// A reading is only trusted if keyloom's own generator, given the entries read, writes the same code back
// (compared with spacing and modifier order ignored). That makes "plausible but wrong" impossible for
// anything the generator doesn't reproduce: a dance with an extra step, a timeout or a hand-edit stays
// as Passthrough with its keys native, exactly as before.
import type { Macro, SlotAction, TapDance } from "../../layout/schema.ts";
import type { Chunk } from "./keymap-c.ts";
import { type MapContext, mapKey } from "./bindings.ts";
import { type EmitContext } from "./emit-binding.ts";
import { macroBody } from "./emit-macros.ts";
import { danceEnumName, renderTapDances } from "./emit-tap-dance.ts";
import { GenerateError } from "./generate-error.ts";
import { parseExprText } from "./expr-text.ts";

export const TAP_DANCE_ANCHOR = "tap-dance";

export type ImportedTapDances = {
  tapDances: TapDance[];
  /** Anchors of the chunks the entries replace; they must not also be written as Passthrough. */
  consumed: Set<string>;
  warnings: string[];
};

const none = (warnings: string[] = []): ImportedTapDances => ({ tapDances: [], consumed: new Set(), warnings });

/** Index of the bracket that closes the one at `open`, skipping string literals. */
function matching(text: string, open: number): number {
  const opener = text[open] as string;
  const closer = opener === "(" ? ")" : "}";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
    } else if (ch === opener) depth++;
    else if (ch === closer && --depth === 0) return i;
  }
  return -1;
}

function braceBody(source: string, header: RegExp): string | undefined {
  const m = header.exec(source);
  if (!m) return undefined;
  const open = source.indexOf("{", m.index + m[0].length - 1);
  const close = open < 0 ? -1 : matching(source, open);
  return close < 0 ? undefined : source.slice(open + 1, close);
}

/** Statements at the top level of a case body, split on `;` outside parentheses and strings. */
function statements(body: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"') {
      for (i++; i < body.length && body[i] !== '"'; i++) if (body[i] === "\\") i++;
    } else if (ch === "(") i = matching(body, i);
    else if (ch === ";") {
      out.push(body.slice(start, i).trim());
      start = i + 1;
    }
    if (i < 0) return [];
  }
  const rest = body.slice(start).trim();
  return rest === "" ? out : [...out, rest];
}

const LAYER_CALLS: Record<string, Extract<SlotAction, { kind: "layer" }>["action"]> = {
  layer_on: "momentary", layer_invert: "toggle", layer_move: "to",
};

function slotFrom(statement: string, ctx: MapContext, layerIds: readonly string[], macros: readonly Macro[]): SlotAction | undefined {
  const m = /^(\w+)\s*\(([\s\S]*)\)$/.exec(statement);
  if (!m?.[1] || m[2] === undefined) return undefined;
  const [, fn, arg] = m;
  if (fn === "register_code16") {
    const expr = parseExprText(arg);
    const b = expr ? mapKey(expr, -1, ctx).binding : undefined;
    if (b?.kind === "key") return { kind: "key", code: b.code, ...(b.mods?.length ? { mods: b.mods } : {}) };
    return b?.kind === "modifier" ? { kind: "modifier", mods: b.mods } : undefined;
  }
  const layerAction = LAYER_CALLS[fn];
  const layerArg = /^\s*(\d+)\s*$/.exec(arg)?.[1];
  if (layerAction && layerArg !== undefined) {
    const layerId = layerIds[Number(layerArg)];
    return layerId ? { kind: "layer", action: layerAction, layerId } : undefined;
  }
  const oneShot = /^\s*(\d+)\s*,\s*ONESHOT_START\s*$/.exec(arg)?.[1];
  if (fn === "set_oneshot_layer" && oneShot !== undefined) {
    const layerId = layerIds[Number(oneShot)];
    return layerId ? { kind: "layer", action: "oneShot", layerId } : undefined;
  }
  if (fn === "SEND_STRING") {
    const wanted = arg.replace(/\s+/g, " ").trim();
    const macro = macros.find((candidate) => macroBodySafe(candidate)?.replace(/\s+/g, " ").trim() === wanted);
    return macro ? { kind: "macro", macroId: macro.id } : undefined;
  }
  return undefined;
}

function macroBodySafe(macro: Macro): string | undefined {
  try {
    return macroBody(macro);
  } catch (err) {
    if (err instanceof GenerateError) return undefined;
    throw err;
  }
}

const STATE_SLOT: Record<string, "tap" | "hold" | "doubleTap" | "tapThenHold"> = {
  SINGLE_TAP: "tap", SINGLE_HOLD: "hold", DOUBLE_TAP: "doubleTap", DOUBLE_HOLD: "tapThenHold",
};

function readDance(finished: string, n: number, ctx: MapContext, layerIds: readonly string[], macros: readonly Macro[]): TapDance | undefined {
  const switchBody = braceBody(finished, new RegExp(`switch\\s*\\(\\s*dance_state\\[${n}\\]\\.step\\s*\\)\\s*\\{`));
  if (switchBody === undefined) return undefined;
  const slots: Partial<Record<"tap" | "hold" | "doubleTap" | "tapThenHold", SlotAction>> = {};
  const labels = [...switchBody.matchAll(/case\s+(\w+)\s*:/g)];
  for (const [i, label] of labels.entries()) {
    const slot = STATE_SLOT[label[1] as string];
    if (!slot) continue; // DOUBLE_SINGLE_TAP is derived from the tap; the comparison below checks it is what the generator writes
    const end = labels[i + 1]?.index ?? switchBody.length;
    const body = switchBody.slice((label.index as number) + label[0].length, end).replace(/\bbreak\s*;\s*$/, "").trim();
    const parts = statements(body);
    const action = parts.length === 1 ? slotFrom(parts[0] as string, ctx, layerIds, macros) : undefined;
    if (!action) return undefined;
    slots[slot] = action;
  }
  if (!slots.tap) return undefined;
  return { id: `dance-${n}`, name: `Tap dance ${n}`, tap: slots.tap, ...(slots.hold ? { hold: slots.hold } : {}), ...(slots.doubleTap ? { doubleTap: slots.doubleTap } : {}), ...(slots.tapThenHold ? { tapThenHold: slots.tapThenHold } : {}) };
}

/** Spacing collapsed, and the key expression inside register/unregister/tap_code16 written by what it means, not how its modifiers nest. */
function normalized(text: string, ctx: MapContext): string {
  let out = "";
  let i = 0;
  const call = /\b(?:register_code16|unregister_code16|tap_code16)\(/g;
  for (let m = call.exec(text); m; m = call.exec(text)) {
    const open = m.index + m[0].length - 1;
    const close = matching(text, open);
    if (close < 0) break;
    const expr = parseExprText(text.slice(open + 1, close));
    const mapped = expr ? mapKey(expr, -1, ctx).binding : undefined;
    out += text.slice(i, open + 1) + (mapped && mapped.kind !== "native" ? `<${JSON.stringify(mapped)}>` : text.slice(open + 1, close));
    i = close;
    call.lastIndex = close;
  }
  return (out + text.slice(i)).replace(/\s+/g, " ").trim();
}

const TERM_FUNCTION = /uint16_t\s+get_tapping_term\s*\(\s*uint16_t\s+keycode\s*,\s*keyrecord_t\s*\*\s*record\s*\)\s*\{/;

/**
 * The per-key terms keyloom writes (`case TD(DANCE_0): return 200;` and a default of TAPPING_TERM), taken out of `source`.
 * A get_tapping_term with any other case isn't keyloom's, and returns `unreadable` so the dances stay as written.
 */
function takeTerms(source: string): { rest: string; terms: Map<number, number> } | "unreadable" {
  const m = TERM_FUNCTION.exec(source);
  if (!m) return { rest: source, terms: new Map() };
  const open = m.index + m[0].length - 1;
  const close = matching(source, open);
  const switchBody = close < 0 ? undefined : braceBody(source.slice(open, close + 1), /\{\s*switch\s*\(\s*keycode\s*\)\s*\{/);
  if (switchBody === undefined) return "unreadable";
  const terms = new Map<number, number>();
  let rest = switchBody;
  for (const c of switchBody.matchAll(/case\s+TD\(\s*DANCE_(\d+)\s*\)\s*:\s*return\s+(\d+)\s*;/g)) {
    terms.set(Number(c[1]), Number(c[2]));
    rest = rest.replace(c[0], "");
  }
  if (!/^\s*default\s*:\s*return\s+TAPPING_TERM\s*;\s*$/.test(rest) || terms.size === 0) return "unreadable";
  return { rest: source.slice(0, m.index) + source.slice(close + 1), terms };
}

export function importTapDances(chunks: readonly Chunk[], deps: { layerIds: readonly string[]; macros: readonly Macro[]; macroNames: ReadonlyMap<string, string>; keyCtx: MapContext }): ImportedTapDances {
  const relevant = chunks.filter((c) => c.anchor === "tap-dance-codes" || c.anchor === TAP_DANCE_ANCHOR || c.anchor.startsWith(`${TAP_DANCE_ANCHOR}#`));
  if (relevant.length === 0) return none();
  const fail = (why: string) => none([`tap dance code kept as written: ${why}`]);

  // The terms function is part of the same block when it mentions DANCE_n, which is how keyloom writes it.
  const taken = takeTerms(relevant.map((c) => c.source).join("\n"));
  if (taken === "unreadable") return fail("its get_tapping_term has cases keyloom doesn't write");
  const source = taken.rest;
  const entries = [...source.matchAll(/\[\s*DANCE_(\d+)\s*\]\s*=\s*ACTION_TAP_DANCE_FN_ADVANCED\(\s*on_dance_(\d+)\s*,\s*dance_(\d+)_finished\s*,\s*dance_(\d+)_reset\s*\)/g)];
  if (entries.length === 0) return fail("there is no tap_dance_actions[] of ACTION_TAP_DANCE_FN_ADVANCED entries");
  const danceCtx: MapContext = { ...deps.keyCtx };
  const dances: TapDance[] = [];
  for (const [i, e] of entries.entries()) {
    const n = Number(e[1]);
    if (n !== i || [e[2], e[3], e[4]].some((x) => Number(x) !== n)) return fail(`DANCE_${n} isn't numbered in order`);
    const finished = new RegExp(`void\\s+dance_${n}_finished\\s*\\([^)]*\\)\\s*\\{`);
    const body = braceBody(source, finished);
    const dance = body === undefined ? undefined : readDance(body, n, danceCtx, deps.layerIds, deps.macros);
    if (!dance) return fail(`DANCE_${n} does a step keyloom doesn't model`);
    dances.push(dance);
  }

  // A term for a dance that isn't there would be lost on regenerate.
  if ([...taken.terms.keys()].some((n) => n >= dances.length)) return fail("a tapping term names a tap dance that isn't there");
  for (const [n, ms] of taken.terms) dances[n] = { ...(dances[n] as TapDance), termMs: ms };

  const ctx: EmitContext = {
    layerIndex: new Map(deps.layerIds.map((id, i) => [id, i])),
    macroNames: deps.macroNames,
    tapDanceNames: new Map(dances.map((t, i) => [t.id, danceEnumName(i)])),
  };
  let rendered: ReturnType<typeof renderTapDances>;
  try {
    rendered = renderTapDances(dances, [...deps.macros], ctx);
  } catch (err) {
    if (err instanceof GenerateError) return fail(err.message);
    throw err;
  }
  if (!rendered || normalized(source, danceCtx) !== normalized(`${rendered.codes}\n${rendered.code}`, danceCtx)) {
    return fail("it isn't the code keyloom writes for these steps, so it isn't safe to regenerate");
  }
  const consumed = new Set(relevant.map((c) => c.anchor));
  return { tapDances: dances, consumed, warnings: [] };
}
