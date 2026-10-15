// BK's Karabiner-Elements rules as the MacBook's starting layout (21, D-232). Only the shapes keyloom can say exactly are
// read, and a rule is imported whole or not at all: a rule with one manipulator we don't recognise stays untouched in
// Karabiner's file and is listed here as passthrough, never half-imported and never dropped without a word (D-024).
// keyloom reads karabiner.json and never writes it (D-233); the edit that stops Karabiner grabbing the built-in keyboard
// is text for BK to apply himself.
//
// Recognised, with the Karabiner fields they come from (docs: karabiner-elements.pqrs.org "to_if_alone", "to_if_held_down",
// "to_delayed_action", "from.simultaneous", "to.set_variable", "variable_if", read 2026-10-15):
//   Space-hold layer   from K, to [set_variable v=1], to_after_key_up [set_variable v=0], to_if_alone [K]; siblings with a variable_if v=1 condition
//   Hold-tap           from K, to_if_held_down [a modifier, with modifiers], to_if_alone [tap], threshold from basic.to_if_held_down_threshold_milliseconds (default 500)
//   Combo              from.simultaneous [A, B...], to [one key with modifiers], basic.simultaneous_threshold_milliseconds (default 50)
//   Single-key remap   from K, to [one key with modifiers], nothing else; also simple_modifications and fn_function_keys
import type { BoardDefinition } from "../../boards/schema.ts";
import type { ImportReport } from "../../layout/import-report.ts";
import { type KeyCode, isKeyCode } from "../../layout/keycodes.ts";
import type { Binding, Combo, HoldTapProfile, Layer, Layout, Mod } from "../../layout/schema.ts";
import { physicalKeys } from "./board-config.ts";
import { identityLayout } from "./identity.ts";

export class KarabinerImportError extends Error {
  override name = "KarabinerImportError";
}

type Json = Record<string, unknown>;

const NAMED: Record<string, KeyCode> = {
  return_or_enter: "ENTER", escape: "ESCAPE", delete_or_backspace: "BACKSPACE", tab: "TAB", spacebar: "SPACE", hyphen: "MINUS", equal_sign: "EQUAL",
  open_bracket: "LEFT_BRACKET", close_bracket: "RIGHT_BRACKET", backslash: "BACKSLASH", semicolon: "SEMICOLON", quote: "QUOTE", grave_accent_and_tilde: "GRAVE",
  comma: "COMMA", period: "DOT", slash: "SLASH", caps_lock: "CAPS_LOCK", delete_forward: "DELETE", home: "HOME", end: "END", page_up: "PAGE_UP", page_down: "PAGE_DOWN",
  left_arrow: "LEFT", right_arrow: "RIGHT", up_arrow: "UP", down_arrow: "DOWN", left_control: "LEFT_CTRL", left_shift: "LEFT_SHIFT", left_option: "LEFT_ALT",
  left_command: "LEFT_GUI", right_control: "RIGHT_CTRL", right_shift: "RIGHT_SHIFT", right_option: "RIGHT_ALT", right_command: "RIGHT_GUI",
};

/** A Karabiner `key_code` as a keyloom key, or undefined for one keyloom has no KeyCode for (fn, media, vendor keys). */
export function karabinerKey(name: unknown): KeyCode | undefined {
  if (typeof name !== "string") return undefined;
  if (NAMED[name]) return NAMED[name];
  if (/^[a-z]$/.test(name)) return name.toUpperCase() as KeyCode;
  if (/^[0-9]$/.test(name)) return `N${name}` as KeyCode;
  const f = /^f(\d{1,2})$/.exec(name);
  if (f && isKeyCode(`F${f[1]}`)) return `F${f[1]}` as KeyCode;
  return undefined;
}

const MODIFIER_KEYS: Record<string, Mod> = {
  left_control: "LCTL", left_shift: "LSFT", left_option: "LALT", left_command: "LGUI", right_control: "RCTL", right_shift: "RSFT", right_option: "RALT", right_command: "RGUI",
  control: "LCTL", shift: "LSFT", option: "LALT", command: "LGUI",
};

