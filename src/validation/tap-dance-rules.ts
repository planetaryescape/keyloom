// Tap dance and macro-text rules (16#tap-dance-is-a-key-with-a-double-tap-slot). A tap dance is a
// key with several slots, and each slot is a function (02), so reachability already counts them; these
// rules cover what only a tap dance can get wrong.
import { slotFunction, tapDanceSlots } from "../layout/functions.ts";
import type { Slot } from "../layout/change.ts";
import { isKeyCode } from "../layout/keycodes.ts";
import { looksLikeSecret } from "../layout/secret.ts";
import { textKeys } from "../layout/text-keys.ts";
import type { Layout, Mod, SlotAction, TapDance } from "../layout/schema.ts";
import type { Issue } from "./result.ts";
import { keyOn, layerName } from "./words.ts";

const SLOT_WORDS = { tap: "tapping", hold: "holding", doubleTap: "double-tapping", tapThenHold: "tapping, then holding" } as const;
const LEFT: readonly Mod[] = ["LCTL", "LSFT", "LALT", "LGUI"];

const issue = (code: string, message: string, plain: string, slots?: Slot[]): Issue => (slots?.length ? { code, message, plain, slots } : { code, message, plain });

/** Where each tap dance is used on a layer, so a finding about the entry can name the keys it affects. */
function usesOf(doc: Layout): Map<string, Slot[]> {
  const uses = new Map<string, Slot[]>();
  for (const layer of doc.layers) {
    for (const [position, b] of layer.bindings.entries()) {
      if (b.kind === "tapDance") uses.set(b.tapDanceId, [...(uses.get(b.tapDanceId) ?? []), { layerId: layer.id, position }]);
    }
  }
  return uses;
}

/** "The tap dance Esc, Caps Lock on double-tap", or the first key that uses it. */
const subject = (doc: Layout, td: TapDance, uses: Slot[]): string => (uses[0] ? keyOn(doc, uses[0]) : `The tap dance "${td.name}"`);

function mixesHands(mods: readonly Mod[]): boolean {
  const left = mods.filter((m) => LEFT.includes(m)).length;
  return left > 0 && left < mods.length;
}

/** The errors only a tap dance, or a macro's text, can cause. `firmware` rules are the ones the generators would throw on. */
export function tapDanceRules(doc: Layout): Issue[] {
  const out: Issue[] = [];
  const layers = new Set(doc.layers.map((l) => l.id));
  const macros = new Set(doc.macros.map((m) => m.id));
  const dances = new Set(doc.tapDances.map((t) => t.id));
  const uses = usesOf(doc);

  for (const layer of doc.layers) {
    for (const [position, b] of layer.bindings.entries()) {
      if (b.kind === "tapDance" && !dances.has(b.tapDanceId)) {
        out.push(issue("unknown_ref", `layer "${layer.id}", position ${position} refers to tap dance "${b.tapDanceId}", which does not exist`,
          `${keyOn(doc, { layerId: layer.id, position })} points at a tap dance that isn't in this layout.`, [{ layerId: layer.id, position }]));
      }
    }
  }
  for (const combo of doc.combos) {
    if (combo.output.kind === "tapDance" && !dances.has(combo.output.tapDanceId)) {
      out.push(issue("unknown_ref", `combo "${combo.id}" refers to tap dance "${combo.output.tapDanceId}", which does not exist`,
        `The combo "${combo.name}" points at a tap dance that isn't in this layout.`));
    }
    if (combo.output.kind === "tapDance" && doc.firmware === "qmk") {
      out.push(issue("qmk_combo_tapdance", `combo "${combo.id}" outputs a tap dance, which QMK's combos can't run`,
        "A combo can't set off a tap dance on this firmware. Tap dance keys can be part of a combo, but not its result."));
    }
  }

  for (const td of doc.tapDances) {
    const keys = uses.get(td.id) ?? [];
    const who = subject(doc, td, keys);
    for (const [name, a] of tapDanceSlots(td)) {
      const where = `tap dance "${td.id}", ${name}`;
      const problem = slotProblem(doc, a, layers, macros);
      if (problem) {
        out.push(issue(problem.code, `${where}: ${problem.message}`, `${who}: ${SLOT_WORDS[name]} ${problem.plain}`, keys));
      }
    }
    if (td.tap.kind === "layer" && td.tap.action === "momentary") {
      out.push(issue("tap_dance_slot", `tap dance "${td.id}": a momentary layer on the tap slot ends as soon as the dance does, so it never switches anything`,
        `${who}: tapping can't hold a layer on. Use a toggle, or put the layer on the hold slot.`, keys));
    }
  }

  for (const macro of doc.macros) {
    for (const step of macro.steps) {
      if (step.op !== "text") continue;
      const typed = textKeys(step.text);
      if (!typed.ok) {
        out.push(issue("macro_text_untypable", `macro "${macro.id}": "${typed.char}" can't be typed by a text step; keyloom types US-layout letters, digits and punctuation`,
          `The macro "${macro.name}" types "${typed.char}", which keyloom can't type. Use letters, digits and punctuation from a US keyboard.`));
      }
    }
  }

  // QMK keeps Oryx tap dance code it couldn't read, and that code owns DANCE_n and tap_dance_actions[].
  if (doc.firmware === "qmk" && doc.tapDances.length > 0 && doc.passthrough.some((p) => p.firmware === "qmk" && p.anchor.startsWith("tap-dance"))) {
    out.push(issue("tap_dance_native_conflict", "this layout keeps Oryx tap dance code as written (imported before keyloom read tap dances, or not in the shape keyloom writes), so keyloom can't add tap dances beside it; run `keyloom layout upgrade` (or Update layout in the app) to read them",
      "This layout keeps tap dance code from Oryx as it was, so keyloom can't add another tap dance next to it. Choose Update layout in the layout summary and keyloom will read its tap dances."));
  }
  return out;
}

