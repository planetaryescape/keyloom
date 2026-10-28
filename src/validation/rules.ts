// The rung 2 error rules (07#errors). Each takes a whole document so the same rule can run on
// the layout before and after a change; validate.ts reports only what the change made worse.
// Reachability (reachability.ts) supplies layer_unreachable and layer_trap here and function_lost below.
import { hasLightingControls, lightingControlsRefusal, lightingRefusal } from "../boards/capabilities.ts";
import { keyPlace } from "../boards/key-names.ts";
import type { BoardDefinition } from "../boards/schema.ts";
import { deepEqual } from "../layout/equal.ts";
import { keptDefinitions } from "../layout/kept-behaviours.ts";
import type { Slot } from "../layout/change.ts";
import { isKeyCode, keyCodeInfo } from "../layout/keycodes.ts";
import type { Binding, Combo, LayerRef, Layout, Mod } from "../layout/schema.ts";
import type { ChangeOp } from "../layout/change.ts";
import { admittedLayerRefs, readNative } from "../layout/native-read.ts";
import { kanataWrittenByKeyloom } from "../layout/kanata/natives.ts";
import type { Step } from "../layout/native-meaning.ts";
import type { Issue } from "./result.ts";
import { conditionalLayerRules } from "./conditional-layer-rules.ts";
import { holdTapOptions } from "./hold-tap-rules.ts";
import { kanataProfileOptions, kanataSupport, remapperLockout } from "./kanata-rules.ts";
import { tapDanceRules } from "./tap-dance-rules.ts";
import { functionHomes, lostFunctions, reachableLayers, trappedLayers } from "./reachability.ts";

import { keyIn, keyOn, layerName } from "./words.ts";

/** `plain` is the sentence for people; `message` is the precise text the CLI and logs keep. */
const issue = (code: string, message: string, plain: string, slots?: Slot[]): Issue => (slots?.length ? { code, message, plain, slots } : { code, message, plain });

/** Every binding in the document with where it lives; combo outputs have no slot. */
function* bindingsOf(doc: Layout): Generator<{ binding: Binding; slot?: Slot; where: string }> {
  for (const layer of doc.layers) {
    for (const [position, binding] of layer.bindings.entries()) {
      yield { binding, slot: { layerId: layer.id, position }, where: `layer "${layer.id}", position ${position}` };
    }
  }
  for (const combo of doc.combos) yield { binding: combo.output, where: `output of combo "${combo.id}"` };
}

const slotOf = (s?: Slot): Slot[] | undefined => (s ? [s] : undefined);

/** `schema`: ids are how everything refers to layers, macros, combos and profiles, so they must be unique. */
export function duplicateIds(doc: Layout): Issue[] {
  const out: Issue[] = [];
  const check = (what: string, ids: string[]) => {
    for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) {
      out.push(issue("schema", `${what} id "${id}" is used more than once`, `Two ${what}s share an internal name, so keyloom can't tell them apart.`));
    }
  };
  check("layer", doc.layers.map((l) => l.id));
  check("macro", doc.macros.map((m) => m.id));
  check("tap dance", doc.tapDances.map((t) => t.id));
  check("combo", doc.combos.map((c) => c.id));
  check("conditional layer", doc.conditionalLayers.map((c) => c.id));
  check("hold-tap profile", doc.holdTapProfiles.map((p) => p.id));
  check("firmware setting", doc.settings.map((s) => `${s.firmware}:${s.key}`));
  return out;
}

/** `binding_count`: generated firmware would not compile with a short or long layer. */
export function bindingCount(board: BoardDefinition, doc: Layout): Issue[] {
  return doc.layers
    .filter((l) => l.bindings.length !== board.keyCount)
    .map((l) => issue("binding_count", `layer "${l.id}" has ${l.bindings.length} bindings, ${board.id} has ${board.keyCount} keys`,
      `${layerName(doc, l.id)} has ${l.bindings.length} keys, but this keyboard has ${board.keyCount}.`));
}