const modsOf = (list: unknown): Mod[] | undefined => {
  if (list === undefined) return [];
  if (!Array.isArray(list)) return undefined;
  const out: Mod[] = [];
  for (const m of list) {
    const mod = typeof m === "string" ? MODIFIER_KEYS[m] : undefined;
    if (!mod) return undefined;
    if (!out.includes(mod)) out.push(mod);
  }
  return out;
};

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const only = (v: unknown): Json | undefined => (Array.isArray(v) && v.length === 1 && isObj(v[0]) ? v[0] : undefined);
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback);

/** `from.modifiers` may only say "any other modifiers are fine"; anything mandatory changes what the rule matches. */
const plainFrom = (from: Json): boolean => {
  const m = from.modifiers;
  if (m === undefined) return true;
  return isObj(m) && m.mandatory === undefined && Object.keys(m).every((k) => k === "optional");
};

/** A `to` event that is one key with optional modifiers and nothing else, as a binding. */
function outputOf(event: Json | undefined): Binding | undefined {
  if (!event) return undefined;
  const extra = Object.keys(event).filter((k) => k !== "key_code" && k !== "modifiers" && k !== "halt" && k !== "lazy");
  if (extra.length > 0) return undefined;
  const mods = modsOf(event.modifiers);
  if (mods === undefined) return undefined;
  const key = typeof event.key_code === "string" ? event.key_code : undefined;
  const asMod = key ? MODIFIER_KEYS[key] : undefined;
  if (asMod && key?.includes("_")) return { kind: "modifier", mods: [asMod, ...mods.filter((m) => m !== asMod)] };
  const code = karabinerKey(key);
  if (!code) return undefined;
  return mods.length > 0 ? { kind: "key", code, mods } : { kind: "key", code };
}

type Manipulator = Json;

type HoldTapFound = { position: number; tap: KeyCode; mods: Mod[]; holdMs: number };
type LayerKey = { variable: string; position: number; tap: KeyCode; aloneMs: number };

export type KarabinerImport = {
  layout: Layout;
  report: ImportReport;
  suggestedName: string;
  /** What was recognised, rule by rule, in words. */
  recognised: string[];
  /** Rules left as they are in Karabiner's file, with why. */
  passthrough: Array<{ rule: string; reason: string }>;
  /** The edit that stops Karabiner-Elements grabbing the built-in keyboard, for BK to apply. Never applied by keyloom. */
  disableEdit: string;
};

export function disableEditText(unimported: number): string {
  return [
    "To stop Karabiner-Elements and kanata both grabbing the built-in keyboard, add this to the \"devices\" array of the profile in your karabiner.json",
    "(the copy in your dotfiles; keyloom never edits it). Your rules stay in the file, so removing the entry switches them back on:",
    "",
    "  {",
    "    \"identifiers\": { \"is_keyboard\": true, \"product_id\": 0, \"vendor_id\": 0 },",
    "    \"ignore\": true",
    "  }",
    "",
    "The identifiers are what `ioreg` shows for the built-in keyboard (vendor 0, product 0). Karabiner's own list is authoritative: with Karabiner running,",
    "`karabiner_cli --list-connected-devices` prints the built-in keyboard's identifiers; use those if they differ.",
    ...(unimported > 0 ? ["", `Rules keyloom did not import (${unimported}) stop applying to the built-in keyboard once it is ignored; they are listed above.`] : []),
  ].join("\n");
}

