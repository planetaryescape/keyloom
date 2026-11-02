import type { BoardDefinition } from "../boards/schema.ts";
import { applyOps } from "../layout/apply-ops.ts";
import { deepEqual } from "../layout/equal.ts";
import type { ChangeOp, Slot } from "../layout/change.ts";
import { bindingEffectDescription, describeKey, macroStepWords, slotActionWords } from "../layout/describe.ts";
import { layerColorOf, layerShortLabel, niceLayerName } from "../layout/layer-ops.ts";
import { optionLabel } from "../layout/option-words.ts";
import type { Combo, ConditionalLayer, FirmwareSetting, HoldTapProfile, Layer, Layout, Macro, TapDance } from "../layout/schema.ts";

const PROFILE_OPTIONS = new Set(["tapping-term-ms", "quick-tap-ms", "require-prior-idle-ms", "hold-trigger-key-positions", "flavor", "hold-trigger-on-release", "retro-tap", "TAPPING_TERM", "QUICK_TAP_TERM", "PERMISSIVE_HOLD", "HOLD_ON_OTHER_KEY_PRESS", "CHORDAL_HOLD"]);
const FLAVORS = {
  "hold-preferred": "Hold preferred",
  balanced: "Balanced",
  "tap-preferred": "Tap preferred",
  "tap-unless-interrupted": "Tap unless interrupted",
} as const;

export type ChangedField = {
  key: string;
  label: string;
  current: string;
  proposed: string;
  recognized: boolean;
  verified?: boolean;
  currentValues?: readonly number[];
  proposedValues?: readonly number[];
};

export type ChangedProfile = { id: string; name: string; fields: readonly ChangedField[] };
export type ChangeSection = { title: string; items: readonly { name: string; fields: readonly ChangedField[] }[] };
export type ProposalChanges = {
  summary: string;
  profiles: readonly ChangedProfile[];
  sections: readonly ChangeSection[];
  changedSlots: readonly Slot[];
  bindings: readonly { slot: Slot; keyName: string; current: string; proposed: string; complete: boolean }[];
  callers: readonly { profileName: string; phase: "current" | "proposed"; layerId: string; layerName: string; slots: readonly Slot[] }[];
  triggers: readonly { profileName: string; added: readonly number[]; removed: readonly number[] }[];
  incomplete: readonly string[];
};

type FieldSpec<T> = { key: string; label: string; value: (item: T, layout: Layout) => string; verified?: (item: T, layout: Layout) => boolean };

function field(key: string, label: string, current: string, proposed: string, verified = true): ChangedField | undefined {
  return current === proposed ? undefined : { key, label, current, proposed, recognized: true, verified };
}

function compareEntity<T>(current: T | undefined, proposed: T | undefined, currentLayout: Layout, proposedLayout: Layout, specs: readonly FieldSpec<T>[]): ChangedField[] {
  if (current === undefined && proposed === undefined) return [];
  return specs.flatMap((spec) => {
    const from = current === undefined ? "Not present" : spec.value(current, currentLayout);
    const to = proposed === undefined ? "Not present" : spec.value(proposed, proposedLayout);
    const changed = field(spec.key, spec.label, from, to,
      (current === undefined || spec.verified?.(current, currentLayout) !== false)
      && (proposed === undefined || spec.verified?.(proposed, proposedLayout) !== false));
    return changed === undefined ? [] : [changed];
  });
}

function entitySection<T extends { id: string }>(title: string, before: readonly T[], after: readonly T[], name: (item: T) => string, currentLayout: Layout, proposedLayout: Layout, specs: readonly FieldSpec<T>[]): ChangeSection {
  const ids = [...new Set([...before, ...after].map((item) => item.id))];
  const items = ids.flatMap((id) => {
    const current = before.find((item) => item.id === id);
    const proposed = after.find((item) => item.id === id);
    const item = proposed ?? current;
    if (item === undefined) return [];
    const fields = compareEntity(current, proposed, currentLayout, proposedLayout, specs);
    return fields.length === 0 ? [] : [{ name: name(item), fields }];
  });
  return { title, items };
}

