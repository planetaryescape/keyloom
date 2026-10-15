// Tap-hold feel (D-017): what a hold-tap profile may say on each firmware, which keys a change
// retunes, and the one feel hazard worth a warning, same-hand rolls on home-row mods. Pure, like the
// rest of src/validation. The generators (05, 06) throw on what these rules reject, so the problem
// shows in the preview and not as a failed build.
import type { BoardDefinition } from "../boards/schema.ts";
import type { Slot } from "../layout/change.ts";
import { deepEqual } from "../layout/equal.ts";
import type { Binding, HoldTapProfile, Layout } from "../layout/schema.ts";
import type { Issue } from "./result.ts";

const issue = (code: string, message: string, slots?: Slot[]): Issue => (slots?.length ? { code, message, slots } : { code, message });

type HoldTapAt = { binding: Extract<Binding, { kind: "holdTap" }>; slot: Slot };

function* holdTaps(doc: Layout): Generator<HoldTapAt> {
  for (const layer of doc.layers) {
    for (const [position, binding] of layer.bindings.entries()) {
      if (binding.kind === "holdTap") yield { binding, slot: { layerId: layer.id, position } };
    }
  }
}

const profileOf = (doc: Layout, id: string): HoldTapProfile | undefined => doc.holdTapProfiles.find((p) => p.id === id);

/** QMK's tap-hold settings; a change to one retunes every hold-tap (05). */
const QMK_TAP_HOLD_SETTINGS = new Set([
  "TAPPING_TERM", "TAPPING_TERM_PER_KEY", "PERMISSIVE_HOLD", "PERMISSIVE_HOLD_PER_KEY", "CHORDAL_HOLD", "FLOW_TAP_TERM",
  "QUICK_TAP_TERM", "QUICK_TAP_TERM_PER_KEY", "HOLD_ON_OTHER_KEY_PRESS", "HOLD_ON_OTHER_KEY_PRESS_PER_KEY", "RETRO_TAPPING",
  "RETRO_TAPPING_PER_KEY", "TAPPING_FORCE_HOLD", "IGNORE_MOD_TAP_INTERRUPT",
]);

/**
 * Hold-tap keys whose binding is unchanged but whose feel is not: their profile's options differ
 * between the two documents, or a tap-hold setting did and the profile does not pin it. Keys whose
 * binding changed are already in `changed`, so they are left out.
 */
export function retunedSlots(before: Layout, after: Layout, changed: readonly Slot[]): Slot[] {
  const changedKeys = new Set(changed.map((s) => `${s.layerId}:${s.position}`));
  const settingsMoved = new Set<string>();
  const settingKey = (s: { firmware: string; key: string }) => `${s.firmware}:${s.key}`;
  const was = new Map(before.settings.map((s) => [settingKey(s), s.value]));
  const is = new Map(after.settings.map((s) => [settingKey(s), s.value]));
  for (const key of new Set([...was.keys(), ...is.keys()])) {
    if (was.get(key) !== is.get(key) && key.startsWith("qmk:") && QMK_TAP_HOLD_SETTINGS.has(key.slice(4))) settingsMoved.add(key.slice(4));
  }
  const out: Slot[] = [];
  for (const { binding, slot } of holdTaps(after)) {
    if (changedKeys.has(`${slot.layerId}:${slot.position}`)) continue;
    const now = profileOf(after, binding.profileId);
    const then = profileOf(before, binding.profileId);
    const profileMoved = !deepEqual(now?.options, then?.options);
    // A setting only matters to a profile that does not set the option itself.
    const settingMoved = [...settingsMoved].some((key) => now?.options[key] === undefined);
    if (profileMoved || settingMoved) out.push(slot);
  }
  return out;
}

// What QMK can set per key (emit-tapping.ts PER_KEY): the value types the callbacks return.
const QMK_PER_KEY: Record<string, "number" | "boolean"> = {
  TAPPING_TERM: "number", QUICK_TAP_TERM: "number", PERMISSIVE_HOLD: "boolean", HOLD_ON_OTHER_KEY_PRESS: "boolean",
};

