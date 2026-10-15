// Maps one `LAYOUT(...)` argument (a QMK keycode expression) to a keyloom Binding (05).
// Anything outside the model becomes `native` with its source kept (D-024). It never throws:
// a valid Oryx file with a keycode keyloom doesn't know must import, not fail.
import { type KeyCodeInfo, fromQmk, fromQmkShifted, keyCodeInfo } from "../../layout/keycodes.ts";
import { modsText } from "../../layout/render-grid.ts";
import type { Binding, Mod } from "../../layout/schema.ts";
import type { Expr } from "./c-parse.ts";

export const PROFILE_HOME_ROW = "home-row-mods";
export const PROFILE_MOD_TAP = "mod-tap";
export const PROFILE_LAYER_TAP = "layer-tap";

export type MapContext = {
  layerIds: readonly string[];
  /** Position holds a home-row key on this board (`rows.home`). */
  isHomeRow: (position: number) => boolean;
  /** `ST_MACRO_n` name to the id of the Macro it was imported as. */
  macroIds: ReadonlyMap<string, string>;
  /** Keymap-level `#define NAME body` custom keycodes. */
  customKeycodes: ReadonlySet<string>;
};

export type Mapped = {
  binding: Binding;
  /** Set when the binding is a holdTap, so the importer can create the profile. */
  profileId?: string;
  /** Why a binding is `native`; goes in the import report. */
  nativeReason?: string;
};

const L = (...m: Mod[]): Mod[] => m;
const HYPER = L("LCTL", "LSFT", "LALT", "LGUI");
const MEH = L("LCTL", "LSFT", "LALT");

// Modifier-set names, shared by MOD_* constants, wrappers (LGUI(kc)) and mod-taps (LGUI_T(kc)).
const LEFT_RIGHT: Array<[string, Mod]> = [
  ["CTL", "LCTL"], ["SFT", "LSFT"], ["ALT", "LALT"], ["GUI", "LGUI"], ["CMD", "LGUI"], ["WIN", "LGUI"], ["OPT", "LALT"],
];
// Maps, not objects: names come from the file being imported, and `constructor` or `toString`
// must not resolve to something on Object.prototype.
const SINGLE = new Map<string, Mod[]>();
for (const [name, mod] of LEFT_RIGHT) {
  SINGLE.set(`L${name}`, L(mod));
  SINGLE.set(`R${name}`, L(`R${mod.slice(1)}` as Mod));
}
for (const [name, mods] of Object.entries({
  ALGR: L("RALT"), HYPR: HYPER, MEH,
  LCAG: L("LCTL", "LALT", "LGUI"), RCAG: L("RCTL", "RALT", "RGUI"),
  LSG: L("LSFT", "LGUI"), SGUI: L("LSFT", "LGUI"), SCMD: L("LSFT", "LGUI"), SWIN: L("LSFT", "LGUI"), RSG: L("RSFT", "RGUI"),
  LCA: L("LCTL", "LALT"), LSA: L("LSFT", "LALT"), RSA: L("RSFT", "RALT"), RCS: L("RCTL", "RSFT"), LCS: L("LCTL", "LSFT"),
  LCG: L("LCTL", "LGUI"), RCG: L("RCTL", "RGUI"),
})) SINGLE.set(name, mods);

/** `LGUI(kc)`, `C(kc)`, `HYPR(kc)`. */
const WRAPPERS = new Map<string, Mod[]>([...SINGLE, ["C", L("LCTL")], ["S", L("LSFT")], ["A", L("LALT")], ["G", L("LGUI")]]);

/** `LGUI_T(kc)`, `CTL_T(kc)`, `ALL_T(kc)`. The unprefixed names are left-hand. */
const MOD_TAPS = new Map<string, Mod[]>([...SINGLE, ["ALL", HYPER], ...LEFT_RIGHT.map(([name, mod]) => [name, L(mod)] as [string, Mod[]])]);

