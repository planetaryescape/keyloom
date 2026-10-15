import { z } from "zod";
import { ChangeOpSchema } from "../../layout/change.ts";
import type { AgentPorts } from "../ports.ts";
import { defineTool } from "./define.ts";
import type { TurnRecorder } from "../recorder.ts";
import { validationForModel } from "./validation-text.ts";

const InputSchema = z.object({ ops: z.array(ChangeOpSchema).min(1) });

export const analyseChangeTool = (ports: AgentPorts, recorder: TurnRecorder) =>
  defineTool({
    name: "analyse_change",
    description:
      "Validate change ops against the layout's head without saving anything. Use it to test an idea before propose_changes. Errors mean the ops cannot be applied; warnings are things to tell BK about.",
    inputSchema: InputSchema,
    run: ({ ops }) => {
      const result = ports.check(ops);
      recorder.validation("analyse_change", result);
      return validationForModel(result);
    },
  });
