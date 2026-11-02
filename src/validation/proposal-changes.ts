import type { BoardDefinition } from "../boards/schema.ts";
import { applyOps } from "../layout/apply-ops.ts";
import { behaviorDescription } from "../layout/behavior-facts.ts";
import { deepEqual } from "../layout/equal.ts";
import type { ChangeOp, Slot } from "../layout/change.ts";
import { optionLabel } from "../layout/option-words.ts";
import type { HoldTapProfile, Layout } from "../layout/schema.ts";

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
  currentValues?: readonly number[];
  proposedValues?: readonly number[];
};

export type ChangedProfile = { id: string; name: string; fields: readonly ChangedField[] };
export type ProposalChanges = {
  summary: string;
  profiles: readonly ChangedProfile[];
  changedSlots: readonly Slot[];
  bindings: readonly { slot: Slot; current: string; proposed: string }[];
  callers: readonly { profileName: string; phase: "current" | "proposed"; layerId: string; layerName: string; slots: readonly Slot[] }[];
  triggers: readonly { profileName: string; added: readonly number[]; removed: readonly number[] }[];
  otherChanges: readonly string[];
};

/** A pure, source-derived comparison. Unknown option values retain their actual typed values for expanded UI and CLI display. */
export function proposalChanges(before: Layout, ops: readonly ChangeOp[], board: BoardDefinition): ProposalChanges {
  const applied = applyOps(before, ops);
  if (!applied.ok) throw new Error("Cannot describe an invalid automatic proposal");
  const after = applied.layout;
  const profileIds = [...new Set([...before.holdTapProfiles, ...after.holdTapProfiles].map((profile) => profile.id))].sort();
  const profiles: ChangedProfile[] = [];
  const callers: ProposalChanges["callers"][number][] = [];
  const triggers: ProposalChanges["triggers"][number][] = [];

  for (const id of profileIds) {
    const current = before.holdTapProfiles.find((profile) => profile.id === id);
    const proposed = after.holdTapProfiles.find((profile) => profile.id === id);
    if (deepEqual(current, proposed)) continue;
    const profileName = proposed?.name ?? current?.name ?? "Unnamed tap/hold profile";
    const fields: ChangedField[] = [];
    for (const key of [...new Set([...Object.keys(current?.options ?? {}), ...Object.keys(proposed?.options ?? {})])].sort()) {
      const from = current?.options[key];
      const to = proposed?.options[key];
      if (deepEqual(from, to)) continue;
      const known = PROFILE_OPTIONS.has(key);
      const isTriggerSet = key === "hold-trigger-key-positions";
      const field: ChangedField = {
        key,
        label: known ? optionLabel(key) : `Unrecognized option “${key}”`,
        current: optionValue(key, from),
        proposed: optionValue(key, to),
        recognized: known,
      };
      if (Array.isArray(from)) field.currentValues = from;
      if (Array.isArray(to)) field.proposedValues = to;
      fields.push(field);
      if (isTriggerSet) {
        const oldPositions = numberSet(from);
        const nextPositions = numberSet(to);
        triggers.push({ profileName, added: [...nextPositions].filter((position) => !oldPositions.has(position)).sort((a, b) => a - b), removed: [...oldPositions].filter((position) => !nextPositions.has(position)).sort((a, b) => a - b) });
      }
    }
    profiles.push({ id, name: profileName, fields });
    const callerSlots = profileCallers(before, id, board);
    const afterCallers = profileCallers(after, id, board);
    for (const [phase, slots] of [["current", callerSlots], ["proposed", afterCallers]] as const) {
      const grouped = new Map<string, Slot[]>();
      for (const slot of slots) {
        const layer = before.layers.find((candidate) => candidate.id === slot.layerId) ?? after.layers.find((candidate) => candidate.id === slot.layerId);
        if (layer === undefined) continue;
        const group = grouped.get(layer.id) ?? [];
        if (!group.some((candidate) => candidate.position === slot.position)) group.push(slot);
        grouped.set(layer.id, group);
      }
      for (const [layerId, layerSlots] of grouped) {
        const layer = after.layers.find((candidate) => candidate.id === layerId) ?? before.layers.find((candidate) => candidate.id === layerId);
        if (layer) callers.push({ profileName, phase, layerId, layerName: layer.name, slots: layerSlots.sort((a, b) => a.position - b.position) });
      }
    }
  }

  const changedSlots = changedBindingSlots(before, after);
  const bindings = changedSlots.map((slot) => ({
    slot,
    current: behaviorDescription(before, before.layers.find((layer) => layer.id === slot.layerId)?.bindings[slot.position]),
    proposed: behaviorDescription(after, after.layers.find((layer) => layer.id === slot.layerId)?.bindings[slot.position]),
  }));
  const layerChanges = [...new Set([...before.layers, ...after.layers].map((layer) => layer.id))].flatMap((id) => {
    const oldLayer = before.layers.find((layer) => layer.id === id);
    const newLayer = after.layers.find((layer) => layer.id === id);
    if (oldLayer === undefined) return newLayer === undefined ? [] : [`layer ${newLayer.name} added`];
    if (newLayer === undefined) return [`layer ${oldLayer.name} removed`];
    return [];
  });
  const comboChanged = !deepEqual(before.combos, after.combos);
  const otherChanges = [
    ...profiles.filter((profile) => !before.holdTapProfiles.some((candidate) => candidate.id === profile.id)).map((profile) => `Tap/hold profile ${profile.name} added`),
    ...profiles.filter((profile) => !after.holdTapProfiles.some((candidate) => candidate.id === profile.id)).map((profile) => `Tap/hold profile ${profile.name} removed`),
    ...(["macros", "tapDances", "conditionalLayers", "settings", "passthrough"] as const)
      .filter((key) => !deepEqual(before[key], after[key]))
      .map((key) => key === "tapDances" ? "Tap dances" : key === "conditionalLayers" ? "Conditional layers" : key === "passthrough" ? "Firmware source" : key === "settings" ? "Firmware settings" : "Macros"),
  ];
  const summaryParts = [
    ...layerChanges,
    ...profiles.flatMap((profile) => profile.fields.map((field) => `${profile.name}: ${field.label}, ${field.current} to ${field.proposed}`)),
    ...triggers.map((set) => `${set.profileName} hold-trigger positions added ${set.added.map((n) => n + 1).join(", ") || "none"}; removed ${set.removed.map((n) => n + 1).join(", ") || "none"}`),
    ...bindings.map(({ slot, current, proposed }) => `{key:${slot.layerId}:${slot.position}}: ${current} → ${proposed}`),
    ...(comboChanged ? ["combos changed"] : []),
    ...otherChanges.map((change) => `${change.toLowerCase()} changed`),
  ];
  return { summary: summaryParts.length ? summaryParts.join("; ") : "No visible source differences were found.", profiles, changedSlots, bindings, callers, triggers, otherChanges };
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
