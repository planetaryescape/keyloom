import { z } from "zod";
import { capabilityLine } from "../../boards/capabilities.ts";
import { keyName, keyPlace } from "../../boards/key-names.ts";
import { conditionalLayerName } from "../../layout/conditional-layers.ts";
import { type GridContext, bindingLabel, renderLayerGrid } from "../../layout/render-grid.ts";
import type { Layer } from "../../layout/schema.ts";
import type { AgentPorts, LayoutSnapshot } from "../ports.ts";
import { defineTool } from "./define.ts";

const InputSchema = z.object({
  layout: z.string().min(1).optional().describe("Another layout's id or name from list_layouts, to read it. Omit for this conversation's layout. Read-only: you cannot propose changes to another layout."),
  layers: z.array(z.string()).optional().describe("Layer ids, names or indexes. Omit for every layer."),
});

function pickLayers(snapshot: LayoutSnapshot, wanted: string[] | undefined): Layer[] {
  const { layers } = snapshot.document;
  if (!wanted?.length) return layers;
  return wanted.map((w) => {
    const hit = layers.find((l, i) => l.id === w || l.name === w || String(i) === w);
    if (!hit) throw new Error(`no layer "${w}"; layers are: ${layers.map((l) => l.id).join(", ")}`);
    return hit;
  });
}

/**
 * Position numbers beside labels, by the board's named rows, because a model counts badly in a 72-item array. Each key also gets its
 * place under the hand, which is how the agent names it to BK; the number is only for ops (D-279).
 */
function positionTable(snapshot: LayoutSnapshot, layer: Layer): string {
  const ctx = { layers: snapshot.document.layers, macros: snapshot.document.macros, tapDances: snapshot.document.tapDances };
  return Object.entries(snapshot.board.definition.rows)
    .map(([row, positions]) => `${row}: ${positions.map((p) => `${p}=${cell(layer, p, ctx)} (${keyPlace(snapshot.board.definition, p, snapshot.board.geometry)})`).join("; ")}`)
    .join("\n");
}

const cell = (layer: Layer, position: number, ctx: GridContext) => {
  const b = layer.bindings[position];
  return b ? bindingLabel(b, ctx) : "?";
};

/** Each condition by id and by the layers' names, so the agent can change or remove it (D-389). */
function conditionalLayersText(document: LayoutSnapshot["document"]): string {
  if (document.conditionalLayers.length === 0) return "Conditional layers: none.";
  return ["Conditional layers (id: when both layers are on, also turn on):", ...document.conditionalLayers.map((c) => `- ${c.id}: ${conditionalLayerName(document, c)} (layer ids ${c.ifLayerIds.join(" + ")} gives ${c.thenLayerId})`)].join("\n");
}

/** Each hold-tap profile with its options and the keys that use it, because tuning a key's feel means editing its profile (D-017). */
function profilesText(document: LayoutSnapshot["document"], board: LayoutSnapshot["board"]): string {
  const { holdTapProfiles, layers, settings } = document;
  if (holdTapProfiles.length === 0) return "Hold-tap profiles: none.";
  const users = new Map<string, string[]>();
  for (const layer of layers) {
    for (const [position, b] of layer.bindings.entries()) {
      if (b.kind === "holdTap") users.set(b.profileId, [...(users.get(b.profileId) ?? []), keyName(board.definition, document, { layerId: layer.id, position }, { geometry: board.geometry })]);
    }
  }
  const lines = holdTapProfiles.map((p) => {
    const keys = users.get(p.id) ?? [];
    const shown = keys.length > 6 ? `${keys.slice(0, 6).join(", ")} and ${keys.length - 6} more` : keys.join(", ") || "no keys";
    return `- ${p.id} ("${p.name}"): ${JSON.stringify(p.options)}; used by ${keys.length} (${shown})`;
  });
  const feel = settings.filter((s) => /TAPPING|HOLD|FLOW|RETRO|TAP_TERM/.test(s.key)).map((s) => `${s.key}=${String(s.value)}`);
  return ["Hold-tap profiles (id, options, keys using it):", ...lines, ...(feel.length ? [`Layout-wide tap-hold settings: ${feel.join(", ")}.`] : [])].join("\n");
}

export const getLayoutTool = (ports: AgentPorts) =>
  defineTool({
    name: "get_layout",
    description:
      "Read a layout's current head revision: for each requested layer, a text grid shaped like the keyboard, a position-to-key table, and the layer's JSON. Includes on-screen layer styling (setLayerStyle) separately from hardware LED capabilities (setLayerLighting). Call it before proposing anything, and again after BK applies a change. Pass `layout` to look at another of BK's keyboards (see list_layouts), for example to copy something from it; that view is read-only.",
    inputSchema: InputSchema,
    run: ({ layout, layers }) => {
      const here = ports.snapshot();
      const snapshot = layout === undefined || layout === here.layoutId || layout === here.layoutName ? here : ports.layout(layout);
      const other = snapshot.layoutId !== here.layoutId;
      const ctx = { layers: snapshot.document.layers, macros: snapshot.document.macros, tapDances: snapshot.document.tapDances };
      const chosen = pickLayers(snapshot, layers);
      const sections = chosen.map((layer) => {
        const index = snapshot.document.layers.indexOf(layer);
        const grid = renderLayerGrid(snapshot.board.geometry.keys, layer, ctx).join("\n");
        return [
          `## Layer ${index}: ${layer.name} (id: ${layer.id})`,
          grid,
          "Positions (for ops only; to BK, name a key by its legend and place, as in brackets, never by number):",
          positionTable(snapshot, layer),
          "JSON:",
          JSON.stringify(layer),
        ].join("\n");
      });
      const macros = snapshot.document.macros.map((m) => `${m.id}: ${m.name}`).join("; ") || "none";
      return [
        `Layout ${snapshot.layoutName} (${snapshot.layoutId}), head revision ${snapshot.revisionId}, board ${snapshot.board.definition.id}.`,
        ...(other ? [`READ-ONLY: this is another of BK's layouts, not the one you are working on (${here.layoutName}). Positions below are positions on ${snapshot.board.definition.name}; do not use them in ops for ${here.layoutName}. Use map_keys to translate.`] : []),
        "On-screen layer styling: every board supports setLayerStyle for keyloom's layer colours, not keyboard LEDs. color is a palette index from 1 to 6 (null restores the default). The op also sets shortLabel: preserve the layer's current shortLabel, or use null when absent, if only changing colour. Hardware LED colours use setLayerLighting and are subject to the board capabilities below.",
        capabilityLine(snapshot.board.definition),
        `Macros: ${macros}.`,
        conditionalLayersText(snapshot.document),
        profilesText(snapshot.document, snapshot.board),
        "Legend: ⌥ Option/Alt, ⌘ Command/GUI, ⌃ Ctrl, ⇧ Shift; an r prefix means the right-hand modifier; a/b means tap a, hold b; ▽ transparent; MO/TO/TG layer keys.",
        ...sections,
      ].join("\n\n");
    },
  });