const ZMK_FLAVORS = new Set(["hold-preferred", "balanced", "tap-preferred", "tap-unless-interrupted"]);
const ZMK_MS_OPTIONS = ["tapping-term-ms", "quick-tap-ms", "require-prior-idle-ms"] as const;
const ZMK_PROP_NAME = /^[A-Za-z0-9,._+?#-]+$/;

/** The text of a hold-tap's tap and hold, which is what QMK's per-key callbacks match on (emit-tapping.ts). */
const qmkKeyExpr = (b: HoldTapAt["binding"]) => JSON.stringify([b.tap, b.hold]);

function qmkOptions(doc: Layout): Issue[] {
  const out: Issue[] = [];
  const globals = new Map(doc.settings.filter((s) => s.firmware === "qmk").map((s) => [s.key, s.value]));
  const used = new Map<string, Slot[]>();
  for (const { binding, slot } of holdTaps(doc)) used.set(binding.profileId, [...(used.get(binding.profileId) ?? []), slot]);

  for (const [profileId, slots] of used) {
    const profile = profileOf(doc, profileId);
    if (!profile) continue; // unknown_ref reports it
    for (const [key, value] of Object.entries(profile.options)) {
      const global = globals.get(key);
      if (value === global) continue;
      if (typeof value === "boolean" && global === undefined && value === false) continue;
      const type = QMK_PER_KEY[key];
      if (type === undefined || typeof value !== type) {
        out.push(issue(
          "firmware_unsupported",
          `hold-tap profile "${profileId}" sets ${key} to ${JSON.stringify(value)} but the layout-wide setting is ${JSON.stringify(global ?? null)}, and QMK can't set ${key} per key. Only ${Object.keys(QMK_PER_KEY).join(", ")} can differ between profiles; change the layout-wide setting for the others`,
          slots,
        ));
      }
    }
  }

  // QMK picks the per-key value by keycode, so two keys with the same tap and hold must agree.
  const byExpr = new Map<string, { slot: Slot; values: Map<string, unknown> }[]>();
  for (const { binding, slot } of holdTaps(doc)) {
    const profile = profileOf(doc, binding.profileId);
    if (!profile) continue;
    const values = new Map<string, unknown>();
    for (const key of Object.keys(QMK_PER_KEY)) values.set(key, profile.options[key] ?? globals.get(key) ?? null);
    byExpr.set(qmkKeyExpr(binding), [...(byExpr.get(qmkKeyExpr(binding)) ?? []), { slot, values }]);
  }
  for (const group of byExpr.values()) {
    for (const key of Object.keys(QMK_PER_KEY)) {
      const distinct = new Set(group.map((g) => JSON.stringify(g.values.get(key))));
      if (distinct.size > 1) {
        out.push(issue(
          "firmware_unsupported",
          `keys with the same tap and hold have different ${key} values; QMK picks ${key} by keycode, so they must agree`,
          group.map((g) => g.slot),
        ));
      }
    }
  }
  return out;
}

function zmkOptions(board: BoardDefinition, doc: Layout): Issue[] {
  const out: Issue[] = [];
  for (const profile of doc.holdTapProfiles.filter((p) => p.firmware === "zmk")) {
    const say = (message: string) => out.push(issue("firmware_unsupported", `hold-tap profile "${profile.id}": ${message}`));
    for (const [name, value] of Object.entries(profile.options)) {
      if (!ZMK_PROP_NAME.test(name)) say(`"${name}" isn't a devicetree property name`);
      if (name === "flavor" && (typeof value !== "string" || !ZMK_FLAVORS.has(value))) {
        say(`flavor must be one of ${[...ZMK_FLAVORS].join(", ")}, not ${JSON.stringify(value)}`);
      }
      if ((ZMK_MS_OPTIONS as readonly string[]).includes(name) && !(typeof value === "number" && Number.isInteger(value) && value >= 0)) {
        say(`${name} must be a whole number of milliseconds, not ${JSON.stringify(value)}`);
      }
      if (name === "hold-trigger-key-positions") {
        if (!Array.isArray(value) || value.some((p) => !Number.isInteger(p) || p < 0 || p >= board.keyCount)) {
          say(`hold-trigger-key-positions must list key positions from 0 to ${board.keyCount - 1}`);
        }
      }
    }
  }
  return out;
}

/** `firmware_unsupported` for hold-tap profile options the firmware can't take, so the build never fails on them. */
export const holdTapOptions = (board: BoardDefinition, doc: Layout): Issue[] => (doc.firmware === "qmk" ? qmkOptions(doc) : zmkOptions(board, doc));

const isOn = (v: string | number | boolean | undefined) => v !== undefined && v !== false && v !== 0 && v !== "0" && v !== "";

const isLetter = (code: string) => /^[A-Z]$/.test(code);

/** Which hand a position is on, or undefined for a position the board gives to neither. */
const handOf = (board: BoardDefinition, position: number): "left" | "right" | undefined =>
  board.hands.left.includes(position) ? "left" : board.hands.right.includes(position) ? "right" : undefined;

/**
 * Whether a home-row hold-tap only holds when the other hand is involved (07). On QMK that is
 * Chordal Hold, a layout-wide setting a profile may repeat. On ZMK it is `hold-trigger-key-positions`
 * naming positions that are not on the key's own hand, apart from thumb keys, which may trigger it.
 */
function constrained(board: BoardDefinition, doc: Layout, at: HoldTapAt): boolean {
  const profile = profileOf(doc, at.binding.profileId);
  if (doc.firmware === "qmk") {
    const setting = doc.settings.find((s) => s.firmware === "qmk" && s.key === "CHORDAL_HOLD")?.value;
    const own = profile?.options.CHORDAL_HOLD;
    return isOn(own === undefined || Array.isArray(own) ? setting : own);
  }
  const positions = profile?.options["hold-trigger-key-positions"];
  if (!Array.isArray(positions) || positions.length === 0) return false;
  const own = handOf(board, at.slot.position);
  const thumbs = new Set(board.rows.thumb ?? []);
  return positions.every((p) => thumbs.has(p) || handOf(board, p) !== own);
}

/**
 * `homerow_same_hand_mods`: a letter on the home row that holds a modifier, with nothing stopping
 * the modifier from firing when the same hand rolls the next letter (D-017). One warning per
 * profile, naming its keys. A hold-tap that holds a layer is left alone: a layer-tap on a letter is
 * a different decision, and the same-hand roll is what makes a modifier misfire.
 */
export function homerowSameHandMods(board: BoardDefinition, doc: Layout): Issue[] {
  const home = new Set(board.rows.home ?? []);
  const byProfile = new Map<string, Slot[]>();
  for (const at of holdTaps(doc)) {
    if (!home.has(at.slot.position) || !("mods" in at.binding.hold) || !isLetter(at.binding.tap.code)) continue;
    if (constrained(board, doc, at)) continue;
    byProfile.set(at.binding.profileId, [...(byProfile.get(at.binding.profileId) ?? []), at.slot]);
  }
  const how = doc.firmware === "qmk" ? "turn on CHORDAL_HOLD" : "give its profile hold-trigger-key-positions for the opposite hand";
  return [...byProfile].map(([profileId, slots]) =>
    issue(
      "homerow_same_hand_mods",
      `${slots.length === 1 ? "A home-row letter holds" : `${slots.length} home-row letters hold`} a modifier with nothing that needs the other hand (profile "${profileId}"), so rolling two letters with one hand can trigger the modifier by accident. To avoid that, ${how}`,
      slots,
    ));
}
