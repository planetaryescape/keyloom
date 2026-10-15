// Mirroring a behaviour from one half of a split board onto the other (D-011, D-060). Pure: the
// board's partner map comes in as an argument, because src/layout may not read boards.
import { deepEqual } from "./equal.ts";
import { NO_TAP, type Rewrapped, ownTap, tapOnly, withHold } from "./rewrap.ts";
import type { Binding, HoldTapProfile, Layout, Mod } from "./schema.ts";

export type Hand = "left" | "right";

const LEFT: Record<Mod, Mod> = { LCTL: "LCTL", LSFT: "LSFT", LALT: "LALT", LGUI: "LGUI", RCTL: "LCTL", RSFT: "LSFT", RALT: "LALT", RGUI: "LGUI" };
const RIGHT: Record<Mod, Mod> = { LCTL: "RCTL", LSFT: "RSFT", LALT: "RALT", LGUI: "RGUI", RCTL: "RCTL", RSFT: "RSFT", RALT: "RALT", RGUI: "RGUI" };

/**
 * The same modifiers as the hand of the key that will carry them. Mapping to the target's hand
 * (not swapping each one) keeps every result single-handed, which QMK needs: one right-hand
 * modifier makes a whole mod-tap right-handed (07, qmk_modtap_mixed_hands).
 */
export function modsForHand(mods: readonly Mod[], hand: Hand): Mod[] {
  const map = hand === "left" ? LEFT : RIGHT;
  return [...new Set(mods.map((m) => map[m]))];
}

/**
 * What `target` becomes when it takes on the behaviour of `source`, its mirror image on the other
 * half. A hold-tap or plain key brings its hold (or lack of one) and keeps the target's own tap;
 * a modifier key brings its modifiers; anything else is copied whole. `targetHand` decides
 * which hand's modifiers the result carries.
 */
export function mirrorBinding(source: Binding, target: Binding, targetHand: Hand): Rewrapped {
  switch (source.kind) {
    case "holdTap": {
      const hold = "mods" in source.hold ? { mods: modsForHand(source.hold.mods, targetHand) } : source.hold;
      const result = withHold(target, hold, source.profileId);
      return settle(result, target);
    }
    case "key": {
      if (source.mods?.length) return { skip: "the key it mirrors types a modified key, which is not a behaviour that mirrors" };
      const tap = ownTap(target);
      if (tap === null) return { skip: NO_TAP };
      return settle(tapOnly(tap), target);
    }
    case "modifier":
      return settle({ kind: "modifier", mods: modsForHand(source.mods, targetHand) }, target);
    case "layer":
    case "macro":
    case "tapDance":
    case "transparent":
    case "none":
    case "native":
      return settle(source, target);
  }
}

function settle(result: Binding | { skip: string }, target: Binding): Rewrapped {
  if ("skip" in result) return result;
  return deepEqual(result, target) ? { unchanged: true } : { binding: result };
}

/**
 * ZMK hold-tap profiles can restrict a hold to when the other hand's keys are pressed
 * (`hold-trigger-key-positions`, 06). A left-hand profile lists right-hand positions, so reusing it
 * on the right would make a right-hand mod fire on right-hand rolls, the opposite of its purpose.
 * The mirrored profile lists the partner of each position. QMK profiles carry no positions and are
 * reused as they are.
 */
export type MirroredProfile =
  | { profileId: string; upsert?: HoldTapProfile }
  | { skip: string };

const TRIGGER = "hold-trigger-key-positions";

export function mirrorProfile(layout: Layout, profileId: string, partners: ReadonlyMap<number, number>): MirroredProfile {
  const profile = layout.holdTapProfiles.find((p) => p.id === profileId);
  const positions = profile?.options[TRIGGER];
  if (profile === undefined || !Array.isArray(positions)) return { profileId };

  const mapped: number[] = [];
  for (const p of positions) {
    const partner = partners.get(p);
    if (partner === undefined) return { skip: `profile "${profileId}" lists position ${p}, which has no mirror position` };
    mapped.push(partner);
  }
  mapped.sort((a, b) => a - b);
  const options = { ...profile.options, [TRIGGER]: mapped };

  // The mirror of a mirrored profile is the original, and a second run finds the profile it made.
  const existing = layout.holdTapProfiles.find((p) => p.firmware === profile.firmware && deepEqual(p.options, options));
  if (existing !== undefined) return { profileId: existing.id };

  const taken = new Set(layout.holdTapProfiles.map((p) => p.id));
  let id = `${profile.id}-mirrored`;
  for (let n = 2; taken.has(id); n++) id = `${profile.id}-mirrored-${n}`;
  return { profileId: id, upsert: { id, name: `${profile.name} (mirrored)`, firmware: profile.firmware, options } };
}
