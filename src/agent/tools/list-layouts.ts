import { z } from "zod";
import { capabilityLine } from "../../boards/capabilities.ts";
import type { AgentPorts, LayoutSnapshot } from "../ports.ts";
import { defineTool } from "./define.ts";

/** One layout as the agent reads it in a list: enough to choose which to open, and what its board can and cannot do. */
export function layoutSummary(s: LayoutSnapshot, current: boolean): string {
  const d = s.board.definition;
  const layers = s.document.layers.map((l, i) => `${i} "${l.name}" (id ${l.id})`).join(", ");
  const coloured = s.document.layers.filter((l) => l.lighting !== undefined).map((l) => l.name);
  return [
    `- ${s.layoutId} "${s.layoutName}"${current ? " (THIS conversation's layout: the only one you can propose changes to)" : " (another of BK's layouts: read-only)"}${s.onKeyboard ? ` (the config on BK's ${d.name}: the one the keyboard runs)` : s.archived ? " (archived config)" : ` (a config for the ${d.name} that is not on the keyboard)`}`,
    `  Board: ${d.vendor} ${d.name} (${d.id}), ${d.firmware.toUpperCase()}, ${d.keyCount} keys.`,
    `  Layers (${s.document.layers.length}): ${layers}.`,
    `  ${capabilityLine(d)}${coloured.length ? ` Has LED colours on: ${coloured.join(", ")}.` : ""}`,
    `  ${s.document.macros.length} macros, ${s.document.tapDances.length} tap dances, ${s.document.combos.length} combos, ${s.document.holdTapProfiles.length} hold-tap profiles.`,
  ].join("\n");
}

export const listLayoutsTool = (ports: AgentPorts) =>
  defineTool({
    name: "list_layouts",
    description:
      "List every layout (config) keyloom holds: id, name, board, firmware, layers, and which config is on each keyboard, and what the board can and cannot do (per-key colours, combos, tap dance and so on). Call it first when BK mentions another keyboard (\"my Moonlander\", \"my other board\"): look at it yourself with get_layout and map_keys instead of asking him for links, screenshots or a description. Read-only; proposals can only target this conversation's layout.",
    inputSchema: z.object({}),
    run: () => {
      const here = ports.snapshot().layoutId;
      const all = ports.layouts();
      const lines = all.sort((a, b) => Number(b.layoutId === here) - Number(a.layoutId === here) || a.layoutName.localeCompare(b.layoutName)).map((s) => layoutSummary(s, s.layoutId === here));
      return [`${all.length} layout${all.length === 1 ? "" : "s"}:`, ...lines].join("\n");
    },
  });
