// "Repeat last change on selection" (09, D-011, D-061): what an edit did, reduced to something that
// can be done to other keys. Deliberately narrow: three transforms, each named below, and a
// key it can't be applied to is skipped and said so, never guessed at.
import { deepEqual } from "./equal.ts";
import { type Rewrapped, ownTap, withHold, withoutHold } from "./rewrap.ts";
import type { Binding, HoldAction, TapAction } from "./schema.ts";

export type RepeatTransform =
  /** The edit put a hold on a key and left its tap alone (or changed the hold): give each key that hold, with its own tap. */
  | { kind: "rewrap"; hold: HoldAction; profileId: string }
  /** The edit took a hold off and kept the tap: take the hold off each key, keeping its own tap. */
  | { kind: "unwrap" }
  /** Any other edit: set each key to exactly the binding the edit produced. */
  | { kind: "copy"; binding: Binding };

const sameTap = (a: TapAction, b: TapAction) =>
  a.macroId && b.macroId ? a.macroId === b.macroId : a.code === b.code && deepEqual(a.mods ?? [], b.mods ?? []);

/** Null when the edit changed nothing, so there is nothing to repeat. */
export function repeatTransform(before: Binding, after: Binding): RepeatTransform | null {
  if (deepEqual(before, after)) return null;
  const was = ownTap(before);
  if (after.kind === "holdTap" && was !== null && sameTap(was, after.tap)) {
    return { kind: "rewrap", hold: after.hold, profileId: after.profileId };
  }
  if (before.kind === "holdTap" && after.kind === "key" && sameTap(before.tap, ownTap(after) as TapAction)) return { kind: "unwrap" };
  return { kind: "copy", binding: after };
}

export function applyRepeat(transform: RepeatTransform, target: Binding): Rewrapped {
  const result: Binding | { skip: string } =
    transform.kind === "rewrap" ? withHold(target, transform.hold, transform.profileId)
    : transform.kind === "unwrap" ? (target.kind === "holdTap" ? withoutHold(target) : target)
    : transform.binding;
  if ("skip" in result) return result;
  return deepEqual(result, target) ? { unchanged: true } : { binding: result };
}
