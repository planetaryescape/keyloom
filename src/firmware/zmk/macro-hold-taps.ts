// One specialized behavior per (profile, macro, hold kind). Ordinary key taps keep their original profile.
import type { Layout } from "../../layout/schema.ts";
import { ZMK_BEHAVIOR_LABELS, labelOf } from "../../layout/firmware-names.ts";
import { macroTapKey } from "./emit-binding.ts";
import { renderMacroHoldTap } from "./emit-behaviors.ts";
import { GenerateError } from "./generate-error.ts";

type MacroHoldTaps = { labels: Map<string, string>; nodes: string[][] };

export function macroHoldTaps(layout: Layout): MacroHoldTaps {
  const used = new Set(ZMK_BEHAVIOR_LABELS);
  for (const item of [...layout.holdTapProfiles, ...layout.macros, ...layout.tapDances]) used.add(labelOf(item.id));
  for (const dance of layout.tapDances) {
    if (dance.hold) used.add(labelOf(`${dance.id}_hold`));
    if (dance.tapThenHold) used.add(labelOf(`${dance.id}_tap_hold`));
  }
  // Kept source may define labels or preprocessor names that a generated helper must not shadow.
  for (const p of layout.passthrough.filter((p) => p.firmware === "zmk")) {
    for (const match of p.source.matchAll(/\b([A-Za-z_]\w*)\s*:|^\s*#define\s+([A-Za-z_]\w*)/gm)) used.add(match[1] ?? match[2]!);
  }
  const profiles = new Map(layout.holdTapProfiles.map((p) => [p.id, p]));
  const macros = new Map(layout.macros.map((m) => [m.id, labelOf(m.id)]));
  const labels = new Map<string, string>();
  const nodes: string[][] = [];
  for (const layer of layout.layers) for (const binding of layer.bindings) {
    if (binding.kind !== "holdTap" || binding.tap.macroId === undefined) continue;
    const profile = profiles.get(binding.profileId);
    if (!profile) throw new GenerateError(`it uses the hold-tap profile "${binding.profileId}", which doesn't exist`);
    if (profile.firmware !== "zmk") throw new GenerateError(`hold-tap profile "${profile.id}" is not a ZMK profile`);
    const macroLabel = macros.get(binding.tap.macroId);
    if (!macroLabel) throw new GenerateError(`it uses the macro "${binding.tap.macroId}", which doesn't exist`);
    const layerHold = "layerId" in binding.hold;
    const key = macroTapKey(profile.id, binding.tap.macroId, layerHold);
    if (labels.has(key)) continue;
    const base = `keyloom_${labelOf(profile.id)}_${macroLabel}_${layerHold ? "layer" : "mods"}`;
    let label = base;
    for (let suffix = 1; used.has(label); suffix++) label = `${base}_${suffix}`;
    used.add(label);
    labels.set(key, label);
    nodes.push(renderMacroHoldTap(profile, label, layerHold, macroLabel));
  }
  return { labels, nodes };
}
