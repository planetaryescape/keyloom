// Plain-language facts about a proposal, read from the head layout: which keys it touches and
// whether it would overwrite a native binding (D-024), which keyloom can show but not rebuild.
import type { ProposalCard } from "../../api/http.ts";
import type { Slot } from "../../layout/change.ts";
import { layerDisplayName } from "../../layout/cap-words.ts";
import { describeKey } from "../../layout/describe.ts";
import { keyIn } from "../../validation/words.ts";
import { legendWords } from "../../boards/key-names.ts";
import { bindingLegend } from "../../layout/legend.ts";
import type { Binding, Layout } from "../../layout/schema.ts";
import type { BoardDefinition } from "../../boards/schema.ts";
import { effectiveSensors } from "../../boards/sensors.ts";
import { deepEqual } from "../../layout/equal.ts";
import { keyCodeLabel } from "../../layout/keycodes.ts";

export const slotKey = (slot: Slot): string => `${slot.layerId}:${slot.position}`;

export function layerName(layout: Layout, layerId: string): string {
  // As the caption says it: a ZMK layer named default_layer reads "Default layer" (D-270).
  return layerDisplayName(layout.layers.find((layer) => layer.id === layerId)?.name ?? layerId);
}

/** "the ⌫ key on Layer 0": a key by what it prints, never its number (D-279); the board shows which one. */
export function slotName(layout: Layout, slot: Slot): string {
  return keyIn(layout, slot);
}

/** What a key prints, for chips: "S", "Esc", or "empty". */
export function keyLabel(layout: Layout, slot: Slot): string {
  const layerIndex = layout.layers.findIndex((layer) => layer.id === slot.layerId);
  if (layerIndex < 0) return "?";
  const tap = describeKey(layout, layerIndex, slot.position)?.legend.tap ?? "";
  return tap === "" ? "empty" : tap;
}

/**
 * A changed key as one chip in legend glyphs (P3 review): "S hold ⌥ → plain S", "⌃← hold → ⌥", "⌫ → Nav once". The key is named by
 * what it printed; the board shows which one.
 */
export function changeWords(before: Layout, after: Layout, slot: Slot, board?: BoardDefinition): { from: string; to: string } | null {
  const wasLayer = before.layers.find((l) => l.id === slot.layerId);
  const nowLayer = after.layers.find((l) => l.id === slot.layerId);
  const sensorIndex = board?.sensorPositions?.indexOf(slot.position) ?? -1;
  if (board && wasLayer && nowLayer && sensorIndex >= 0 && !deepEqual(effectiveSensors(board, wasLayer)[sensorIndex], effectiveSensors(board, nowLayer)[sensorIndex])) {
    const sensor = effectiveSensors(board, nowLayer)[sensorIndex];
    const words = (b: Binding) => b.kind === "native" ? b.label : b.kind === "key" ? keyCodeLabel(b.code) : "nothing";
    const pressChanged = !deepEqual(wasLayer.bindings[slot.position], nowLayer.bindings[slot.position]);
    const press = pressChanged && nowLayer.bindings[slot.position] ? `press: ${words(nowLayer.bindings[slot.position]!)}, ` : "";
    return { from: `Encoder · ${layerName(after, slot.layerId)}`, to: `${press}${sensor?.kind === "rotation" ? `↻ ${words(sensor.clockwise)}, ↺ ${words(sensor.counterclockwise)}` : "custom turns"}` };
  }
  const legendAt = (layout: Layout) => {
    const binding = layout.layers.find((layer) => layer.id === slot.layerId)?.bindings[slot.position];
    return binding === undefined ? null : bindingLegend(binding, { layers: layout.layers, macros: layout.macros, tapDances: layout.tapDances });
  };
  const a = legendAt(before);
  const b = legendAt(after);
  if (a === null || b === null) return null;
  const was = legendWords(a);
  const now = legendWords(b);
  if (was === now) return null;
  // Same tap, different hold: say what the hold becomes, or that the key is plain now.
  if (a.tap !== "" && a.tap === b.tap) {
    if (b.hold === undefined) return { from: was, to: `plain ${b.tap}` };
    return { from: `${a.tap} hold`, to: b.hold };
  }
  return { from: was === "blank" ? "blank key" : was, to: now === "blank" ? "nothing" : now };
}

export type ReplacedNative = { slot: Slot; binding: Extract<Binding, { kind: "native" }> };

/**
 * The native bindings a proposal's changed keys would overwrite. One the validator reports as moved
 * to another key keeps its firmware code (the binding travels whole), so only a native left with
 * no new home needs the "can't write it back" confirmation.
 */
export function replacedNatives(layout: Layout, proposal: ProposalCard): ReplacedNative[] {
  const moved = new Set(
    proposal.validation.diff.displaced.filter((d) => d.to !== null).map((d) => `${d.function}@${d.from.layerId}:${d.from.position}`),
  );
  return proposal.validation.diff.changed.flatMap((slot) => {
    const binding = layout.layers.find((layer) => layer.id === slot.layerId)?.bindings[slot.position];
    if (binding?.kind !== "native") return [];
    return moved.has(`native:${binding.firmware}:${binding.source}@${slot.layerId}:${slot.position}`) ? [] : [{ slot, binding }];
  });
}

/** A title cut to fit a tab: whole words only, never mid-word, with no ellipsis when nothing was cut (P3 review). */
export function shortTitle(title: string, max = 24): string {
  const words = title.trim().split(/\s+/);
  let out = "";
  for (const word of words) {
    const next = out === "" ? word : `${out} ${word}`;
    if (next.length > max && out !== "") return `${out.replace(/[,;:–-]+$/, "")}…`;
    out = next;
  }
  return out;
}

/**
 * Tab labels for a set of options that tell them apart: words every title starts with are dropped first ("Plain Option on the left
 * thumb" and "Plain Option on the right thumb" are "Left thumb" and "Right thumb"), then each is cut to whole words.
 */
export function optionLabels(titles: readonly string[], max = 22): string[] {
  const split = titles.map((title) => title.trim().split(/\s+/));
  let common = 0;
  while (split.length > 1 && split.every((words) => words.length > common + 1 && words[common]?.toLowerCase() === split[0]?.[common]?.toLowerCase())) common += 1;
  return split.map((words) => {
    const rest = words.slice(common).join(" ");
    return shortTitle(rest.charAt(0).toUpperCase() + rest.slice(1), max);
  });
}

/**
 * The first sentence of an explanation and the rest, so a card can say what changes in a line and keep the
 * reasoning one tap away. No sentence end means the whole text is the lead.
 */
export function leadSentence(text: string): { lead: string; rest: string } {
  const trimmed = text.trim();
  const match = /^(.+?[.!?])(?:\s+([\s\S]*))?$/.exec(trimmed);
  return match === null ? { lead: trimmed, rest: "" } : { lead: match[1] ?? trimmed, rest: (match[2] ?? "").trim() };
}
