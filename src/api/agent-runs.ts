import { z } from "zod";
import { ChatPresentationSchema, ChatRequestSchema, PreparationSummarySchema, CopyHandoffSchema } from "./http.ts";
import { ViewClientSchema } from "./open-view.ts";

export const AgentRunRequestSchema = z.object({
  viewClient: ViewClientSchema.optional(),
  version: z.literal(1), requestId: z.string().min(1).max(128), layoutRef: z.string().min(1).max(256), input: ChatRequestSchema,
});
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;
export const AgentRunSnapshotSchema = z.object({
  viewProtocol: z.literal(1).optional(),
  handoff: CopyHandoffSchema.optional(),
  version: z.literal(1), id: z.string(), requestId: z.string(), conversationId: z.string(), userMessageId: z.string(),
  status: z.enum(["running", "waiting_user", "completed", "failed", "cancelled", "interrupted"]),
  seq: z.number().int().positive(), cancelRequested: z.boolean(), committedPreparations: z.number().int().nonnegative(),
  preparations: z.array(PreparationSummarySchema).max(64),
  presentation: ChatPresentationSchema.nullable(),
});
export type AgentRunSnapshot = z.infer<typeof AgentRunSnapshotSchema>;
export const AgentRequestCancellationSchema = z.union([AgentRunSnapshotSchema, z.object({ version: z.literal(1), status: z.literal("pending_acceptance"), requestId: z.string().min(1).max(128), cancelRequested: z.literal(true) })]);
export type AgentRequestCancellation = z.infer<typeof AgentRequestCancellationSchema>;