function slotProblem(doc: Layout, a: SlotAction, layers: ReadonlySet<string>, macros: ReadonlySet<string>): { code: string; message: string; plain: string } | undefined {
  switch (a.kind) {
    case "key": {
      if (!isKeyCode(a.code)) return { code: "firmware_unsupported", message: `"${a.code}" is not a keycode keyloom knows`, plain: "a key keyloom doesn't know how to send." };
      if (doc.firmware === "qmk" && a.mods?.length) {
        if (mixesHands(a.mods)) return { code: "qmk_tapdance_mixed_hands", message: `${a.mods.join("+")} mixes left and right modifiers, which QMK can't send together from one key`, plain: "can't mix left-hand and right-hand modifiers on this firmware." };
      }
      return undefined;
    }
    case "modifier":
      return doc.firmware === "qmk" && mixesHands(a.mods)
        ? { code: "qmk_tapdance_mixed_hands", message: `${a.mods.join("+")} mixes left and right modifiers, which QMK can't send together from one key`, plain: "can't mix left-hand and right-hand modifiers on this firmware." }
        : undefined;
    case "layer":
      return layers.has(a.layerId) ? undefined : { code: "unknown_ref", message: `refers to layer "${a.layerId}", which does not exist`, plain: `goes to ${layerName(doc, a.layerId)}, which isn't in this layout.` };
    case "macro":
      return macros.has(a.macroId) ? undefined : { code: "unknown_ref", message: `refers to macro "${a.macroId}", which does not exist`, plain: "runs a macro that isn't in this layout." };
  }
}

/**
 * Warnings about a tap dance that does less than it looks like: two slots doing the same thing. Reported
 * per entry, naming the first key that uses it.
 */
export function tapDanceWarnings(doc: Layout): Issue[] {
  const out: Issue[] = [];
  const uses = usesOf(doc);
  for (const td of doc.tapDances) {
    const slots = tapDanceSlots(td);
    for (const [i, [nameA, a]] of slots.entries()) {
      for (const [nameB, b] of slots.slice(i + 1)) {
        if (slotFunction(a) !== slotFunction(b)) continue;
        const keys = uses.get(td.id) ?? [];
        out.push(issue("tap_dance_same_action", `tap dance "${td.id}": ${nameA} and ${nameB} do the same thing (${slotFunction(a)})`,
          `${subject(doc, td, keys)}: ${SLOT_WORDS[nameA]} and ${SLOT_WORDS[nameB]} do the same thing, so the extra slot adds nothing.`, keys));
      }
    }
  }
  return out;
}

/** `macro_looks_like_secret`: a text step that looks like a password (07#warnings). */
export function macroSecrets(doc: Layout): Issue[] {
  return doc.macros.flatMap((macro) =>
    macro.steps.some((step) => step.op === "text" && looksLikeSecret(step.text))
      ? [issue("macro_looks_like_secret", `macro "${macro.id}" types text that looks like a password; firmware isn't a safe place for a secret, since anyone with the keyboard can replay it`,
          `The macro "${macro.name}" types text that looks like a password. Anyone who has your keyboard could replay it.`)]
      : [],
  );
}
