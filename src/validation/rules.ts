// The rung 2 error rules (07#errors). Each takes a whole document so the same rule can run on
// the layout before and after a change; validate.ts reports only what the change made worse.
// Reachability (reachability.ts) supplies layer_unreachable and layer_trap here and function_lost below.
import type { BoardDefinition } from "../boards/schema.ts";
import { deepEqual } from "../layout/equal.ts";
import type { Slot } from "../layout/change.ts";
import { isKeyCode, keyCodeInfo } from "../layout/keycodes.ts";
import type { Binding, Layout, Mod } from "../layout/schema.ts";
import type { ChangeOp } from "../layout/change.ts";
import type { Issue } from "./result.ts";
import { holdTapOptions } from "./hold-tap-rules.ts";
import { tapDanceRules } from "./tap-dance-rules.ts";
import { functionHomes, lostFunctions, reachableLayers, trappedLayers } from "./reachability.ts";

import { keyOn, layerName } from "./words.ts";

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
    if (b.kind === "holdTap") unknownKey(b.tap.code, where, slot);
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
  return trappedLayers(doc).map(({ layerId, entered }) =>
    issue("layer_trap", `layer "${layerId}" is entered with toggle or to but has no key that leads back to the base layer`,
      `${layerName(doc, layerId)} has no key that gets back to ${doc.layers[0]?.name ?? "the base layer"}, so you could get stuck on it.`,
      entered.flatMap((e) => (e.slot ? [e.slot] : []))));
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
        `${layer.name} has LED colours, but ${board.name} has no per-key lighting keyloom can set.`));
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
  ...firmwareSupport(board, doc),
  ...qmkHoldTap(doc),
  ...tapDanceRules(doc),
  ...holdTapOptions(board, doc),
  ...lightingSupport(board, doc),
  ...layerLimit(doc),
  ...layerUnreachable(doc),
  ...layerTrap(doc),
];

const nativeKey = (b: Extract<Binding, { kind: "native" }>) => JSON.stringify([b.firmware, b.source, b.label]);

/**
 * `native_edit`: keyloom can't reason about source it doesn't model (D-024), so a native binding
 * may be moved, swapped, copied or replaced whole by a modelled binding, but the document may
 * never gain a native binding it did not already have. That also covers "edit the C in a native
 * key", which is a replacement by a different native binding. No op edits `passthrough`, so a
 * difference there can only be a bug; it is checked anyway because the cost of missing it is a
 * keymap that silently stops matching its custom C.
 */
export function nativeEdit(before: Layout, after: Layout): Issue[] {
  const known = new Set<string>();
  for (const { binding: b } of bindingsOf(before)) if (b.kind === "native") known.add(nativeKey(b));
  const out: Issue[] = [];
  for (const { binding: b, slot, where } of bindingsOf(after)) {
    if (b.kind === "native" && !known.has(nativeKey(b))) {
      out.push(issue("native_edit", `${where}: ${b.source} is firmware source keyloom did not import; replace the key with a modelled binding instead`,
        `${slot ? keyOn(after, slot) : "A key"} would get custom behaviour keyloom didn't import and can't write. Use a regular key instead.`, slotOf(slot)));
    }
  }
  if (!deepEqual(before.passthrough, after.passthrough)) out.push(issue("native_edit", "a change touched a passthrough block; keyloom keeps those verbatim", "This change touches custom code that keyloom keeps exactly as it is."));
  return out;
}

/**
 * `passthrough_layer_index`: custom code that names layers by number keeps working only while
 * every existing layer keeps its index. That holds exactly when the old layer order is a prefix of
 * the new one, so adding at the end passes and removing, inserting or reordering does not, however
 * the ops got there.
 */
export function passthroughLayerIndex(before: Layout, after: Layout): Issue[] {
  const pinned = before.passthrough.filter((p) => p.refersToLayerIndices);
  if (pinned.length === 0) return [];
  const moved = before.layers.some((l, i) => after.layers[i]?.id !== l.id);
  if (!moved) return [];
  const where = pinned.map((p) => `${p.file} ${p.anchor}`).join(", ");
  return [issue("passthrough_layer_index", `this change removes or reorders layers, but ${where} refers to layers by number and would point at the wrong ones`,
    "Your custom code refers to layers by number, and this change would move layers so it points at the wrong ones.")];
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