function profileComparisons(before: Layout, after: Layout, board: BoardDefinition) {
  const ids = [...new Set([...before.holdTapProfiles, ...after.holdTapProfiles].map((profile) => profile.id))].sort();
  const currentProfiles = new Map(before.holdTapProfiles.map((profile) => [profile.id, profile]));
  const proposedProfiles = new Map(after.holdTapProfiles.map((profile) => [profile.id, profile]));
  const currentLayers = new Map(before.layers.map((layer) => [layer.id, layer]));
  const proposedLayers = new Map(after.layers.map((layer) => [layer.id, layer]));
  const profiles: ChangedProfile[] = [];
  const callers: ProposalChanges["callers"][number][] = [];
  const triggers: ProposalChanges["triggers"][number][] = [];
  for (const id of ids) {
    const current = currentProfiles.get(id);
    const proposed = proposedProfiles.get(id);
    if (deepEqual(current, proposed)) continue;
    const profileName = proposed?.name ?? current?.name ?? "Unnamed tap/hold profile";
    const fields = compareEntity(current, proposed, before, after, [
      { key: "name", label: "Profile name", value: (profile) => profile.name },
      { key: "firmware", label: "Firmware", value: (profile) => profile.firmware.toUpperCase() },
    ]);
    for (const key of [...new Set([...Object.keys(current?.options ?? {}), ...Object.keys(proposed?.options ?? {})])].sort()) {
      const from = current?.options[key];
      const to = proposed?.options[key];
      if (deepEqual(from, to)) continue;
      const known = PROFILE_OPTIONS.has(key);
      const isTriggerSet = key === "hold-trigger-key-positions";
      const option: ChangedField = {
        key,
        label: known ? optionLabel(key) : `Unrecognized option “${key}”`,
        current: optionValue(key, from),
        proposed: optionValue(key, to),
        recognized: known,
      };
      if (Array.isArray(from)) option.currentValues = from;
      if (Array.isArray(to)) option.proposedValues = to;
      fields.push(option);
      if (isTriggerSet) {
        const oldPositions = numberSet(from);
        const nextPositions = numberSet(to);
        triggers.push({ profileName, added: [...nextPositions].filter((position) => !oldPositions.has(position)).sort((a, b) => a - b), removed: [...oldPositions].filter((position) => !nextPositions.has(position)).sort((a, b) => a - b) });
      }
    }
    profiles.push({ id, name: profileName, fields });
    const currentSlots = profileCallers(before, id, board);
    const proposedSlots = profileCallers(after, id, board);
    for (const [phase, slots] of [["current", currentSlots], ["proposed", proposedSlots]] as const) {
      const grouped = new Map<string, Slot[]>();
      for (const slot of slots) {
        const layer = currentLayers.get(slot.layerId) ?? proposedLayers.get(slot.layerId);
        if (layer === undefined) continue;
        const group = grouped.get(layer.id) ?? [];
        if (!group.some((candidate) => candidate.position === slot.position)) group.push(slot);
        grouped.set(layer.id, group);
      }
      for (const [layerId, layerSlots] of grouped) {
        const layer = proposedLayers.get(layerId) ?? currentLayers.get(layerId);
        if (layer) callers.push({ profileName, phase, layerId, layerName: layer.name, slots: layerSlots.sort((a, b) => a.position - b.position) });
      }
    }
  }
  return { profiles, callers, triggers };
}