/** `unknown_ref`: layers, macros, profiles and combo positions must exist. */
export function unknownRefs(board: BoardDefinition, doc: Layout): Issue[] {
  const layers = new Set(doc.layers.map((l) => l.id));
  const macros = new Set(doc.macros.map((m) => m.id));
  const profiles = new Set(doc.holdTapProfiles.map((p) => p.id));
  const out: Issue[] = [];
  for (const { binding: b, slot, where } of bindingsOf(doc)) {
    const missing: { noun: string; text: string }[] = [];
    if (b.kind === "layer" && !layers.has(b.layerId)) missing.push({ noun: "layer", text: `layer "${b.layerId}"` });
    if (b.kind === "macro" && !macros.has(b.macroId)) missing.push({ noun: "macro", text: `macro "${b.macroId}"` });
    if (b.kind === "holdTap") {
      if ("layerId" in b.hold && !layers.has(b.hold.layerId)) missing.push({ noun: "layer", text: `layer "${b.hold.layerId}"` });
      if (!profiles.has(b.profileId)) missing.push({ noun: "hold-tap timing profile", text: `hold-tap profile "${b.profileId}"` });
      if (b.tap.macroId && !macros.has(b.tap.macroId)) missing.push({ noun: "macro", text: `macro "${b.tap.macroId}"` });
    }
    for (const m of missing) {
      const who = slot ? keyOn(doc, slot) : "A combo";
      out.push(issue("unknown_ref", `${where} refers to ${m.text}, which does not exist`, `${who} points at a ${m.noun} that isn't in this layout.`, slotOf(slot)));
    }
  }
  for (const combo of doc.combos) {
    for (const p of combo.positions.filter((p) => p >= board.keyCount)) {
      out.push(issue("unknown_ref", `combo "${combo.id}" uses position ${p}, but ${board.id} has ${board.keyCount} keys`,
        `A combo uses key ${p + 1}, but this keyboard only has ${board.keyCount} keys.`));
    }
    if (combo.layerIds !== "all") {
      for (const id of combo.layerIds.filter((id) => !layers.has(id))) out.push(issue("unknown_ref", `combo "${combo.id}" is on layer "${id}", which does not exist`, "A combo is set up on a layer that isn't in this layout."));
    }
  }
  return out;
}

/**
 * `combo_conflict`: two combos can't both fire when their layers overlap and they use the same set of
 * positions, because the firmware sees one chord of keys and runs one combo. Order doesn't matter
 * (`[0, 1]` is `[1, 0]`), and `"all"` overlaps every layer. One error per pair, naming both combos. A combo
 * has no slot of its own to report, so `slots` is left out and the message says as much.
 */
export function comboConflict(doc: Layout): Issue[] {
  const idsOf = (c: Combo): readonly string[] => (c.layerIds === "all" ? [] : c.layerIds);
  const out: Issue[] = [];
  for (const [i, a] of doc.combos.entries()) {
    for (const b of doc.combos.slice(i + 1)) {
      const positions = [...new Set(a.positions)].sort((x, y) => x - y);
      if (positions.join(",") !== [...new Set(b.positions)].sort((x, y) => x - y).join(",")) continue;
      // "all" overlaps whatever the other names; two "all"s overlap everywhere.
      const shared = a.layerIds === "all" && b.layerIds === "all" ? "every"
        : a.layerIds === "all" ? idsOf(b)
        : b.layerIds === "all" ? idsOf(a)
        : idsOf(a).filter((id) => idsOf(b).includes(id));
      if (shared !== "every" && shared.length === 0) continue;
      const on = shared === "every" ? "on every layer" : `on layers ${[...new Set(shared)].map((id) => `"${id}"`).join(", ")}`;
      out.push(issue("combo_conflict",
        `combos "${a.id}" and "${b.id}" use the same positions (${positions.join(", ")}) and both fire ${on}, so only one of them could fire; a combo has no slot to name`,
        `The combos "${a.name}" and "${b.name}" would use the same keys on the same layers, so only one of them could ever fire. Give one of them different keys, or a layer the other isn't on.`));
    }
  }
  return out;
}

/**
 * `firmware_unsupported`: every key must exist in the generated table (D-044), and nothing may
 * belong to the other firmware. The table holds only names both firmwares send, so presence in it
 * is what "exists in this layout's firmware" means.
 */
