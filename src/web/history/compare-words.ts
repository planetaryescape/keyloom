// A key in "Compare with now" said in words (D-316): what it did then and does now, named the way the Library and the key card name
// things ("Space, twice for ["), and what changed between them ("now also holds for Hyper"), so a tap dance isn't "TD0 → TD0".
import type { Binding, Layout, SlotAction } from "../../layout/schema.ts";
import { tapDanceSlots, type TapDanceSlotName } from "../../layout/functions.ts";
import { cardTitle, keyPhrase, modWords, slotPhrase } from "../card/card-words.ts";

type Context = Pick<Layout, "layers" | "macros" | "tapDances" | "passthrough">;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A dance's slots by name, for comparing two dances slot by slot. */
function slotsOf(b: Binding, ctx: Context): Map<TapDanceSlotName, SlotAction> | null {
  if (b.kind !== "tapDance") return null;
  const dance = ctx.tapDances.find((d) => d.id === b.tapDanceId);
  return dance === undefined ? null : new Map(tapDanceSlots(dance));
}

/** "holds for Hyper", "twice for [": one slot of a dance as the sentence says it. */
function slotSays(name: TapDanceSlotName, action: SlotAction, ctx: Context): string {
  const what = slotPhrase(action, ctx);
  return name === "tap" ? `types ${what}` : name === "hold" ? `holds for ${what}` : name === "doubleTap" ? `twice for ${what}` : `tap, then hold for ${what}`;
}

/** What changed from `before` (in its own revision) to `after` (now), in a few words; null when the two names already say it. */
export function changeWords(before: Binding, beforeCtx: Context, after: Binding, afterCtx: Context): string | null {
  // An Oryx dance kept as firmware code then, read into a dance keyloom can edit now.
  if (before.kind === "native" && after.kind !== "native") return "keyloom reads it now; it was firmware code it couldn't edit";
  if (before.kind !== "native" && after.kind === "native") return "now firmware code keyloom can't edit";

  const then = slotsOf(before, beforeCtx);
  const now = slotsOf(after, afterCtx);
  if (then !== null && now !== null) {
    const parts: string[] = [];
    for (const name of ["tap", "hold", "doubleTap", "tapThenHold"] as const) {
      const a = then.get(name);
      const b = now.get(name);
      if (a !== undefined && b === undefined) parts.push(`no longer ${slotSays(name, a, beforeCtx)}`);
      else if (a === undefined && b !== undefined) parts.push(`now also ${slotSays(name, b, afterCtx)}`);
      else if (a !== undefined && b !== undefined && !same(a, b)) parts.push(`now ${slotSays(name, b, afterCtx)} (was ${slotPhrase(a, beforeCtx)})`);
    }
    return parts.length === 0 ? "its timing changed" : parts.join(", ");
  }

  // A plain key that gained or lost a hold.
  if (before.kind === "key" && after.kind === "holdTap" && same({ code: before.code, mods: before.mods }, { code: after.tap.code, mods: after.tap.mods })) {
    return `now also holds for ${"mods" in after.hold ? modWords(after.hold.mods) : layerTitle(afterCtx, after.hold.layerId)}`;
  }
  if (before.kind === "holdTap" && after.kind === "key" && same({ code: after.code, mods: after.mods }, { code: before.tap.code, mods: before.tap.mods })) {
    return `no longer holds for ${"mods" in before.hold ? modWords(before.hold.mods) : layerTitle(beforeCtx, before.hold.layerId)}`;
  }
  if (before.kind === "holdTap" && after.kind === "holdTap") {
    if (same(before.tap, after.tap) && !same(before.hold, after.hold)) return `now holds for ${"mods" in after.hold ? modWords(after.hold.mods) : layerTitle(afterCtx, after.hold.layerId)}`;
    if (!same(before.tap, after.tap) && same(before.hold, after.hold)) return `now types ${keyPhrase(after.tap.code, after.tap.mods)}`;
    if (same(before.tap, after.tap) && same(before.hold, after.hold)) return "its timing changed";
  }
  return null;
}

const layerTitle = (ctx: Context, id: string) => ctx.layers.find((l) => l.id === id)?.name ?? "a layer";

/**
 * A key's then and now in words, what changed, and the title the row leads with: what the key does now, or, when only its hold
 * changed, just its tap ("A · now also holds for Control"), so the row doesn't say the hold twice.
 */
export function keyWords(before: Binding, beforeCtx: Context, after: Binding, afterCtx: Context): { then: string; now: string; change: string | null; title: string } {
  const change = changeWords(before, beforeCtx, after, afterCtx);
  const now = cardTitle(after, afterCtx);
  const tapOf = (b: Binding) => (b.kind === "key" ? keyPhrase(b.code, b.mods) : b.kind === "holdTap" ? keyPhrase(b.tap.code, b.tap.mods) : null);
  const holdOnly = change !== null && /holds for/.test(change) && (before.kind === "key" || before.kind === "holdTap") && (after.kind === "key" || after.kind === "holdTap");
  return { then: cardTitle(before, beforeCtx), now, change, title: holdOnly ? (tapOf(after) ?? now) : now };
}
