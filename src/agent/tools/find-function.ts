import { z } from "zod";
import type { AgentPorts } from "../ports.ts";
import { keyName } from "../../boards/key-names.ts";
import { findOccurrences, layerAccess, normalizeFunction } from "../layout-facts.ts";
import { defineTool } from "./define.ts";
import { PublicToolError } from "./public-error.ts";
import { withSensorDefaults } from "../../boards/sensors.ts";
import { bindingFunctions } from "../../layout/functions.ts";

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
      if (fn === null) throw new PublicToolError("function_id", `"${requested}" is not a function id; use forms like mod:LALT, key:A, layer:momentary:layer-1 or macro:<id>. Firmware aliases (C_VOL_UP, KC_VOLU) and labels (Volume up) also work. Call get_layout for encoder turns; a failed lookup is not evidence that the keyboard cannot do something.`);
      const { document, board } = ports.snapshot();
      const found = findOccurrences(document, fn);
      const sensors = withSensorDefaults(board.definition, document).layers.flatMap((layer) => (layer.sensorBindings ?? []).flatMap((sensor, index) => sensor.kind !== "rotation" ? [] : (["clockwise", "counterclockwise"] as const).filter((direction) => bindingFunctions(sensor[direction]).includes(fn)).map((direction) => `- ${layer.id} (${layer.name}) sensor ${index}, ${direction}; press position ${board.definition.sensorPositions?.[index] ?? "not recorded"}`)));
      if (found.length === 0 && sensors.length === 0) return `${fn} is produced by no key or modelled encoder turn on any layer. Unknown imported sensor behaviours may need inspection with get_layout.`;

      const lines = found.map((o) => {
        const what = o.role === "plain" ? "plain" : `${o.role} half of hold-tap`;
        return `- ${o.layerId} (${o.layerName}) position ${o.position}: ${keyName(board.definition, document, { layerId: o.layerId, position: o.position }, { geometry: board.geometry, withLayer: false })}, ${what}`;
      });
      const plain = found.filter((o) => o.role === "plain");
      const layerIds = [...new Set(found.map((o) => o.layerId))];
      const access = layerIds.map((id) => `- ${id}: ${layerAccess(document, board.definition, id).join("; ")}`);
      return [
        `${fn} is produced at ${found.length} key place${found.length === 1 ? "" : "s"} and ${sensors.length} encoder turn${sensors.length === 1 ? "" : "s"}:`,
        ...lines,
        ...(sensors.length ? ["Encoder turns:", ...sensors] : []),
        plain.length === 0 ? `No key produces it as a plain press; ${sensors.length > 0 ? "it is available on encoder turns" : "it only comes from hold-tap or combo behaviour"}.` : `${plain.length} plain source${plain.length === 1 ? "" : "s"}.`,
        "How those layers are reached:",
        ...access,
      ].join("\n");
    },
  });