export function firmwareSupport(board: BoardDefinition, doc: Layout): Issue[] {
  const out: Issue[] = [];
  if (doc.firmware !== board.firmware) out.push(issue("firmware_unsupported", `the layout is ${doc.firmware} but ${board.id} runs ${board.firmware}`, "This layout is written for a different kind of firmware than this keyboard runs."));
  const unknownKey = (code: string, where: string, slot?: Slot) => {
    if (!isKeyCode(code)) {
      out.push(issue("firmware_unsupported", `${where}: "${code}" is not a keycode keyloom knows`,
        `${slot ? keyOn(doc, slot) : "A macro"} uses a key keyloom doesn't know how to send.`, slotOf(slot)));
    }
  };
  for (const { binding: b, slot, where } of bindingsOf(doc)) {
    if (b.kind === "key") unknownKey(b.code, where, slot);
    if (b.kind === "holdTap" && !b.tap.macroId) unknownKey(b.tap.code, where, slot);
    if (b.kind === "native" && b.firmware !== doc.firmware) {
      out.push(issue("firmware_unsupported", `${where} is a ${b.firmware} native binding in a ${doc.firmware} layout`,
        `${slot ? keyOn(doc, slot) : "A key"} has custom behaviour written for a different kind of firmware, so this keyboard can't run it.`, slotOf(slot)));
    }
  }
  for (const macro of doc.macros) {
    for (const step of macro.steps) if ("code" in step && step.code !== undefined) unknownKey(step.code, `macro "${macro.id}"`);
  }
  for (const p of doc.holdTapProfiles.filter((p) => p.firmware !== doc.firmware)) {
    out.push(issue("firmware_unsupported", `hold-tap profile "${p.id}" is for ${p.firmware}, not ${doc.firmware}`, "A hold-tap timing profile is for a different kind of firmware than this layout uses."));
  }
  for (const s of doc.settings.filter((s) => s.firmware !== doc.firmware)) {
    out.push(issue("firmware_unsupported", `setting ${s.key} is for ${s.firmware}, not ${doc.firmware}`, "A firmware setting is for a different kind of firmware than this layout uses."));
  }
  return out;
}

const LEFT_MODS: readonly Mod[] = ["LCTL", "LSFT", "LALT", "LGUI"];

/**
 * QMK `MT()` and `LT()` take a basic keycode with no modifiers on the tap side, and one right-hand
 * modifier makes the whole mod-tap right-handed (qmk/qmk_firmware 7a1bbf3 docs/mod_tap.md:65).
 * Both rules run on every hold-tap in a QMK layout, whatever its hold side, except mixed hands,
 * which only a modifier hold can have.
 */
export function qmkHoldTap(doc: Layout): Issue[] {
  if (doc.firmware !== "qmk") return [];
  const out: Issue[] = [];
  for (const { binding: b, slot, where } of bindingsOf(doc)) {
    if (b.kind !== "holdTap") continue;
    if (b.tap.macroId) {
      out.push(issue("qmk_modtap_basic", `${where}: QMK hold-taps can't tap a macro (${b.tap.macroId})`,
        `${slot ? keyOn(doc, slot) : "A combo"}: this firmware can't tap a macro from a hold-tap. Use a tap dance instead.`, slotOf(slot)));
      continue;
    }
    if (b.tap.mods?.length) out.push(issue("qmk_modtap_basic", `${where}: QMK hold-taps can't tap a modified key (${b.tap.code} with ${b.tap.mods.join("+")})`,
      `${slot ? keyOn(doc, slot) : "A combo"}: this firmware can't tap a modified key like Shift+A from a hold-tap. Tap a plain key instead.`, slotOf(slot)));
    // An unknown code is firmware_unsupported already; saying it isn't basic as well would repeat it.
    else if (isKeyCode(b.tap.code) && !keyCodeInfo(b.tap.code).qmkBasic) {
      out.push(issue("qmk_modtap_basic", `${where}: ${b.tap.code} is not a QMK basic keycode, so it can't be the tap of a hold-tap`,
        `${slot ? keyOn(doc, slot) : "A combo"}: this firmware can only tap a plain key (a letter, number or similar) from a hold-tap.`, slotOf(slot)));
    }
    if ("mods" in b.hold) {
      const left = b.hold.mods.filter((m) => LEFT_MODS.includes(m)).length;
      if (left > 0 && left < b.hold.mods.length) {
        out.push(issue("qmk_modtap_mixed_hands", `${where}: a QMK mod-tap can't mix left and right modifiers (${b.hold.mods.join("+")}); one right-hand modifier makes all of them right-handed`,
          `${slot ? keyOn(doc, slot) : "A combo"}: this firmware can't hold left-hand and right-hand modifiers together on one key. Use modifiers from one side.`, slotOf(slot)));
      }
    }
  }
  return out;
}

const QMK_LAYER_LIMIT = 32; // Oryx's documented limit (05), not QMK's own
const QMK_8BIT_LIMIT = 8;

const isOn = (v: string | number | boolean) => v !== false && v !== 0 && v !== "0" && v !== "";

