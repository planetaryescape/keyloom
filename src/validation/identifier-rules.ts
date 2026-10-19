// `identifier_clash` (07#warnings). ZMK generation writes a devicetree label from a hold-tap profile's, a
// macro's and a tap dance's id (`labelOf`, src/firmware/zmk/emit-binding.ts), and a node name from a combo's
// display name (`comboNodeName`). A label that a behaviour ZMK defines already owns would shadow that
// behaviour for every binding, and two things written as one name would not compile; either way the build
// fails after the person has already been told the change was fine. So this warns first.
//
// Only ZMK has such a namespace. On QMK a macro is written as `ST_MACRO_n` and a tap dance as `DANCE_n`, both
// from counters that skip names already taken (firmware/qmk/emit-macros.ts, emit-tap-dance.ts), and a layer
// appears only in a comment (emit-keymap.ts), so no id can produce a name a QMK keycode owns.
//
// Layers and combos are devicetree node names, not labels: they live in their own containers, so neither can
// shadow `&kp`. Two layers can't collide either, because a layer id is `[a-z][a-z0-9-]*` (LayerSchema) and
// `nodeNameOf` only rewrites `-` to `_`. Two combos *can* be written as one node name, because that name comes
// from the display name, which is free text: that is the one name-vs-name case here.
import { ZMK_BEHAVIOR_LABELS, ZMK_BUILTIN_HOLD_TAPS, comboNodeName, labelOf } from "../layout/firmware-names.ts";
import type { Layout } from "../layout/schema.ts";
import type { Issue } from "./result.ts";

/** One name generation writes, with the words a warning about it needs. */
type Claim = { label: string; noun: string; id: string; name: string };

const issue = (code: string, message: string, plain: string): Issue => ({ code, message, plain });
/** `macro "m1"` for the precise text, `the macro "Foo"` for the sentence. */
const byId = (c: Claim) => `${c.noun} "${c.id}"`;
const byName = (c: Claim) => `the ${c.noun} "${c.name}"`;

/** Every devicetree label ZMK generation takes from an id, in the order generate.ts's checkLabels claims them. */
function labelClaims(doc: Layout): Claim[] {
  const claims: Claim[] = [];
  // A built-in profile is an override of `&mt`/`&lt`, which is how a layout tunes one, not a new label.
  for (const p of doc.holdTapProfiles) if (!ZMK_BUILTIN_HOLD_TAPS.has(p.id)) claims.push({ label: labelOf(p.id), noun: "hold-tap profile", id: p.id, name: p.name });
  for (const m of doc.macros) claims.push({ label: labelOf(m.id), noun: "macro", id: m.id, name: m.name });
  for (const t of doc.tapDances) {
    claims.push({ label: labelOf(t.id), noun: "tap dance", id: t.id, name: t.name });
    // A tap dance with a hold slot also defines a hold-tap beside itself, named after the dance (emit-behaviors.ts).
    if (t.hold) claims.push({ label: labelOf(`${t.id}_hold`), noun: "hold-tap", id: `${t.id}_hold`, name: `${t.name} (tap, hold)` });
    if (t.tapThenHold) claims.push({ label: labelOf(`${t.id}_tap_hold`), noun: "hold-tap", id: `${t.id}_tap_hold`, name: `${t.name} (double-tap, hold)` });
  }
  return claims;
}

/**
 * `identifier_clash`: a name generation derives from an id must not be one the firmware already uses, and no
 * two of them may be the same. One issue per clash. It names the ids, because ids are what the person can
 * change in the editor; a combo, macro or profile has no slot of its own, hence no `slots`.
 */
export function identifierClash(doc: Layout): Issue[] {
  if (doc.firmware !== "zmk") return [];
  const out: Issue[] = [];
  const seen = new Map<string, Claim>();
  for (const claim of labelClaims(doc)) {
    if (ZMK_BEHAVIOR_LABELS.has(claim.label)) {
      out.push(issue("identifier_clash",
        `${byId(claim)} is written as the ZMK behaviour label "${claim.label}", which ZMK already defines`,
        `${byName(claim)} would take the name of a behaviour the firmware already has (&${claim.label}), so keyloom can't build this layout. Rename it.`));
    }
    const other = seen.get(claim.label);
    if (other === undefined) {
      seen.set(claim.label, claim);
      continue;
    }
    out.push(issue("identifier_clash",
      `${byId(claim)} and ${byId(other)} are both written as the ZMK label "${claim.label}"`,
      `${byName(claim)} and ${byName(other)} would both take the same name in the firmware (${claim.label}), so keyloom can't build this layout. Rename one.`));
  }
  // A combo's node name is not a label, so it is compared only with the other combos'.
  const nodes = new Map<string, Claim>();
  for (const c of doc.combos) {
    const claim: Claim = { label: comboNodeName(c), noun: "combo", id: c.id, name: c.name };
    const other = nodes.get(claim.label);
    if (other === undefined) nodes.set(claim.label, claim);
    else {
      out.push(issue("identifier_clash",
        `combos "${claim.id}" and "${other.id}" are both written as the devicetree node "${claim.label}"`,
        `${byName(claim)} and ${byName(other)} would both take the same name in the firmware, so keyloom can't build this layout. Rename one.`));
    }
  }
  return out;
}