/** `MOD_LGUI`, `MOD_HYPR`: the first argument of MT(). */
function modConstant(name: string): Mod[] | undefined {
  const m = /^MOD_([A-Z]+)$/.exec(name);
  return m?.[1] ? SINGLE.get(m[1]) : undefined;
}

const MOD_ORDER: Mod[] = ["LCTL", "LSFT", "LALT", "LGUI", "RCTL", "RSFT", "RALT", "RGUI"];
const uniqueMods = (mods: readonly Mod[]): Mod[] => MOD_ORDER.filter((m) => mods.includes(m));

// KeyCodes that are modifier keys (KC_LEFT_ALT) import as `modifier`, not `key`.
const MODIFIER_KEYS = new Map<string, Mod>([
  ["LEFT_CTRL", "LCTL"], ["LEFT_SHIFT", "LSFT"], ["LEFT_ALT", "LALT"], ["LEFT_GUI", "LGUI"],
  ["RIGHT_CTRL", "RCTL"], ["RIGHT_SHIFT", "RSFT"], ["RIGHT_ALT", "RALT"], ["RIGHT_GUI", "RGUI"],
]);

const LAYER_ACTIONS = new Map<string, "momentary" | "toggle" | "to" | "oneShot">([
  ["MO", "momentary"], ["TG", "toggle"], ["TO", "to"], ["OSL", "oneShot"],
]);

const TRANSPARENT = new Set(["_______", "KC_TRNS", "KC_TRANSPARENT"]);
const NONE = new Set(["XXXXXXX", "KC_NO"]);

const NATIVE_LABELS = new Map(
  Object.entries({
    RGB_TOG: "RGB", RGB_MODE_FORWARD: "RGB»", RGB_HUD: "Hue-", RGB_HUI: "Hue+", RGB_SLD: "RGBs", TOGGLE_LAYER_COLOR: "LyrCol",
    QK_BOOT: "Boot", DUAL_FUNC_0: "DF0", KC_MS_UP: "Ms↑", KC_MS_DOWN: "Ms↓", KC_MS_LEFT: "Ms←", KC_MS_RIGHT: "Ms→",
  }),
);

function nativeLabel(expr: Expr, mods?: Mod[]): string {
  if (expr.kind === "id") return NATIVE_LABELS.get(expr.name) ?? expr.name.replace(/^(KC|QK)_/, "").replaceAll("_", "");
  if (expr.kind === "call") {
    if (expr.name === "TD") return `TD${/(\d+)$/.exec(expr.args[0]?.text ?? "")?.[1] ?? ""}`;
    if (expr.name === "OSM" && mods) return `OS${modsText(mods)}`;
    return expr.name;
  }
  return expr.text.replace(/\s+/g, "");
}

function native(expr: Expr, reason: string, label?: string): Mapped {
  return { binding: { kind: "native", firmware: "qmk", source: expr.text, label: label ?? nativeLabel(expr) }, nativeReason: reason };
}

const lookup = (e: Expr | undefined): KeyCodeInfo | undefined => (e?.kind === "id" ? fromQmk(e.name) : undefined);

/** A key expression with modifier wrappers peeled off: `LGUI(LSFT(KC_4))`, `KC_EXLM`. */
function peel(e: Expr): { info: KeyCodeInfo; mods: Mod[] } | undefined {
  if (e.kind === "id") {
    const info = fromQmk(e.name);
    if (info) return { info, mods: [] };
    const shifted = fromQmkShifted(e.name);
    return shifted ? { info: keyCodeInfo(shifted.code), mods: ["LSFT"] } : undefined;
  }
  if (e.kind === "call" && e.args.length === 1 && e.args[0]) {
    const wrap = WRAPPERS.get(e.name);
    const inner = wrap ? peel(e.args[0]) : undefined;
    return wrap && inner ? { info: inner.info, mods: uniqueMods([...wrap, ...inner.mods]) } : undefined;
  }
  return undefined;
}