/** `layer_limit`: 32 layers on QMK, 8 when `LAYER_STATE_8BIT` is set (S3: the importer stores `#define LAYER_STATE_8BIT` as true). */
export function layerLimit(doc: Layout): Issue[] {
  if (doc.firmware !== "qmk") return [];
  const eightBit = doc.settings.some((s) => s.firmware === "qmk" && s.key === "LAYER_STATE_8BIT" && isOn(s.value));
  const limit = eightBit ? QMK_8BIT_LIMIT : QMK_LAYER_LIMIT;
  if (doc.layers.length <= limit) return [];
  return [issue("layer_limit", `${doc.layers.length} layers, but the limit is ${limit}${eightBit ? " because LAYER_STATE_8BIT is set" : ""}`,
    `This layout has ${doc.layers.length} layers, and this firmware allows ${limit}.`)];
}

/** `layer_unreachable`: a layer nobody can get to is every function on it lost. */
export function layerUnreachable(doc: Layout): Issue[] {
  const base = doc.layers[0]?.id;
  const reachable = reachableLayers(doc);
  return doc.layers
    .filter((l) => !reachable.has(l.id))
    .map((l) => ({ ...issue("layer_unreachable", `layer "${l.id}" can't be reached from the base layer "${base}": nothing switches to it`, `${l.name} can't be reached: no key switches to it from ${doc.layers[0]?.name ?? "the base layer"}.`), layerId: l.id }));
}

/** `layer_trap`: see `trappedLayers` for the reading of "leads back". */
export function layerTrap(doc: Layout): Issue[] {
  return trappedLayers(doc).map(({ layerId, entered }) => ({
    // The layer rides along so the board review can mark its tab, as it does for layer_unreachable.
    layerId, ...issue("layer_trap", `layer "${layerId}" is entered with toggle or to but has no key that leads back to the base layer`,
      `${layerName(doc, layerId)} has no key that gets back to ${doc.layers[0]?.name ?? "the base layer"}, so you could get stuck on it.`,
      entered.flatMap((e) => (e.slot ? [e.slot] : []))) }));
}

/**
 * `lighting_unsupported`: colours on a board with no per-key RGB, on a firmware keyloom doesn't write them for, or past the last key
 * would be dropped by the generator, so they are refused instead of silently not shown (D-190).
 */
export function lightingSupport(board: BoardDefinition, doc: Layout): Issue[] {
  const out: Issue[] = [];
  for (const layer of doc.layers) {
    if (layer.lighting === undefined) continue;
    if (board.lighting === undefined) {
      out.push(issue("lighting_unsupported", `layer "${layer.id}" has lighting, but ${board.id} has no per-key RGB keyloom writes`,
        `${layer.name} has LED colours. ${lightingRefusal(board)}`));
      continue;
    }
    const pastTheEnd = Object.keys(layer.lighting.keys ?? {}).filter((p) => Number(p) >= board.keyCount);
    if (pastTheEnd.length > 0) {
      out.push(issue("lighting_unsupported", `layer "${layer.id}" colours positions ${pastTheEnd.join(", ")}, past the board's ${board.keyCount} keys`,
        `${layer.name} colours a key ${board.name} doesn't have.`));
    }
  }
  return out;
}

/** The rules that look at one document; the relational ones below also need the document before. */
export const documentRules = (board: BoardDefinition, doc: Layout): Issue[] => [
  ...duplicateIds(doc),
  ...bindingCount(board, doc),
  ...unknownRefs(board, doc),
  ...comboConflict(doc),
  ...firmwareSupport(board, doc),
  ...qmkHoldTap(doc),
  ...tapDanceRules(doc),
  ...conditionalLayerRules(doc),
  ...holdTapOptions(board, doc),
  ...lightingSupport(board, doc),
  ...layerLimit(doc),
  ...layerUnreachable(doc),
  ...layerTrap(doc),
  ...kanataSupport(doc),
  ...kanataProfileOptions(doc),
  ...remapperLockout(board, doc),
];

// The layer numbers are part of what a kept key is: one written without them would not follow its layers.
const nativeKey = (b: Extract<Binding, { kind: "native" }>) => JSON.stringify([b.firmware, b.source, b.label, b.layerRefs ?? null]);

