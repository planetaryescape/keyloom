import { z } from "zod";
import { type GridContext, bindingLabel, renderLayerGrid } from "../../layout/render-grid.ts";
import type { Layer } from "../../layout/schema.ts";
import type { AgentPorts, LayoutSnapshot } from "../ports.ts";
import { defineTool } from "./define.ts";

const InputSchema = z.object({
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

/** Position numbers beside labels, by the board's named rows, because a model counts badly in a 72-item array. */
function positionTable(snapshot: LayoutSnapshot, layer: Layer): string {
  const ctx = { layers: snapshot.document.layers, macros: snapshot.document.macros, tapDances: snapshot.document.tapDances };
  return Object.entries(snapshot.board.definition.rows)
    .map(([row, positions]) => `${row}: ${positions.map((p) => `${p}=${cell(layer, p, ctx)}`).join(" ")}`)
    .join("\n");
}

const cell = (layer: Layer, position: number, ctx: GridContext) => {
  const b = layer.bindings[position];
  return b ? bindingLabel(b, ctx) : "?";
};

/** Each hold-tap profile with its options and the keys that use it, because tuning a key's feel means editing its profile (D-017). */
function profilesText({ holdTapProfiles, layers, settings }: LayoutSnapshot["document"]): string {
  if (holdTapProfiles.length === 0) return "Hold-tap profiles: none.";
  const users = new Map<string, string[]>();
  for (const layer of layers) {
    for (const [position, b] of layer.bindings.entries()) {
      if (b.kind === "holdTap") users.set(b.profileId, [...(users.get(b.profileId) ?? []), `key ${position + 1} on ${layer.name}`]);
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
      "Read the layout's current head revision: for each requested layer, a text grid shaped like the keyboard, a position-to-key table, and the layer's JSON. Call it before proposing anything, and again after BK applies a change.",
    inputSchema: InputSchema,
    run: ({ layers }) => {
      const snapshot = ports.snapshot();
      const ctx = { layers: snapshot.document.layers, macros: snapshot.document.macros, tapDances: snapshot.document.tapDances };
      const chosen = pickLayers(snapshot, layers);
      const sections = chosen.map((layer) => {
        const index = snapshot.document.layers.indexOf(layer);
        const grid = renderLayerGrid(snapshot.board.geometry.keys, layer, ctx).join("\n");
        return [
          `## Layer ${index}: ${layer.name} (id: ${layer.id})`,
          grid,
          "Positions:",
          positionTable(snapshot, layer),
          "JSON:",
          JSON.stringify(layer),
        ].join("\n");
      });
      const macros = snapshot.document.macros.map((m) => `${m.id}: ${m.name}`).join("; ") || "none";
      return [
        `Layout ${snapshot.layoutName} (${snapshot.layoutId}), head revision ${snapshot.revisionId}, board ${snapshot.board.definition.id}.`,
        `Macros: ${macros}.`,
        profilesText(snapshot.document),
        "Legend: ⌥ Option/Alt, ⌘ Command/GUI, ⌃ Ctrl, ⇧ Shift; an r prefix means the right-hand modifier; a/b means tap a, hold b; ▽ transparent; MO/TO/TG layer keys.",
        ...sections,
      ].join("\n\n");
    },
  });
