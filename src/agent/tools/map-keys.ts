import { keyName } from "../../boards/key-names.ts";
import { z } from "zod";
import { boardCapabilities } from "../../boards/capabilities.ts";
import type { KeyMapping, UnmatchedWhy } from "../../boards/correspondence.ts";
import { holdKeyCandidates } from "../../boards/placement.ts";
import { bindingLabel } from "../../layout/render-grid.ts";
import type { Layer } from "../../layout/schema.ts";
import {
  DEFAULT_MIN_CONFIDENCE, findLayer, layerMatchFor, mapLayer, planBehaviourCopy, planComboCopy, planLightingCopy,
} from "../copy-plan.ts";
import type { AgentPorts, LayoutSnapshot } from "../ports.ts";
import { defineTool } from "./define.ts";
import { validationForModel } from "./validation-text.ts";

const InputSchema = z.object({
  from: z.string().min(1).describe("The other layout to copy from: its id or name, from list_layouts."),
  fromLayer: z.string().min(1).optional().describe("Layer of that layout (id, name or index). Omit to use the layer that matches `toLayer`, or the base layer."),
  toLayer: z.string().min(1).optional().describe("Layer of this conversation's layout (id, name or index). Omit to use the layer that matches `fromLayer`, or the base layer."),
  strategy: z.enum(["auto", "function", "position"]).default("auto").describe('"function": the key that does the same thing (types A, holds Command). "position": the key in the same place for the same finger. "auto": function first, then position for what is left.'),
  positions: z.array(z.number().int().nonnegative()).max(200).optional().describe("Positions on the OTHER layout to include, as in get_layout of that layout. Omit for every key; required for carry=behaviours."),
  carry: z.enum(["none", "behaviours", "lighting", "combos"]).default("none").describe('"none": only show the mapping. "behaviours": ops that give the matching keys of this layout the chosen keys\' behaviour (hold-taps, tap dances, macros, layer keys), each key keeping its own letter. "lighting": setLayerLighting ops copying the LED colours (every layer with colours, unless `fromLayer` is given). "combos": upsertCombo ops for `comboIds`.'),
  comboIds: z.array(z.string().min(1)).max(50).optional().describe("For carry=combos: the combo ids on the other layout."),
  minConfidence: z.number().min(0).max(1).default(DEFAULT_MIN_CONFIDENCE).describe("Matches below this are listed but not carried."),
});