/** A pure, source-derived comparison. Unsupported changed categories are returned as incomplete, never silently summarized as complete. */
export function proposalChanges(before: Layout, ops: readonly ChangeOp[], board: BoardDefinition): ProposalChanges {
  const applied = applyOps(before, ops);
  if (!applied.ok) throw new Error("Cannot describe an invalid automatic proposal");
  const after = applied.layout;
  const incomplete: string[] = [];
  const { profiles, callers, triggers } = profileComparisons(before, after, board);

  const layerIds = [...new Set([...before.layers, ...after.layers].map((layer) => layer.id))];
  const layers = layerIds.flatMap((id) => {
    const current = before.layers.find((layer) => layer.id === id);
    const proposed = after.layers.find((layer) => layer.id === id);
    const fields = compareEntity(current, proposed, before, after, [
      { key: "name", label: "Name", value: (layer) => layer.name },
      { key: "order", label: "Layer order", value: (layer, layout) => String(layout.layers.findIndex((candidate) => candidate.id === layer.id) + 1) },
      { key: "shortLabel", label: "Key label", value: (layer) => layer.shortLabel ?? `Default (${layerShortLabel(layer)})` },
      { key: "color", label: "On-screen color", value: (layer, layout) => layer.color === undefined ? `Position default (palette ${layerColorOf(layout.layers, layout.layers.findIndex((candidate) => candidate.id === layer.id))})` : `Palette ${layer.color}` },
      { key: "lighting", label: "Physical LED colors", value: (layer) => lightingWords(layer.lighting, board) },
    ]);
    if (!deepEqual(current?.sensorBindings, proposed?.sensorBindings)) {
      incomplete.push(`Encoder actions on ${proposed?.name ?? current?.name ?? "a changed layer"} are not represented; preview and Apply are unavailable.`);
    }
    return fields.length === 0 ? [] : [{ name: `Layer ${proposed?.name ?? current?.name ?? "(unnamed)"}`, fields }];
  });

  const comboSection = entitySection("Combos", before.combos, after.combos, (combo) => `Combo · ${combo.name}`, before, after, [
    { key: "name", label: "Name", value: (combo) => combo.name },
    { key: "positions", label: "Keys", value: (combo) => combo.positions.map((position) => physicalKeyName(board, position)).join(" + ") },
    { key: "layers", label: "Active on", value: (combo, layout) => combo.layerIds === "all" ? "All layers" : combo.layerIds.map((id) => layout.layers.find((layer) => layer.id === id)?.name ?? "Unknown layer").join(", ") },
    { key: "output", label: "Output", value: (combo, layout) => bindingEffectDescription(combo.output, layout).text, verified: (combo, layout) => bindingEffectDescription(combo.output, layout).complete },
    { key: "timeout", label: "Chord window", value: (combo) => combo.timeoutMs === undefined ? "Firmware default" : `${combo.timeoutMs} ms` },
  ]);
  const macroSection = entitySection("Macros", before.macros, after.macros, (macro) => `Macro · ${macro.name}`, before, after, [
    { key: "name", label: "Name", value: (macro) => macro.name },
    { key: "steps", label: "Actions", value: (macro) => macro.steps.map(macroStepWords).join("; then ") },
  ]);
  const danceSection = entitySection("Tap dances", before.tapDances, after.tapDances, (dance) => `Tap dance · ${dance.name}`, before, after, [
    { key: "name", label: "Name", value: (dance) => dance.name },
    { key: "tap", label: "Tap", value: (dance, layout) => dance.tap ? slotActionWords(dance.tap, layout) : "Not set" },
    { key: "hold", label: "Hold", value: (dance, layout) => dance.hold ? slotActionWords(dance.hold, layout) : "Not set" },
    { key: "doubleTap", label: "Double-tap", value: (dance, layout) => dance.doubleTap ? slotActionWords(dance.doubleTap, layout) : "Not set" },
    { key: "tapThenHold", label: "Tap then hold", value: (dance, layout) => dance.tapThenHold ? slotActionWords(dance.tapThenHold, layout) : "Not set" },
    { key: "termMs", label: "Tapping term", value: (dance) => dance.termMs === undefined ? "Firmware default" : `${dance.termMs} ms` },
  ]);
  const conditionalSection = entitySection("Conditional layers", before.conditionalLayers, after.conditionalLayers, (conditional) => conditionalLayerName(conditional, after), before, after, [
    { key: "condition", label: "When both layers are active", value: (item, layout) => item.ifLayerIds.map((id) => layerWords(layout, id)).join(" + ") },
    { key: "then", label: "Also activate", value: (item, layout) => layerWords(layout, item.thenLayerId) },
  ]);
  const settingSection = entitySection("Firmware settings", before.settings.map((setting) => ({ ...setting, id: `${setting.firmware}:${setting.key}` })), after.settings.map((setting) => ({ ...setting, id: `${setting.firmware}:${setting.key}` })), (setting) => `Firmware · ${setting.key}`, before, after, [
    { key: "value", label: "Value", value: settingValue },
  ]);
  const sections = [
    { title: "Layers", items: layers }, comboSection, macroSection, danceSection, conditionalSection, settingSection,
  ].filter((section) => section.items.length > 0);

  for (const section of sections) for (const item of section.items) for (const changed of item.fields) {
    if (changed.verified === false) incomplete.push(`${item.name} · ${changed.label} has an effect that is not established; preview and Apply are unavailable.`);
  }
  if (!deepEqual(before.passthrough, after.passthrough)) incomplete.push("Preserved firmware source changed but is not represented; preview and Apply are unavailable.");

  const changedSlots = changedBindingSlots(before, after);
  const bindings = changedSlots.map((slot) => {
    const current = before.layers.find((layer) => layer.id === slot.layerId)?.bindings[slot.position];
    const proposed = after.layers.find((layer) => layer.id === slot.layerId)?.bindings[slot.position];
    const from = current === undefined ? { text: "No binding", complete: true } : bindingEffectDescription(current, before);
    const to = proposed === undefined ? { text: "No binding", complete: true } : bindingEffectDescription(proposed, after);
    if (!from.complete || !to.complete) incomplete.push(`The binding effect at ${physicalKeyName(board, slot.position)} on ${layerWords(before, slot.layerId)} is not fully established; preview and Apply are unavailable.`);
    return { slot, keyName: bindingKeyName(before, after, board, slot), current: from.text, proposed: to.text, complete: from.complete && to.complete };
  });
  if (ops.length > 0 && ops.every((op) => op.op === "dropFunction") && sections.length === 0 && profiles.length === 0 && bindings.length === 0) {
    incomplete.push("The proposal contains only function-preservation allowances and no visible source change; preview and Apply are unavailable.");
  }

  const summaryParts = [
    ...profiles.flatMap((profile) => profile.fields.map((changed) => `${profile.name} · ${changed.label}: ${changed.current} → ${changed.proposed}`)),
    ...triggers.map((set) => `${set.profileName} hold-trigger positions added ${set.added.map((n) => n + 1).join(", ") || "none"}; removed ${set.removed.map((n) => n + 1).join(", ") || "none"}`),
    ...sections.flatMap((section) => section.items.flatMap((item) => item.fields.map((changed) => `${item.name} · ${changed.label}: ${changed.current} → ${changed.proposed}`))),
    ...bindings.map(({ keyName, slot, current, proposed }) => `${keyName} on ${layerWords(before, slot.layerId)}: ${current} → ${proposed}`),
  ];
  return {
    summary: summaryParts.length ? summaryParts.join("; ") : "No visible source differences were found.",
    profiles, sections, changedSlots, bindings, callers, triggers,
    incomplete: [...new Set(incomplete)],
  };
}

