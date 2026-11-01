// Source-derived behavior facts shared by the reviewer and its preservation checks. Never infer meaning from a legend.
import { keptDefinitions, parseCalls } from "./kept-behaviours.ts";
import { readNative } from "./native-read.ts";
import type { Binding, Layout } from "./schema.ts";
import { deepEqual } from "./equal.ts";
import type { ChangeOp, Slot } from "./change.ts";

export function nativeBehaviorFacts(layout: Layout, binding: Extract<Binding, { kind: "native" }>) {
  const kept = keptDefinitions(layout.passthrough);
  const pending = (binding.firmware === "zmk" ? parseCalls(binding.source) : undefined)?.map((call) => call.name) ?? [];
  const seen = new Set<string>();
  const definitions: Array<{ anchor: string; source: string }> = [];
  while (pending.length && seen.size < 32) {
    const name = pending.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const entry of layout.passthrough) {
      if (entry.firmware === binding.firmware && (entry.anchor === `behavior:${name}` || entry.anchor === `macro:${name}`)) {
        definitions.push({ anchor: entry.anchor, source: entry.source });
      }
    }
    const definition = kept.get(name);
    if (definition) pending.push(...definition.cells.flatMap((cell) => cell.map((call) => call.name)));
  }
  return {
    source: binding.source,
    reading: readNative(binding, kept),
    definitions,
    dependencyLimitReached: pending.some((name) => !seen.has(name)),
    scope: "Source-derived facts, not a runtime test. Unknown effects remain unknown; empty tapSteps do not prove that a tap does nothing. Legends are not behavior evidence.",
  };
}

/** A narrowly proven edit: only the referenced hold-layer parameter changes; the behavior, tap and other parameters stay verbatim. */
export function preservesNativeBehavior(before: Layout, old: Extract<Binding, { kind: "native" }>, after: Layout, next: Binding | undefined): boolean {
  if (!next || next.kind !== "native" || next.firmware !== old.firmware || !deepEqual(before.passthrough, after.passthrough)) return false;
  if (old.source === next.source && deepEqual(old.layerRefs, next.layerRefs)) return true;
  const oldReading = readNative(old, keptDefinitions(before.passthrough));
  const newReading = readNative(next, keptDefinitions(after.passthrough));
  if (oldReading.kind !== "holdLayer" || newReading.kind !== "holdLayer" || oldReading.tap !== newReading.tap) return false;
  const template = (binding: typeof old) => {
    const refs = binding.layerRefs ?? [];
    const ref = refs[0];
    return refs.length === 1 && ref && ref.start >= 0 && ref.end <= binding.source.length
      ? `${binding.source.slice(0, ref.start)}<layer>${binding.source.slice(ref.end)}` : null;
  };
  const source = template(old);
  return source !== null && source === template(next);
}

/** Literal effects only. No claimed diagnosis, comfort, frequency or runtime result comes from a model. */
export function behaviorDescription(layout: Layout, binding: Binding | undefined): string {
  if (!binding) return "absent";
  switch (binding.kind) {
    case "none": return "empty";
    case "transparent": return "fall through to a lower layer";
    case "key": return `key ${binding.code}${binding.mods?.length ? ` + ${binding.mods.join("+")}` : ""}`;
    case "modifier": return `hold ${binding.mods.join("+")}`;
    case "layer": return `${binding.action} {layer:${binding.layerId}}`;
    case "macro": return `run macro ${binding.macroId}`;
    case "tapDance": return `tap dance ${binding.tapDanceId}`;
    case "holdTap": return `tap ${binding.tap.macroId ? `macro ${binding.tap.macroId}` : binding.tap.code}; hold ${"layerId" in binding.hold ? `{layer:${binding.hold.layerId}}` : binding.hold.mods.join("+")}`;
    case "native": {
      const reading = readNative(binding, keptDefinitions(layout.passthrough));
      if (reading.kind === "holdLayer") return `tap calls ${reading.tap}; hold {layer:${reading.layerId}}`;
      if (reading.kind === "steps") return `source effects ${JSON.stringify(reading.steps)}`;
      return `custom source ${binding.source} (effects unknown)`;
    }
  }
}

/** Existing tap/hold and macro actions stay attached to their key, even when the same output also exists elsewhere. */
export function preservesCompoundBehavior(before: Layout, old: Binding, after: Layout, next: Binding | undefined): boolean {
  const macro = (layout: Layout, id: string | undefined) => id === undefined ? undefined : layout.macros.find((m) => m.id === id)?.steps;
  if (old.kind === "holdTap") return next?.kind === "holdTap" && deepEqual(old.tap, next.tap) && deepEqual(old.hold, next.hold)
    && deepEqual(macro(before, old.tap.macroId), macro(after, next.tap.macroId));
  if (old.kind === "macro") return next?.kind === "macro" && deepEqual(macro(before, old.macroId), macro(after, next.macroId));
  if (old.kind === "tapDance") {
    if (next?.kind !== "tapDance") return false;
    const was = before.tapDances.find((t) => t.id === old.tapDanceId);
    const now = after.tapDances.find((t) => t.id === next.tapDanceId);
    if (!was || !now) return false;
    return ["tap", "hold", "doubleTap", "tapThenHold"].every((name) => {
      const slot = name as "tap" | "hold" | "doubleTap" | "tapThenHold";
      const a = was?.[slot]; const b = now?.[slot];
      return deepEqual(a, b) && deepEqual(macro(before, a?.kind === "macro" ? a.macroId : undefined), macro(after, b?.kind === "macro" ? b.macroId : undefined));
    });
  }
  return true;
}

/** Retarget an understood native hold without asking a model to rewrite its source or recreate its tap. */
export function retargetLayerHold(layout: Layout, at: Slot, layerId: string): { ops: ChangeOp[]; preservedTap: string } {
  const binding = layout.layers.find((l) => l.id === at.layerId)?.bindings[at.position];
  const index = layout.layers.findIndex((l) => l.id === layerId);
  if (index < 0) throw new Error("The target layer does not exist.");
  if (binding?.kind !== "native") throw new Error("This tool needs a custom hold-layer binding; use a normal setBinding for a modeled layer key.");
  const reading = readNative(binding, keptDefinitions(layout.passthrough));
  const ref = binding.layerRefs?.[0];
  if (reading.kind !== "holdLayer" || !ref || binding.layerRefs?.length !== 1) throw new Error("The hold-layer parameter cannot be proven. Keep this custom behavior unchanged.");
  const parameter = String(index);
  const next = { ...binding, source: `${binding.source.slice(0, ref.start)}${parameter}${binding.source.slice(ref.end)}`,
    layerRefs: [{ start: ref.start, end: ref.start + parameter.length, layerId }] };
  if (!preservesNativeBehavior(layout, binding, layout, next)) throw new Error("The edit does not preserve this custom behavior.");
  const ops: ChangeOp[] = [{ op: "setBinding", at, binding: next }];
  if (binding.source !== next.source) ops.push({ op: "dropFunction", function: `native:${binding.firmware}:${binding.source}`, reason: "Only the proven hold-layer argument changes; the custom tap and its source stay unchanged." });
  return { ops, preservedTap: reading.tap };
}