/**
 * `native_edit`: keyloom can't reason about source it doesn't model (D-024), so a native binding
 * may be moved, swapped, copied or replaced whole by a modelled binding, but the document may
 * never gain a native binding it did not already have. That also covers "edit the C in a native
 * key", which is a replacement by a different native binding. No op edits `passthrough`, so a
 * difference there can only be a bug; it is checked anyway because the cost of missing it is a
 * keymap that silently stops matching its custom C.
 *
 * A new native is allowed when it is the layout's own firmware and keyloom reads its meaning (native-read.ts): a shift, a
 * caps word or a lighting key that a copy translated (D-451), or one an agent asks for. Source keyloom can't read stays refused.
 */
export function nativeEdit(before: Layout, after: Layout): Issue[] {
  const known = knownNatives(before);
  const kept = keptDefinitions(after.passthrough);
  // A kanata native is its own source, admitted only in the forms keyloom writes and with no layer refs to rewrite. A QMK or ZMK one is
  // admitted when keyloom reads it and its layer refs are the ones its reading needs (admittedLayerRefs).
  const understood = (b: Extract<Binding, { kind: "native" }>) =>
    b.firmware === after.firmware && (b.firmware === "kanata" ? kanataWrittenByKeyloom(b.source) && (b.layerRefs ?? []).length === 0 : admittedLayerRefs(b, kept));
  const out: Issue[] = [];
  for (const { binding: b, slot, where } of bindingsOf(after)) {
    if (b.kind === "native" && !known.has(nativeKey(b)) && !understood(b)) {
      out.push(issue("native_edit", `${where}: ${b.source} is firmware source keyloom did not import; replace the key with a modelled binding instead`,
        `${slot ? keyOn(after, slot) : "A key"} would get custom behaviour keyloom didn't import and can't write. Use a regular key instead.`, slotOf(slot)));
    }
  }
  if (!deepEqual(before.passthrough, after.passthrough)) out.push(issue("native_edit", "a change touched a passthrough block; keyloom keeps those verbatim", "This change touches custom code that keyloom keeps exactly as it is."));
  return out;
}

/** The native bindings a layout already has, by key, so a change that keeps one is not a new native. */
const knownNatives = (before: Layout): Set<string> => new Set([...bindingsOf(before)].flatMap(({ binding: b }) => (b.kind === "native" ? [nativeKey(b)] : [])));

/** A combo as a risky native sees it: its output, its trigger keys and the layers it works on. Moving any of them makes it new. */
const comboSignature = (combo: Combo, output: Extract<Binding, { kind: "native" }>): string => JSON.stringify([nativeKey(output), [...combo.positions].sort((a, b) => a - b), combo.layerIds]);

/**
 * The natives a layout holds, by where they are: a key by its layer and position, a combo by its id. A native that moves to a slot that
 * didn't hold it is new there, so it is checked again at the new place.
 */
function heldNatives(doc: Layout): Map<string, string> {
  const held = new Map<string, string>();
  for (const { binding, slot } of bindingsOf(doc)) if (binding.kind === "native" && slot !== undefined) held.set(`layer:${slot.layerId}:${slot.position}`, nativeKey(binding));
  for (const combo of doc.combos) if (combo.output.kind === "native") held.set(`combo:${combo.id}`, comboSignature(combo, combo.output));
  return held;
}

/** A native that is new at its place: the native, the key it is on (absent for a combo output), and where it is for the message. */
type NewNative = { native: Extract<Binding, { kind: "native" }>; slot?: Slot; where: string };

/** The natives in `after` that aren't in the same slot of `before`. */
function newNatives(before: Layout, after: Layout): NewNative[] {
  const held = heldNatives(before);
  const out: NewNative[] = [];
  for (const { binding, slot, where } of bindingsOf(after)) {
    if (binding.kind !== "native" || slot === undefined) continue;
    if (held.get(`layer:${slot.layerId}:${slot.position}`) !== nativeKey(binding)) out.push({ native: binding, slot, where });
  }
  for (const combo of after.combos) {
    if (combo.output.kind !== "native") continue;
    if (held.get(`combo:${combo.id}`) !== comboSignature(combo, combo.output)) out.push({ native: combo.output, where: `combo "${combo.id}"` });
  }
  return out;
}

const capitalised = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * `risky_native` (warning, D-451): a new native that resets the keyboard or forgets Bluetooth pairings. BK's decision: "allow understood
 * raw codes, warn on risky ones". A warning never blocks a change or a put. A key warns unless its own slot held the same native in
 * `before`, so an existing Boot key copied to a second position warns once, for the new position. A macro that does several risky
 * things names each distinct effect. One-shots, caps word, lighting and a Bluetooth select never warn.
 */