function modsOf(e: Expr | undefined): Mod[] | undefined {
  if (!e) return undefined;
  if (e.kind === "id") return modConstant(e.name);
  if (e.kind === "or") {
    const parts = e.operands.map((o) => (o.kind === "id" ? modConstant(o.name) : undefined));
    return parts.every((p) => p !== undefined) ? uniqueMods(parts.flat() as Mod[]) : undefined;
  }
  return undefined;
}

function layerOf(e: Expr | undefined, ctx: MapContext): string | undefined {
  return e?.kind === "num" && Number.isInteger(e.value) ? ctx.layerIds[e.value] : undefined;
}

function holdTap(tapExpr: Expr | undefined, hold: { mods: Mod[] } | { layerId: string }, profileId: string, whole: Expr): Mapped {
  const tap = lookup(tapExpr);
  if (!tap) return native(whole, "tap side is not a basic keycode keyloom knows");
  return { binding: { kind: "holdTap", tap: { code: tap.name }, hold, profileId }, profileId };
}

export function mapKey(expr: Expr, position: number, ctx: MapContext): Mapped {
  if (expr.kind === "id") {
    const n = expr.name;
    if (TRANSPARENT.has(n)) return { binding: { kind: "transparent" } };
    if (NONE.has(n)) return { binding: { kind: "none" } };
    if (n === "KC_HYPR") return { binding: { kind: "modifier", mods: HYPER } };
    if (n === "KC_MEH") return { binding: { kind: "modifier", mods: MEH } };
    const macroId = ctx.macroIds.get(n);
    if (macroId) return { binding: { kind: "macro", macroId } };
    if (ctx.customKeycodes.has(n)) return native(expr, "custom keycode handled in process_record_user");
    const peeled = peel(expr);
    if (peeled) {
      const mod = MODIFIER_KEYS.get(peeled.info.name);
      if (mod && peeled.mods.length === 0) return { binding: { kind: "modifier", mods: [mod] } };
      return { binding: { kind: "key", code: peeled.info.name, ...(peeled.mods.length ? { mods: peeled.mods } : {}) } };
    }
    return native(expr, "keycode is not one both QMK and ZMK send");
  }

  if (expr.kind !== "call") return native(expr, "expression keyloom doesn't read");

  const [a, b] = expr.args;
  const name = expr.name;

  if (WRAPPERS.has(name) && expr.args.length === 1) {
    const peeled = peel(expr);
    return peeled
      ? { binding: { kind: "key", code: peeled.info.name, mods: peeled.mods } }
      : native(expr, "modifier wrapper around a keycode keyloom doesn't know");
  }

  if (name === "MT" && expr.args.length === 2) {
    const mods = modsOf(a);
    if (!mods) return native(expr, "mod-tap with a modifier expression keyloom doesn't read");
    return holdTap(b, { mods }, ctx.isHomeRow(position) ? PROFILE_HOME_ROW : PROFILE_MOD_TAP, expr);
  }
  const tapSuffix = name.endsWith("_T") ? MOD_TAPS.get(name.slice(0, -2)) : undefined;
  if (tapSuffix && expr.args.length === 1) {
    return holdTap(a, { mods: tapSuffix }, ctx.isHomeRow(position) ? PROFILE_HOME_ROW : PROFILE_MOD_TAP, expr);
  }

  if (name === "LT" && expr.args.length === 2) {
    const layerId = layerOf(a, ctx);
    if (!layerId) return native(expr, "layer-tap refers to a layer that doesn't exist");
    return holdTap(b, { layerId }, PROFILE_LAYER_TAP, expr);
  }

  const layerAction = LAYER_ACTIONS.get(name);
  if (layerAction && expr.args.length === 1) {
    const layerId = layerOf(a, ctx);
    return layerId ? { binding: { kind: "layer", action: layerAction, layerId } } : native(expr, "refers to a layer that doesn't exist");
  }

  if (name === "OSM") {
    const mods = modsOf(a);
    return native(expr, "one-shot modifiers aren't modelled", nativeLabel(expr, mods));
  }
  if (name === "TD") return native(expr, "tap dance isn't modelled");
  return native(expr, `${name}() isn't modelled`);
}
