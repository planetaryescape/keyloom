import type { Database } from "bun:sqlite";
import { z } from "zod";

// Persistence owns its schema; the API has a structural wire counterpart, checked by contract tests.
export const PresentationSchema = z.object({
  version: z.literal(1),
  userMessageId: z.string().min(1),
  questionToolUseId: z.string().min(1).max(128).optional(),
  status: z.enum(["running", "waiting_user", "completed", "incomplete", "failed", "cancelled", "unobserved"]),
  operations: z.array(z.object({
    id: z.string().min(1), tool: z.string().max(64), label: z.string().max(80),
    status: z.enum(["running", "succeeded", "failed", "declined", "partial", "unknown"]),
    durationMs: z.number().int().nonnegative(),
    validationCodes: z.array(z.string().max(64)).max(8),
    references: z.array(z.object({ kind: z.enum(["config", "proposal", "priority", "decision"]), id: z.string().max(80) })).max(8),
    accepted: z.number().int().nonnegative(), declined: z.number().int().nonnegative(),
  })).max(64),
  messages: z.array(z.object({ id: z.string().min(1), kind: z.enum(["working_note", "answer"]), text: z.string(), messageId: z.string().min(1).optional() })).max(64),
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
