import { z } from "zod";
import type { AgentPorts } from "../ports.ts";
import { fingerOf, findOccurrences, handOf, layerAccess, normalizeFunction } from "../layout-facts.ts";
import { defineTool } from "./define.ts";

const InputSchema = z.object({
  function: z
    .string()
    .min(1)
    .describe('A function id such as "mod:LALT" (Option), "mod:LGUI+LSFT", "key:A" or "layer:momentary:layer-1". A bare "LALT" or "A" also works.'),
});

export const findFunctionTool = (ports: AgentPorts) =>
  defineTool({
    name: "find_function",
    description:
      'Find every position and layer that produces a function, and how each of those layers is reached. Use it to answer "where is Option now?" instead of reading grids. A hold-tap produces two functions: its tap half and its hold half.',
    inputSchema: InputSchema,
    run: ({ function: requested }) => {
      const fn = normalizeFunction(requested);
      if (fn === null) throw new Error(`"${requested}" is not a function id; use forms like mod:LALT, key:A, layer:momentary:layer-1 or macro:<id>`);
      const { document, board } = ports.snapshot();
      const found = findOccurrences(document, fn);
      if (found.length === 0) return `${fn} is produced by no key on any layer.`;

      const lines = found.map((o) => {
        const what = o.role === "plain" ? "plain" : `${o.role} half of hold-tap`;
        return `- ${o.layerId} (${o.layerName}) position ${o.position} [${o.label}]: ${what}, ${handOf(board.definition, o.position)} ${fingerOf(board.definition, o.position)}`;
      });
      const plain = found.filter((o) => o.role === "plain");
      const layerIds = [...new Set(found.map((o) => o.layerId))];
      const access = layerIds.map((id) => `- ${id}: ${layerAccess(document, board.definition, id).join("; ")}`);
      return [
        `${fn} is produced at ${found.length} place${found.length === 1 ? "" : "s"}:`,
        ...lines,
        plain.length === 0 ? "No key produces it as a plain press; it only comes from hold-tap or combo behaviour." : `${plain.length} plain source${plain.length === 1 ? "" : "s"}.`,
        "How those layers are reached:",
        ...access,
      ].join("\n");
    },
  });