export function importKarabiner(text: string, board: BoardDefinition, sourceName = "karabiner.json"): KarabinerImport {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new KarabinerImportError(`${sourceName} isn't valid JSON: ${(err as Error).message}`);
  }
  if (!isObj(doc) || !Array.isArray(doc.profiles)) throw new KarabinerImportError(`${sourceName} has no profiles`);
  const profiles = doc.profiles.filter(isObj);
  const profile = profiles.find((p) => p.selected === true) ?? profiles[0];
  if (!profile) throw new KarabinerImportError(`${sourceName} has no profile`);

  const phys = physicalKeys(board);
  const positionOf = (code: KeyCode): number | undefined => {
    const i = phys.findIndex((k) => k.kind === "key" && k.code === code);
    return i < 0 ? undefined : i;
  };

  const layout = identityLayout(board);
  const base = layout.layers[0] as Layer;
  const baseBindings = [...base.bindings];
  const layers: Layer[] = [];
  const combos: Combo[] = [];
  const profilesOut = new Map<string, HoldTapProfile>();
  const recognised: string[] = [];
  const passthrough: KarabinerImport["passthrough"] = [];
  const warnings: string[] = [];
  const counts: Record<Binding["kind"], number> = { key: 0, modifier: 0, holdTap: 0, layer: 0, macro: 0, tapDance: 0, transparent: 0, none: 0, native: 0 };

  const profileFor = (kind: "space" | "home-row", holdMs: number): string => {
    const id = `${kind}-${holdMs}`;
    if (!profilesOut.has(id)) {
      profilesOut.set(
        id,
        kind === "space"
          // Karabiner makes the layer active the moment Space goes down, whatever else happens: another key's press means hold.
          ? { id, name: `Space layer (${holdMs} ms)`, firmware: "kanata", options: { variant: "tap-hold-press", "hold-ms": holdMs } }
          // "roll = tap": another key's press before the threshold makes the held key a tap, and only the threshold makes it a hold.
          : { id, name: `Home-row mods (${holdMs} ms)`, firmware: "kanata", options: { variant: "tap-hold-tap-keys", "hold-ms": holdMs } },
      );
    }
    return id;
  };

  const rules = isObj(profile.complex_modifications) && Array.isArray(profile.complex_modifications.rules) ? profile.complex_modifications.rules.filter(isObj) : [];
  const globalParams = isObj(profile.complex_modifications) && isObj(profile.complex_modifications.parameters) ? profile.complex_modifications.parameters : {};

  const paramOf = (m: Manipulator, key: string, fallback: number): number => {
    const own = isObj(m.parameters) ? m.parameters[key] : undefined;
    return num(own ?? globalParams[key], fallback);
  };

  rules.forEach((rule, ruleIndex) => {
    const title = typeof rule.description === "string" && rule.description !== "" ? rule.description : `rule ${ruleIndex + 1}`;
    if (rule.enabled === false) {
      passthrough.push({ rule: title, reason: "it is switched off in Karabiner, so keyloom left it alone" });
      return;
    }
    const manips = Array.isArray(rule.manipulators) ? rule.manipulators.filter(isObj) : [];
    if (manips.length === 0) {
      passthrough.push({ rule: title, reason: "it has no manipulators" });
      return;
    }
    const holders = new Map<string, LayerKey>();
    const holdTaps: HoldTapFound[] = [];
    const layerKeys = new Map<string, Array<{ position: number; binding: Binding }>>();
    const comboFound: Combo[] = [];
    const remaps: Array<{ position: number; binding: Binding }> = [];
    let why: string | undefined;

    for (const m of manips) {
      if (m.type !== "basic" || !isObj(m.from)) { why = "a manipulator isn't a basic from/to one"; break; }
      const from = m.from;
      const keys = Object.keys(m).filter((k) => !["type", "from", "to", "to_if_alone", "to_if_held_down", "to_after_key_up", "to_delayed_action", "parameters", "conditions", "description"].includes(k));
      if (keys.length > 0) { why = `it uses ${keys[0]}, which keyloom doesn't read`; break; }

      // Combo
      if (Array.isArray(from.simultaneous)) {
        const parts = from.simultaneous.map((s) => (isObj(s) ? karabinerKey(s.key_code) : undefined));
        const out = outputOf(only(m.to));
        const positions = parts.map((p) => (p ? positionOf(p) : undefined));
        const extraFrom = Object.keys(from).filter((k) => k !== "simultaneous" && k !== "modifiers");
        if (parts.length < 2 || positions.some((p) => p === undefined) || !out || extraFrom.length > 0 || !plainFrom(from) || m.conditions !== undefined || m.to_if_alone || m.to_if_held_down) {
          why = "a simultaneous combo uses something keyloom can't say exactly"; break;
        }
        const id = `combo-${parts.map((p) => (p as string).toLowerCase()).join("-")}`;
        comboFound.push({
          id, name: typeof m.description === "string" ? m.description : `${parts.join(" + ")}`, positions: positions as number[], layerIds: "all", output: out,
          timeoutMs: paramOf(m, "basic.simultaneous_threshold_milliseconds", 50),
        });
        continue;
      }

      const key = karabinerKey(from.key_code);
      const position = key ? positionOf(key) : undefined;
      if (!key || position === undefined || !plainFrom(from) || Object.keys(from).some((k) => k !== "key_code" && k !== "modifiers")) { why = "a manipulator starts from a key keyloom can't place on the MacBook"; break; }

      const conditions = Array.isArray(m.conditions) ? m.conditions : undefined;
      // Layer holder: the Space-hold pattern.
      const toVar = only(m.to)?.set_variable;
      if (isObj(toVar) && typeof toVar.name === "string" && toVar.value === 1) {
        const after = only(m.to_after_key_up)?.set_variable;
        const alone = outputOf(only(m.to_if_alone));
        if (conditions || !isObj(after) || after.name !== toVar.name || after.value !== 0 || !alone || alone.kind !== "key" || alone.mods || m.to_if_held_down || m.to_delayed_action) {
          why = "a layer key uses a shape keyloom doesn't read"; break;
        }
        holders.set(toVar.name, { variable: toVar.name, position, tap: alone.code as KeyCode, aloneMs: paramOf(m, "basic.to_if_alone_timeout_milliseconds", 1000) });
        continue;
      }
      // Key on a layer.
      if (conditions) {
        const c = conditions.length === 1 && isObj(conditions[0]) ? conditions[0] : undefined;
        const out = outputOf(only(m.to));
        if (!c || c.type !== "variable_if" || c.value !== 1 || typeof c.name !== "string" || !out || m.to_if_alone || m.to_if_held_down || m.to_after_key_up) { why = "a layer's key uses a shape keyloom doesn't read"; break; }
        layerKeys.set(c.name, [...(layerKeys.get(c.name) ?? []), { position, binding: out }]);
        continue;
      }
      // Hold-tap.
      if (m.to_if_held_down !== undefined) {
        const held = only(m.to_if_held_down);
        const heldOut = held && !("lazy" in held) ? outputOf(held) : undefined;
        const alone = outputOf(only(m.to_if_alone));
        // Hyper is Left Shift with Control, Option and Command in `modifiers`; outputOf folds those into one set.
        const holdMods = heldOut?.kind === "modifier" ? heldOut.mods : undefined;
        if (!holdMods || holdMods.length === 0 || !alone || alone.kind !== "key" || alone.mods || m.to || m.to_after_key_up) { why = "a hold-tap uses a shape keyloom doesn't read"; break; }
        holdTaps.push({ position, tap: alone.code as KeyCode, mods: holdMods, holdMs: paramOf(m, "basic.to_if_held_down_threshold_milliseconds", 500) });
        continue;
      }
      // Single-key remap.
      const out = outputOf(only(m.to));
      if (out && !m.to_if_alone && !m.to_after_key_up && !m.to_delayed_action) {
        remaps.push({ position, binding: out });
        continue;
      }
      why = "a manipulator isn't one of the shapes keyloom reads";
      break;
    }

    // A layer holder needs its layer keys, and layer keys need a holder.
    if (!why) {
      for (const name of layerKeys.keys()) if (!holders.has(name)) why = `a layer key depends on the variable ${name}, which no key in this rule sets`;
    }
    if (why) {
      passthrough.push({ rule: title, reason: why });
      return;
    }

    for (const h of holdTaps) {
      const kind: "space" | "home-row" = "home-row";
      baseBindings[h.position] = { kind: "holdTap", tap: { code: h.tap }, hold: { mods: h.mods }, profileId: profileFor(kind, h.holdMs) };
    }
    for (const [variable, holder] of holders) {
      const layerId = variable.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "layer";
      const name = variable.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
      const bindings: Binding[] = base.bindings.map(() => ({ kind: "transparent" }));
      for (const k of layerKeys.get(variable) ?? []) bindings[k.position] = k.binding;
      layers.push({ id: layerId, name, bindings });
      baseBindings[holder.position] = { kind: "holdTap", tap: { code: holder.tap }, hold: { layerId }, profileId: profileFor("space", holder.aloneMs) };
    }
    for (const r of remaps) baseBindings[r.position] = r.binding;
    combos.push(...comboFound);
    const parts = [
      holders.size > 0 ? `${holders.size} hold layer${holders.size === 1 ? "" : "s"}` : "",
      holdTaps.length > 0 ? `${holdTaps.length} hold-tap${holdTaps.length === 1 ? "" : "s"}` : "",
      comboFound.length > 0 ? `${comboFound.length} combo${comboFound.length === 1 ? "" : "s"}` : "",
      remaps.length > 0 ? `${remaps.length} key remap${remaps.length === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    recognised.push(`${title}: ${parts.join(", ")}`);
  });

  // Karabiner's per-profile key tables: the same single-key remap, applied before the rules.
  const tables: Array<[string, unknown]> = [["simple_modifications", profile.simple_modifications], ["fn_function_keys", profile.fn_function_keys]];
  for (const [what, table] of tables) {
    if (!Array.isArray(table)) continue;
    for (const entry of table) {
      const from = isObj(entry) && isObj(entry.from) ? karabinerKey(entry.from.key_code) : undefined;
      const position = from ? positionOf(from) : undefined;
      const out = isObj(entry) ? outputOf(only(entry.to)) : undefined;
      if (position === undefined || !out) {
        passthrough.push({ rule: what, reason: "an entry isn't a plain key to key mapping" });
        continue;
      }
      baseBindings[position] = out;
      recognised.push(`${what}: ${from} sends ${out.kind === "key" ? out.code : out.kind}`);
      if (what === "fn_function_keys") warnings.push(`fn_function_keys: ${from} was imported as a plain key remap. Whether it acts with or without fn on the MacBook's function row is settled by the key capture in spike S32`);
    }
  }

  const wasEmpty = recognised.length === 0;
  const imported: Layout = {
    ...layout,
    layers: [{ ...base, bindings: baseBindings }, ...layers],
    combos,
    holdTapProfiles: [...profilesOut.values()],
  };
  for (const l of imported.layers) for (const b of l.bindings) counts[b.kind]++;

  for (const p of passthrough) warnings.push(`Not imported, left as it is in Karabiner: ${p.rule} (${p.reason})`);
  if (wasEmpty) warnings.push("None of the rules in this file were recognised, so the layout is the MacBook's keyboard as it is");
  const devices = Array.isArray(profile.devices) ? profile.devices.length : 0;
  if (devices > 0) warnings.push(`The profile's ${devices} device entr${devices === 1 ? "y" : "ies"} (your external boards, ignored by Karabiner) stay as they are`);

  const report: ImportReport = {
    boardId: board.id, layers: imported.layers.length, keysPerLayer: board.keyCount, bindings: counts, macros: [], tapDances: [], combos: combos.length, settings: 0,
    profiles: imported.holdTapProfiles.map((p) => p.id), native: [],
    passthrough: passthrough.map((p) => ({ file: sourceName, anchor: `rule:${p.rule}`, refersToLayerIndices: false })), warnings,
  };
  report.instructions = disableEditText(passthrough.filter((p) => !p.reason.includes("switched off")).length);
  return { layout: imported, report, suggestedName: "macbook-from-karabiner", recognised, passthrough, disableEdit: disableEditText(passthrough.filter((p) => !p.reason.includes("switched off")).length) };
}
