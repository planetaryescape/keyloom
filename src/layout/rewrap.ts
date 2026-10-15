// "Same behaviour, this key's own letter": the shared half of mirroring (mirror.ts) and repeating
// an edit on a selection (repeat.ts). A key's own tap is what it types now; only the hold around it
// changes, because a tap is the key's identity and a hold is the behaviour BK wants to copy.
import type { Binding, HoldAction, TapAction } from "./schema.ts";

/** What copying a behaviour onto a key came to: the new binding, nothing to do, or why the key can't take it. */
export type Rewrapped = { binding: Binding } | { unchanged: true } | { skip: string };

/** The key a binding types when tapped, or null when it has none of its own (layer, macro, transparent, none, modifier, native). */
export function ownTap(binding: Binding): TapAction | null {
  if (binding.kind === "key") return { code: binding.code, ...(binding.mods ? { mods: binding.mods } : {}) };
  if (binding.kind === "holdTap") return binding.tap;
  return null;
}

export const tapOnly = (tap: TapAction): Binding => ({ kind: "key", code: tap.code, ...(tap.mods ? { mods: tap.mods } : {}) });

export const NO_TAP = "it has no key of its own to keep as the tap";

/** Puts `hold` around the target's own tap. */
export function withHold(target: Binding, hold: HoldAction, profileId: string): Binding | { skip: string } {
  const tap = ownTap(target);
  if (tap === null) return { skip: NO_TAP };
  return { kind: "holdTap", tap, hold, profileId };
}

/** Takes the hold off the target and keeps the key it taps. */
export function withoutHold(target: Binding): Binding | { skip: string } {
  const tap = ownTap(target);
  if (tap === null) return { skip: NO_TAP };
  return tapOnly(tap);
}