function optionValue(key: string, value: HoldTapProfile["options"][string] | undefined): string {
  if (value === undefined) return "Not set";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number") return key.endsWith("-ms") || key.endsWith("_TERM") ? `${value} ms` : String(value);
  if (typeof value === "string") return key === "flavor" ? Object.entries(FLAVORS).find(([flavor]) => flavor === value)?.[1] ?? `Unrecognized value “${value}”` : `Text “${value}”`;
  return key === "hold-trigger-key-positions" ? `${value.length} trigger positions` : `Numbers: ${value.join(", ") || "none"}`;
}

function numberSet(value: HoldTapProfile["options"][string] | undefined): Set<number> {
  return Array.isArray(value) ? new Set(value) : new Set();
}

function profileCallers(layout: Layout, profileId: string, board: BoardDefinition): Slot[] {
  return layout.layers.flatMap((layer) => layer.bindings.flatMap((binding, position) => binding.kind === "holdTap" && binding.profileId === profileId && position < board.keyCount ? [{ layerId: layer.id, position }] : []));
}

function changedBindingSlots(before: Layout, after: Layout): Slot[] {
  return [...new Set([...before.layers, ...after.layers].map((layer) => layer.id))].flatMap((layerId) => {
    const oldLayer = before.layers.find((layer) => layer.id === layerId);
    const newLayer = after.layers.find((layer) => layer.id === layerId);
    return Array.from({ length: Math.max(oldLayer?.bindings.length ?? 0, newLayer?.bindings.length ?? 0) }, (_, position) =>
      deepEqual(oldLayer?.bindings[position], newLayer?.bindings[position]) ? undefined : { layerId, position });
  }).filter((slot) => slot !== undefined);
}

function layerWords(layout: Layout, id: string): string {
  return niceLayerName(layout.layers.find((layer) => layer.id === id)?.name ?? "Unknown layer");
}

function physicalKeyName(board: BoardDefinition, position: number): string {
  return position < board.keyCount ? board.physicalKeys?.[position] ?? `Key ${position + 1}` : `Unknown position ${position + 1}`;
}

function bindingKeyName(before: Layout, after: Layout, board: BoardDefinition, slot: Slot): string {
  if (slot.position >= board.keyCount) return physicalKeyName(board, slot.position);
  const index = before.layers.findIndex((layer) => layer.id === slot.layerId);
  if (index >= 0) return describeKey(before, index, slot.position)?.legend.tap || physicalKeyName(board, slot.position);
  const nextIndex = after.layers.findIndex((layer) => layer.id === slot.layerId);
  return nextIndex < 0 ? physicalKeyName(board, slot.position) : describeKey(after, nextIndex, slot.position)?.legend.tap || physicalKeyName(board, slot.position);
}

function lightingWords(lighting: Layer["lighting"], board: BoardDefinition): string {
  if (lighting === undefined) return "No per-key color override";
  const hsv = (value: readonly number[]) => `hue ${value[0]}, saturation ${value[1]}, brightness ${value[2]} (HSV)`;
  const values = [lighting.layer === undefined ? undefined : `All keys: ${hsv(lighting.layer)}`,
    ...Object.entries(lighting.keys ?? {}).sort(([a], [b]) => Number(a) - Number(b)).map(([position, value]) => `${physicalKeyName(board, Number(position))}: ${hsv(value)}`)].filter((value) => value !== undefined);
  return values.length ? values.join("; ") : "No per-key color override";
}

function conditionalLayerName(item: ConditionalLayer, layout: Layout): string {
  return `When ${item.ifLayerIds.map((id) => layerWords(layout, id)).join(" + ")} activate ${layerWords(layout, item.thenLayerId)}`;
}

function settingValue(setting: FirmwareSetting): string {
  return `${setting.firmware.toUpperCase()} · ${String(setting.value)}`;
}
