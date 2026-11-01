import { z } from "zod";
import type { AgentPorts } from "../ports.ts";
import { defineTool } from "./define.ts";

export const openViewTool = (ports: AgentPorts) => defineTool({
  name: "open_view",
  description: "Open the existing History (layout versions, not conversations), typing lab, Decisions, or settings view on the current config in the browser that sent this request. Read-only navigation: never starts recording, applies changes, or changes settings. Only opened/already-open confirms a rendered view. An unavailable result means it did not open; tell the user honestly. CLI, legacy and background clients are unavailable.",
  inputSchema: z.object({ view: z.enum(["history", "lab", "decisions", "settings"]) }).strict(),
  strict: true,
  run: async ({ view }) => JSON.stringify(await ports.openView?.(view) ?? { version: 1, status: "unavailable", reason: "unsupported" }),
});
