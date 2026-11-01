import { z } from "zod";
import { SlotSchema } from "../../layout/change.ts";
import { retargetLayerHold } from "../../layout/behavior-facts.ts";
import type { AgentPorts } from "../ports.ts";
import { defineTool } from "./define.ts";
import { PublicToolError } from "./public-error.ts";

export const retargetLayerHoldTool = (ports: AgentPorts) => defineTool({
  name: "retarget_layer_hold",
  description: "Prepare source-preserving ops to retarget an understood custom hold-layer key. Keeps its tap, timing and other arguments; never approximates it with a plain momentary key. Nothing is saved. Keep the old target's functions reachable in the complete proposal.",
  inputSchema: z.object({ at: SlotSchema, layerId: z.string().min(1) }),
  run: ({ at, layerId }) => {
    const document = ports.snapshot().document;
    let prepared: ReturnType<typeof retargetLayerHold>;
    try {
      prepared = retargetLayerHold(document, at, layerId);
    } catch (error) {
      throw new PublicToolError("invalid_input", error instanceof Error ? error.message : "This custom behavior cannot be safely retargeted.");
    }
    return JSON.stringify({ ...prepared, validation: ports.check(prepared.ops), saved: false });
  },
});
