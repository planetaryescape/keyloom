// Maps one ZMK binding (`&kp A`, `&hm LGUI F`, `&mo LOWER`) to a keyloom Binding (06). Anything
// outside the model becomes `native` with its source kept (D-024). It never throws: a Layout Editor
// export with a behaviour keyloom doesn't know must import, not fail.
import type { Binding, Mod, TapAction } from "../../layout/schema.ts";
import type { HoldKind } from "./builtins.ts";
import { type BehaviorCall, callText } from "./cells.ts";
import { type Defines, evalInt } from "./defines.ts";
import { MODIFIER_CODES, parseKeyExpr } from "./key-expr.ts";

export type MapContext = {
  layerIds: readonly string[];
  defines: Defines;
  /** Hold-tap labels keyloom models, with the kind of hold each takes. Built-in `mt` and `lt` are always known. */
  profiles: ReadonlyMap<string, HoldKind>;
  /** Labels of macros imported as Macros. */
  macros: ReadonlySet<string>;
};

export type Mapped = {
  binding: Binding;
  /** Set when the binding is a holdTap, so the importer can create the profile. */
  profileId?: string;
  /** Why a binding is `native`; goes in the import report. */
  nativeReason?: string;
};

const LAYER_ACTIONS = new Map<string, "momentary" | "toggle" | "to" | "oneShot">([
  ["mo", "momentary"], ["tog", "toggle"], ["to", "to"], ["sl", "oneShot"],
]);

// Short key-cap text for behaviours the editor can't draw as a key.
const NATIVE_LABELS = new Map<string, string>([
  ["bootloader", "Boot"], ["sys_reset", "Reset"], ["caps_word", "CapsW"], ["key_repeat", "Rep"], ["studio_unlock", "Unlock"],
]);

function nativeLabel(call: BehaviorCall): string {
  const fixed = NATIVE_LABELS.get(call.name);
  if (fixed) return fixed;
  const text = call.params.join(" ").replace(/^(RGB|BT|OUT)_/, "");
  return text === "" ? call.name : text;
}

function native(call: BehaviorCall, reason: string): Mapped {
  return { binding: { kind: "native", firmware: "zmk", source: callText(call), label: nativeLabel(call) }, nativeReason: reason };
}

/** The tap side of a hold-tap. A lone modifier key (`&mt LCTRL LSHFT`) is a key with a name, so it is a code here. */
function tapOf(text: string, defines: Defines): TapAction | undefined {
  const e = parseKeyExpr(text, defines);
  if (!e) return undefined;
  if (e.key) return { code: e.key.name, ...(e.mods.length ? { mods: e.mods } : {}) };
  const only = e.mods.length === 1 ? MODIFIER_CODES.get(e.mods[0] as Mod) : undefined;
  return only === undefined ? undefined : { code: only };
}

function layerOf(param: string | undefined, ctx: MapContext): string | undefined {
  if (param === undefined) return undefined;
  const n = evalInt(param, ctx.defines);
  return n === undefined ? undefined : ctx.layerIds[n];
}

export function mapBinding(call: BehaviorCall, ctx: MapContext): Mapped {
  const { name, params } = call;
  const [a, b] = params;

  if (name === "trans" && params.length === 0) return { binding: { kind: "transparent" } };
  if (name === "none" && params.length === 0) return { binding: { kind: "none" } };

  if (name === "kp" && params.length === 1 && a !== undefined) {
    const e = parseKeyExpr(a, ctx.defines);
    if (!e) return native(call, "key name is not one both QMK and ZMK send, or is not a plain key");
    if (!e.key) return { binding: { kind: "modifier", mods: e.mods } };
    return { binding: { kind: "key", code: e.key.name, ...(e.mods.length ? { mods: e.mods } : {}) } };
  }

  const action = LAYER_ACTIONS.get(name);
  if (action && params.length === 1) {
    const layerId = layerOf(a, ctx);
    return layerId ? { binding: { kind: "layer", action, layerId } } : native(call, "refers to a layer that doesn't exist");
  }

  const kind = ctx.profiles.get(name);
  if (kind && params.length === 2 && a !== undefined && b !== undefined) {
    const tapAction = tapOf(b, ctx.defines);
    if (!tapAction) return native(call, "tap side is not a key keyloom knows");
    if (kind === "layer") {
      const layerId = layerOf(a, ctx);
      return layerId ? { binding: { kind: "holdTap", tap: tapAction, hold: { layerId }, profileId: name }, profileId: name } : native(call, "hold refers to a layer that doesn't exist");
    }
    const hold = parseKeyExpr(a, ctx.defines);
    if (!hold || hold.key || hold.mods.length === 0) return native(call, "hold side is not a modifier");
    return { binding: { kind: "holdTap", tap: tapAction, hold: { mods: hold.mods }, profileId: name }, profileId: name };
  }

  if (ctx.macros.has(name) && params.length === 0) return { binding: { kind: "macro", macroId: name } };

  return native(call, ctx.profiles.has(name) || ctx.macros.has(name) ? "used with parameters keyloom doesn't read" : `&${name} isn't modelled`);
}
