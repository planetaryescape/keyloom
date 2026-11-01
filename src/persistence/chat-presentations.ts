import type { Database } from "bun:sqlite";
import { z } from "zod";

// Persistence owns its schema; the API has a structural wire counterpart, checked by contract tests.
export const AccountingSchema = z.object({
  provider: z.enum(["anthropic", "openrouter", "codex"]), model: z.string(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(), cacheCreationTokens: z.number().int().nonnegative(),
  }),
  costUsd: z.number().nonnegative().optional(),
});
export type Accounting = z.infer<typeof AccountingSchema>;

export const CopyHandoffSchema = z.object({ layoutId: z.string(), conversationId: z.string(), runId: z.string(), requestId: z.string() });

export const PresentationSchema = z.object({
  handoff: CopyHandoffSchema.optional(),
  version: z.literal(1),
  userMessageId: z.string().min(1),
  accounting: AccountingSchema.optional(),
  questionToolUseId: z.string().min(1).max(128).optional(),
  // The change set the paused question refines: the last proposal saved before it in the same turn, in call order (D-452). Absent for a question that
  // refines nothing, such as a remembered decision asked before anything is proposed. Recorded when the question is stored, never inferred later.
  questionRefines: z.string().min(1).max(80).optional(),
  status: z.enum(["running", "waiting_user", "completed", "incomplete", "failed", "cancelled", "unobserved"]),
  operations: z.array(z.object({
    id: z.string().min(1), tool: z.string().max(64), label: z.string().max(80),
    status: z.enum(["running", "succeeded", "failed", "declined", "partial", "unknown"]),
    durationMs: z.number().int().nonnegative(),
    failureCode: z.enum(["invalid_input", "function_id", "unknown_layer", "tool_error"]).optional(),
    validationCodes: z.array(z.string().max(64)).max(8),
    references: z.array(z.object({ kind: z.enum(["config", "proposal", "priority", "decision"]), id: z.string().max(80) })).max(8),
    accepted: z.number().int().nonnegative(), declined: z.number().int().nonnegative(),
  })).max(64),
  messages: z.array(z.object({ id: z.string().min(1), kind: z.enum(["working_note", "answer"]), text: z.string(), messageId: z.string().min(1).optional() })).max(64),
  // Typed result cards under the reply (D-467). Persistence does not own the artifact union (the wire schema does, and the module table
  // keeps this folder from importing it), so the stored shape is the bounded list; the API validates each card as it is sent.
  artifacts: z.array(z.unknown()).max(4).optional(),
  effectsMayHaveOccurred: z.boolean(), warning: z.string().nullable(), detailsTruncated: z.boolean(),
});
export type Presentation = z.infer<typeof PresentationSchema>;
export const PRESENTATION_BYTES = 64 * 1024;

export function savePresentation(db: Database, conversationId: string, presentation: Presentation): void {
  const json = JSON.stringify(PresentationSchema.parse(presentation));
  if (Buffer.byteLength(json) > PRESENTATION_BYTES) throw new Error("chat presentation exceeds its storage budget");
  db.query("INSERT INTO chat_presentations (user_message_id, conversation_id, payload) VALUES (?, ?, ?) ON CONFLICT(user_message_id) DO UPDATE SET payload = excluded.payload")
    .run(presentation.userMessageId, conversationId, json);
}

export function listPresentations(db: Database, conversationId: string): Presentation[] {
  const rows = db.query("SELECT payload FROM chat_presentations WHERE conversation_id = ? ORDER BY user_message_id").all(conversationId) as Array<{ payload: string }>;
  return rows.map((row) => PresentationSchema.parse(JSON.parse(row.payload)));
}
