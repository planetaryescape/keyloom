import { z } from "zod";

export const AgentViewSchema = z.enum(["history", "lab", "decisions", "settings"]);
export type AgentView = z.infer<typeof AgentViewSchema>;
export const ViewResultSchema = z.union([
  z.object({ version: z.literal(1), status: z.enum(["opened", "already-open"]) }).strict(),
  z.object({ version: z.literal(1), status: z.literal("unavailable"), reason: z.enum(["unsupported", "busy", "timeout", "cancelled", "background", "draft", "recording", "moved", "disconnected", "limit"]) }).strict(),
]);
export type ViewResult = z.infer<typeof ViewResultSchema>;
const scope = { version: z.literal(1), id: z.string().min(1).max(80), runId: z.string().min(1).max(80), requestId: z.string().min(1).max(128), configId: z.string().min(1).max(80), expiresAt: z.number().int().positive(), view: AgentViewSchema };
export const ViewIntentSchema = z.discriminatedUnion("status", [
  z.object({ ...scope, status: z.literal("pending") }),
  z.object({ ...scope, status: z.literal("resolved"), result: ViewResultSchema }),
]);
export type ViewIntent = z.infer<typeof ViewIntentSchema>;
export const ViewClientSchema = z.object({ version: z.literal(1), owner: z.string().uuid() }).strict();
export const ViewAckSchema = z.object({ version: z.literal(1), owner: z.string().uuid(), configId: z.string().min(1).max(80), intentId: z.string().min(1).max(80), result: ViewResultSchema }).strict();
export type ViewAck = z.infer<typeof ViewAckSchema>;