export function riskyNatives(board: BoardDefinition, before: Layout, after: Layout): Issue[] {
  const kept = keptDefinitions(after.passthrough);
  const out: Issue[] = [];
  for (const { native, slot, where } of newNatives(before, after)) {
    // The warning reads through every macro control: a release-only bootloader still warns, though a copy does not translate it.
    const reading = readNative(native, kept, true);
    // A layer hold is risky through its tap: `&magic 1 0` with a bootloader tap enters the bootloader when that tap is pressed.
    if (reading.kind === "unknown") continue;
    const steps = reading.kind === "steps" ? reading.steps : reading.tapSteps;
    const effects = [...new Set(steps.flatMap((step) => riskEffect(step) ?? []))];
    if (effects.length === 0) continue;
    const verb = `would ${effects.join(" and ")}`;
    const place = slot ? keyPlace(board, slot.position) : "a combo";
    out.push(issue("risky_native", `${where}: ${native.source} ${verb}`, `${capitalised(place)} ${verb}`, slot ? [slot] : undefined));
  }
  return out;
}

/** What a risky step does, as the verb phrase after "would"; undefined for a step that is not risky. */
function riskEffect(step: Step): string | undefined {
  switch (step.kind) {
    case "bootloader": return "put the keyboard into its bootloader when pressed";
    case "reset": return "restart the keyboard when pressed";
    case "bluetooth":
      if (step.op === "clearAll") return "forget every paired Bluetooth device";
      if (step.op === "clear") return "forget the Bluetooth device paired on the current profile";
      return undefined;
    default: return undefined;
  }
}

/**
 * A new native that drives the lights, on a board with no per-key lighting keyloom writes, is an error in the same words a colour edit
 * gets (`lightingRefusal`). copy-plan refuses these natives for the same reason, so a copy and an agent edit agree.
 */
export function nativeLighting(board: BoardDefinition, before: Layout, after: Layout): Issue[] {
  // Per-key LEDs, the board's own record, or a lighting control already in `before` (proof the firmware has them), admit any lighting key.
  if (hasLightingControls(board, before)) return [];
  const kept = keptDefinitions(after.passthrough);
  const out: Issue[] = [];
  for (const { native, slot, where } of newNatives(before, after)) {
    // A layer hold lights through its tap, so the tap's steps count as much as a key's own.
    const reading = readNative(native, kept);
    if (reading.kind === "unknown") continue;
    const steps = reading.kind === "steps" ? reading.steps : reading.tapSteps;
    if (!steps.some((step) => step.kind === "lighting")) continue;
    const place = slot ? keyPlace(board, slot.position) : "a combo";
    out.push(issue("lighting_unsupported", `${where}: ${native.source} needs lighting controls, and nothing in this config shows that ${board.id}'s firmware has them`,
      `${capitalised(place)} is a light key. ${lightingControlsRefusal(board)}`, slot ? [slot] : undefined));
  }
  return out;
}

/**
 * `passthrough_layer_index`: kept firmware source and kept keys name layers by number. Where the importer proved which
 * numbers are layer numbers (`layerRefs`, D-360), they follow their layers and a reorder passes. A change is refused when it
 * removes a layer that kept source or a kept key names, or renumbers layers while some line names a layer in a way that
 * can't be rewritten. A layout stored before the importer read them (no `layerRefs`) keeps the old rule: adding at the end
 * passes, removing the last layers passes unless a pinned block names a removed layer's number, and anything else is refused.
 */
export function passthroughLayerIndex(before: Layout, after: Layout): Issue[] {
  return [...legacyLayerIndex(before, after), ...keptLayerNumbers(before, after)];
}

type KeptSite = { label: string; refs: LayerRef[]; unprovable: { line: number; text: string }[]; slot?: Slot; source: string };

/** The kept source and kept keys of a document that carry the importer's reading of their layer numbers. */
function keptSites(doc: Layout): KeptSite[] {
  const sites: KeptSite[] = doc.passthrough.flatMap((p) => (p.layerRefs === undefined ? [] : [{ label: `${p.file} ${p.anchor}`, refs: p.layerRefs, unprovable: p.unprovable ?? [], source: p.source }]));
  for (const { binding: b, slot, where } of bindingsOf(doc)) {
    if (b.kind === "native" && (b.layerRefs !== undefined || b.unprovable !== undefined)) {
      sites.push({ label: where, refs: b.layerRefs ?? [], unprovable: b.unprovable ?? [], source: b.source, ...(slot ? { slot } : {}) });
    }
  }
  return sites;
}