const WHY: Record<UnmatchedWhy, string> = {
  "no-key-does-this": "no key on the target does this",
  "no-place-on-target": "the target has no key in this place",
  "target-keys-taken": "every candidate key on the target fits another key better",
  "has-no-place": "the other board's file gives this key no hand or finger",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

// "S hold ⌥ (left ring, home row) at position 30": the name is what the agent says to BK, the position is for ops (D-279).
function describeKey(s: LayoutSnapshot, layer: Layer, position: number): string {
  return `${keyName(s.board.definition, s.document, { layerId: layer.id, position }, { geometry: s.board.geometry, withLayer: false })} at position ${position}`;
}

function mappingText(from: LayoutSnapshot, to: LayoutSnapshot, mapping: KeyMapping, only: ReadonlySet<number> | null): string[] {
  const sLayer = findLayer(from.document, mapping.sourceLayerId);
  const tLayer = findLayer(to.document, mapping.targetLayerId);
  const shown = (p: number) => only === null || only.has(p);
  const lines = mapping.mapped.filter((m) => shown(m.source)).map((m) => {
    const [best, ...rest] = m.matches;
    if (best === undefined) return "";
    const extra = rest.map((x) => `also ${describeKey(to, tLayer, x.target)}`).join("; ");
    return `- ${describeKey(from, sLayer, m.source)} -> ${describeKey(to, tLayer, best.target)}: ${best.method}, ${pct(best.confidence)}, ${best.reason}${extra ? `. ${extra}` : ""}`;
  });
  const unmatched = mapping.unmatchedSource.filter((u) => shown(u.position));
  // Empty keys (transparent, none) are not worth a line each.
  const worth = unmatched.filter((u) => !["transparent", "none"].includes(sLayer.bindings[u.position]?.kind ?? ""));
  const empty = unmatched.length - worth.length;
  // A layer or hold key with no counterpart is not forced onto another key; boards that list hold-key candidates get them offered.
  const takenTargets = new Set(mapping.mapped.flatMap((m) => m.matches.filter((x) => !x.extra).map((x) => x.target)));
  const candidates = holdKeyCandidates(to.board.definition, takenTargets);
  const holds = worth.filter((u) => {
    const b = sLayer.bindings[u.position];
    return b !== undefined && (b.kind === "layer" || (b.kind === "holdTap" && "layerId" in b.hold));
  });
  const proposals =
    candidates.length === 0 || holds.length === 0
      ? []
      : [
          `${to.layoutName} has fewer thumb keys, so these layer keys have no key of their own. They could go on one of these keys, which would keep its own tap and add the hold (best first): ${candidates.map((c) => `${describeKey(to, tLayer, c.target)}${c.taken ? " (also takes a matched key)" : ""}`).join("; ")}.`,
          ...holds.map((u) => `- ${describeKey(from, sLayer, u.position)}: pick one of the keys above. Ask BK which, and suggest the first by default.`),
        ];
  return [
    ...lines.filter(Boolean),
    ...proposals,
    ...(worth.length ? ["No counterpart (not forced onto another key):", ...worth.map((u) => `- ${describeKey(from, sLayer, u.position)}: ${WHY[u.why]}`)] : []),
    ...(empty ? [`${empty} empty key${empty === 1 ? "" : "s"} (transparent or none) found no counterpart.`] : []),
    ...(only === null && mapping.unmatchedTarget.length ? [`Keys on ${to.layoutName} that nothing maps to (positions, for ops): ${mapping.unmatchedTarget.join(", ")}.`] : []),
  ];
}

export const mapKeysTool = (ports: AgentPorts) =>
  defineTool({
    name: "map_keys",
    description:
      'Work out which key of another layout is "the same key" on this one, even when the boards have different numbers of keys or different shapes, and optionally build the ops that copy something across. It matches layers (by name, role and what they do), then keys (by function, or by hand, finger, row and column), and reports each match with a reason and a confidence, and the keys that have no counterpart. With carry=lighting it builds the LED colour ops (or says plainly that this board cannot show per-key colours); with carry=behaviours it moves hold-taps, tap dances, macros and layer keys across, converting modifiers to the hand they land on and choosing a hold-tap profile that fits; with carry=combos it copies combos. Ops come back checked against this layout. Use it instead of matching keys yourself, and tell BK in plain words which mapping you used. Ask him only where a match is weak or several keys fit equally well.',
    inputSchema: InputSchema,
    run: ({ from, fromLayer, toLayer, strategy, positions, carry, comboIds, minConfidence }) => {
      const to = ports.snapshot();
      const source = from === to.layoutId || from === to.layoutName ? to : ports.layout(from);
      if (source.layoutId === to.layoutId) throw new Error("that is this conversation's own layout; name another layout from list_layouts");
      const layers = layerMatchFor(source, to);
      const layerLines = layers.map((m) => {
        const sName = findLayer(source.document, m.sourceLayerId).name;
        return m.targetLayerId === null
          ? `- ${sName}: no layer of ${to.layoutName} does the same job (best overlap ${pct(m.signals.overlap)})`
          : `- ${sName} <-> ${findLayer(to.document, m.targetLayerId).name}: ${m.method}, ${pct(m.score)}`;
      });
      const header = [
        `From ${source.layoutName} (${source.board.definition.name}, ${source.board.definition.keyCount} keys) to ${to.layoutName} (${to.board.definition.name}, ${to.board.definition.keyCount} keys). Strategy: ${strategy}.`,
        "Layer matches:",
        ...layerLines,
      ];

      if (carry === "lighting") {
        const lit = fromLayer === undefined ? null : [findLayer(source.document, fromLayer).id];
        if (!boardCapabilities(to.board.definition).lighting.supported) {
          const reason = boardCapabilities(to.board.definition).lighting.because;
          return [...header, "", `${to.board.definition.name} can't show per-key colours because ${reason}. Nothing to propose: tell BK this plainly, and do not offer to set colours on it.`].join("\n");
        }
        const plan = planLightingCopy(source, to, layers, strategy, lit, minConfidence);
        if (plan.layers.length === 0) return [...header, "", `${source.layoutName} has no LED colours${lit ? " on that layer" : ""}, so there is nothing to copy.`].join("\n");
        const lines = plan.layers.map((l) =>
          l.target === null
            ? `- ${l.why}. Not copied: ask BK which layer should take them, or skip.`
            : `- ${findLayer(source.document, l.source).name} -> ${findLayer(to.document, l.target).name}: colours of ${l.carried} keys copied${l.lost.length ? `; ${l.lost.length} coloured keys (${l.lost.map((p) => p + 1).join(", ")}) have no counterpart, so their colour is lost` : ""}. This replaces that layer's existing colours as a whole.`,
        );
        return [...header, "", "Lighting:", ...lines, "", "Ops (setLayerLighting replaces a layer's colours as a whole; keys nothing maps to keep the layer colour):", JSON.stringify(plan.ops), "", plan.ops.length ? `Validation of these ops: ${validationForModel(ports.check(plan.ops))}` : "No ops."].join("\n");
      }

      const sLayer = fromLayer === undefined ? undefined : findLayer(source.document, fromLayer);
      const tLayerExplicit = toLayer === undefined ? undefined : findLayer(to.document, toLayer);
      // Whichever layer was named picks its partner by the layer match; with neither, the base layers.
      const matchFor = (id: string) => layers.find((m) => m.sourceLayerId === id)?.targetLayerId ?? null;
      const sourceLayer = sLayer ?? (tLayerExplicit ? source.document.layers.find((l) => matchFor(l.id) === tLayerExplicit.id) : undefined) ?? (source.document.layers[0] as Layer);
      const targetLayer = tLayerExplicit ?? (matchFor(sourceLayer.id) === null ? undefined : findLayer(to.document, matchFor(sourceLayer.id) as string));
      if (targetLayer === undefined) {
        return [...header, "", `${sourceLayer.name} has no matching layer on ${to.layoutName}. Pick the layer to copy onto with toLayer, or ask BK which layer should take it.`].join("\n");
      }
      const mapping = mapLayer(source, to, sourceLayer.id, targetLayer.id, strategy, layers);
      const only = positions === undefined ? null : new Set(positions);
      const body = [...header, "", `Key matches, ${sourceLayer.name} -> ${targetLayer.name} (each line: source key by legend and place, target key, method, confidence, reason; the positions are for ops, the names are what you say to BK):`, ...mappingText(source, to, mapping, only)];

      if (carry === "none") return body.join("\n");

      if (carry === "behaviours") {
        if (positions === undefined || positions.length === 0) {
          throw new Error(`carry=behaviours needs \`positions\`: the keys on ${source.layoutName} to copy (positions as in get_layout of that layout). Read it first and pick them; copying every key would overwrite things BK did not mean.`);
        }
        const plan = planBehaviourCopy(source, to, mapping, positions, layers, minConfidence);
        // The labels name macros and tap dances the ops are about to add, so they must be known here too.
        const ctx = {
          layers: to.document.layers,
          macros: [...to.document.macros, ...plan.ops.flatMap((o) => (o.op === "upsertMacro" ? [o.macro] : []))],
          tapDances: [...to.document.tapDances, ...plan.ops.flatMap((o) => (o.op === "upsertTapDance" ? [o.tapDance] : []))],
        };
        const lines = plan.steps.map((s) => {
          const from = describeKey(source, sourceLayer, s.source);
          const to_ = s.target === null ? "no target" : describeKey(to, targetLayer, s.target);
          if ("binding" in s.outcome) return `- ${from} -> ${to_}: becomes ${bindingLabel(s.outcome.binding, ctx)} (${s.confidence === null ? "" : pct(s.confidence)})`;
          if ("unchanged" in s.outcome) return `- ${from} -> ${to_}: already the same, no op`;
          return `- ${from} -> ${to_}: not copied, ${s.outcome.skip}`;
        });
        const check = plan.ops.length === 0 ? "No ops: nothing to change." : `Validation of these ops: ${validationForModel(ports.check(plan.ops))}`;
        const translated = plan.notes.length === 0 ? [] : ["Hold-tap settings that kanata has no equivalent for (tell BK; nothing was dropped silently):", ...plan.notes.map((n) => `- ${n}`), ""];
        return [...body, "", "Copying behaviours:", ...lines, "", ...translated, "Ops (profiles, macros and tap dances first):", JSON.stringify(plan.ops), "", check].join("\n");
      }

      const ids = comboIds ?? source.document.combos.map((c) => c.id);
      if (ids.length === 0) return [...body, "", `${source.layoutName} has no combos.`].join("\n");
      const plan = planComboCopy(source, to, mapping, ids, layers, minConfidence);
      const lines = plan.steps.map((s) => ("copied" in s.outcome ? `- ${s.comboId}: copied as ${s.outcome.copied}` : `- ${s.comboId}: not copied, ${s.outcome.skip}`));
      const check = plan.ops.length === 0 ? "No ops: nothing to change." : `Validation of these ops: ${validationForModel(ports.check(plan.ops))}`;
      return [...body, "", "Copying combos:", ...lines, "", "Ops:", JSON.stringify(plan.ops), "", check].join("\n");
    },
  });
