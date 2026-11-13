import type { z } from "zod";
import type { ModelTool } from "../model.ts";
import { PublicToolError } from "./public-error.ts";

/** A typed tool: the schema both advertises the input to the model and parses what comes back, so `run` sees a checked value. */
export function defineTool<S extends z.ZodObject>(def: {
  name: string;
  description: string;
  inputSchema: S;
  strict?: boolean;
  pauses?: boolean;
  completes?: boolean;
  run: (input: z.infer<S>) => Promise<string> | string;
}): ModelTool {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    ...(def.strict === undefined ? {} : { strict: def.strict }),
    ...(def.pauses === undefined ? {} : { pauses: def.pauses }),
    ...(def.completes === undefined ? {} : { completes: def.completes }),
    run: (raw) => {
      // Streamed tool input is not validated by the API (03#model-and-sdk), so this is the check.
      const parsed = def.inputSchema.safeParse(raw);
      if (!parsed.success) {
        const issues = parsed.error.issues;
        const problems = issues.slice(0, 8).map((i) => `${i.path.join(".") || "input"}: ${i.message}`.slice(0, 200)).join("; ")
          + (issues.length > 8 ? `; ${issues.length - 8} more validation issues` : "");
        throw new PublicToolError("invalid_input", `invalid input for ${def.name}: ${problems}`);
      }
      return def.run(parsed.data);
    },
  };
}