const lineOf = (source: string, at: number): { line: number; text: string } => {
  const before = source.slice(0, at).split("\n");
  return { line: before.length, text: (source.split("\n")[before.length - 1] ?? "").trim() };
};
const quoted = (s: { line: number; text: string }) => `line ${s.line}${s.text === "" ? "" : ` (${s.text})`}`;

function keptLayerNumbers(before: Layout, after: Layout): Issue[] {
  const sites = keptSites(after);
  if (sites.length === 0) return [];
  const afterIndex = new Map(after.layers.map((l, i) => [l.id, i]));
  const removed = before.layers.filter((l) => !afterIndex.has(l.id));
  const shifted = before.layers.some((l, i) => afterIndex.has(l.id) && afterIndex.get(l.id) !== i);
  const out: Issue[] = [];
  for (const layer of removed) {
    const named = sites.flatMap((site) => {
      const hit = site.refs.find((r) => r.layerId === layer.id);
      if (hit === undefined) return [];
      const at = quoted(lineOf(site.source, hit.start));
      return [{ site, message: site.slot ? site.label : `${site.label} ${at}`, plain: site.slot ? keyIn(before, site.slot) : `${site.label}, ${at}` }];
    });
    if (named.length === 0) continue;
    out.push(issue("passthrough_layer_index",
      `this change removes layer "${layer.id}", but ${named.map((n) => n.message).join("; ")} refers to it by number and would point at the wrong layer or none`,
      `${layerName(before, layer.id)} can't be removed: your custom code refers to it by number (${named.map((n) => n.plain).join("; ")}).`,
      named.flatMap((n) => (n.site.slot ? [n.site.slot] : []))));
  }
  const stuck = sites.flatMap((s) => s.unprovable.map((u) => ({ site: s, u })));
  if ((shifted || removed.length > 0) && stuck.length > 0) {
    out.push(issue("passthrough_layer_index",
      `this change renumbers layers, but ${stuck.map(({ site, u }) => `${site.label} ${quoted(u)}`).join("; ")} uses a layer number that keyloom can't rewrite safely`,
      `Your custom code uses layer numbers in a way keyloom can't follow when layers move: ${stuck.map(({ site, u }) => `${site.slot ? keyIn(after, site.slot) : site.label}, ${quoted(u)}`).join("; ")}.`,
      stuck.flatMap(({ site }) => (site.slot ? [site.slot] : []))));
  }
  return out;
}

function legacyLayerIndex(before: Layout, after: Layout): Issue[] {
  const pinned = before.passthrough.filter((p) => p.refersToLayerIndices && p.layerRefs === undefined);
  if (pinned.length === 0) return [];
  let kept = 0;
  while (kept < before.layers.length && before.layers[kept]?.id === after.layers[kept]?.id) kept++;
  const removed = before.layers.length - kept;
  const added = after.layers.length - kept;
  if (removed === 0) return [];
  if (added === 0) {
    // Only the tail went, so every surviving layer keeps its index; what is left to break is code that names a removed one.
    const naming = pinned.filter((p) => before.layers.slice(kept).some((_, i) => namesLayerNumber(p.source, kept + i)));
    if (naming.length === 0) return [];
    const where = naming.map((p) => `${p.file} ${p.anchor}`).join(", ");
    return [issue("passthrough_layer_index", `this change removes a layer, but ${where} refers to it by number and would point at the wrong layer or none`,
      "Your custom code refers to this layer by number, so it can't be removed. Importing the firmware again lets keyloom renumber it.")];
  }
  const where = pinned.map((p) => `${p.file} ${p.anchor}`).join(", ");
  return [issue("passthrough_layer_index", `this change removes or reorders layers, but ${where} refers to layers by number and would point at the wrong ones`,
    "Your custom code refers to layers by number, and this change would move layers so it points at the wrong ones. Importing the firmware again lets keyloom renumber it.")];
}

/**
 * Whether firmware source names layer `n` by number in the forms the importer pins on (S3, D-024):
 * QMK layer keys and functions, `case n:`, a `[n]` table row, and ZMK `&mo n` style bindings or a `#define NAME n`.
 * Matches may be too eager (a refusal the person can't clear), never too shy.
 */
export function namesLayerNumber(source: string, n: number): boolean {
  const num = `\\b${n}\\b`;
  const forms = [
    `\\[\\s*${n}\\s*\\]`,
    `\\bcase\\s+${n}\\s*:`,
    `(?:==|!=)\\s*${n}\\b`,
    `\\b(?:LT|MO|TG|TO|OSL|TT|DF|LM)\\s*\\(\\s*${n}\\b`,
    `\\b(?:layer_\\w+|default_layer_set|set_single_persistent_default_layer|IS_LAYER_\\w+|get_highest_layer)\\s*\\([^)]*${num}`,
    `&(?:mo|lt|tog|to|sl|sk)\\s+${n}\\b`,
    `#define\\s+\\w+\\s+${n}\\b`,
  ];
  return forms.some((f) => new RegExp(f).test(source));
}

const slotText = (s: Slot) => `layer "${s.layerId}", position ${s.position}`;

/**
 * `function_lost`: every function reachable before must be reachable after, unless a `dropFunction`
 * op names it (D-020). `dropped` is the licensed losses with the op's reason, for the diff.
 */
export function functionLost(before: Layout, after: Layout, ops: readonly ChangeOp[]): { errors: Issue[]; dropped: { function: string; reason: string }[] } {
  const reasons = new Map<string, string>();
  for (const op of ops) if (op.op === "dropFunction") reasons.set(op.function, op.reason);
  const errors: Issue[] = [];
  const dropped: { function: string; reason: string }[] = [];
  for (const lost of lostFunctions(functionHomes(before), functionHomes(after))) {
    const reason = reasons.get(lost.function);
    if (reason !== undefined) dropped.push({ function: lost.function, reason });
    else {
      const where = lost.was.length ? ` (was at ${lost.was.map(slotText).join("; ")})` : "";
      errors.push({ ...issue("function_lost", `${lost.function} is reachable before this change and not after${where}; keep it somewhere or add a dropFunction op`,
        "Something on your keyboard won't be there any more. Put it on another key first, or choose to drop it.", lost.was), function: lost.function });
    }
  }
  return { errors, dropped };
}

/** Letters that double in common English words (07), so a delay or second meaning on them breaks "class". */
const DOUBLING_LETTERS = new Set("lseotfprmcndgbz".toUpperCase());

/**
 * `doubled_letter_tapdance`. Tap dance isn't in the IR (D-019, 05): a `TD(DANCE_n)` key is native and
 * its behaviour lives in a passthrough block. So this reads the dance's single-tap case out of that
 * block; a dance whose single tap types a doubling letter gets a second meaning on a double tap, which
 * is what delays and breaks "class". Reported only when the key's slot is new in the warning set, so
 * an imported dance doesn't nag on every edit.
 */
export function doubledLetterTapdance(doc: Layout): Issue[] {
  const out: Issue[] = [];
  for (const { binding: b, slot, where } of bindingsOf(doc)) {
    const modelled = b.kind === "tapDance" ? doc.tapDances.find((t) => t.id === b.tapDanceId) : undefined;
    const tapped = modelled?.tap.kind === "key" && !modelled.tap.mods?.length ? modelled.tap.code : undefined;
    if (tapped !== undefined && tapped.length === 1 && DOUBLING_LETTERS.has(tapped)) {
      out.push(issue("doubled_letter_tapdance", `${where}: a tap dance on ${tapped}, which doubles in common words ("class"); a second tap meaning something else makes typing it twice unreliable`,
        `${slot ? keyOn(doc, slot) : "A key"} is a tap dance on ${tapped}, which doubles in words like "class". A second meaning on a double tap makes typing it twice unreliable.`, slotOf(slot)));
      continue;
    }
    const n = b.kind === "native" ? /^TD\(DANCE_(\d+)\)$/.exec(b.source)?.[1] : undefined;
    if (n === undefined) continue;
    const source = doc.passthrough.map((p) => p.source).join("\n");
    const start = new RegExp(`void dance_${n}_finished\\([^)]*\\)\\s*\\{`).exec(source);
    const body = start ? (source.slice(start.index + start[0].length).split(/\nvoid\b/)[0] ?? "") : "";
    const letter = /case\s+SINGLE_TAP:\s*(?:register|tap)_code(?:16)?\(\s*KC_([A-Z])\s*\)/.exec(body)?.[1];
    if (letter && DOUBLING_LETTERS.has(letter)) {
      out.push(issue("doubled_letter_tapdance", `${where}: a tap dance on ${letter}, which doubles in common words ("class"); a second tap meaning something else makes typing it twice unreliable`,
        `${slot ? keyOn(doc, slot) : "A key"} is a tap dance on ${letter}, which doubles in words like "class". A second meaning on a double tap makes typing it twice unreliable.`, slotOf(slot)));
    }
  }
  return out;
}
