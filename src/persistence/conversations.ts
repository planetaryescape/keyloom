// Repository for conversations and their messages (02#database). A message's content is the
// Anthropic content-block array exactly as sent or received, because current models reject
// edited history that carries thinking blocks; nothing here rewrites a stored message.
import type { Database } from "bun:sqlite";
import { z } from "zod";
import { newId } from "./ids.ts";

export type ConversationRow = { id: string; layoutId: string; title: string; createdAt: number };

// Loose on purpose: the blocks are the SDK's, and keyloom only needs to carry them back unchanged.
const ContentBlockSchema = z.looseObject({ type: z.string().min(1) });
export type ContentBlock = z.infer<typeof ContentBlockSchema>;
const ContentSchema = z.array(ContentBlockSchema);

/** The positions and layers selected when a message was sent (D-012). */
export const SelectionSchema = z.object({
  layerId: z.string().min(1),
  positions: z.array(z.number().int().nonnegative()).min(1),
});
export type Selection = z.infer<typeof SelectionSchema>;

export type MessageRow = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: ContentBlock[];
  selection: Selection | null;
  createdAt: number;
};

type ConversationDb = { id: string; layout_id: string; title: string; created_at: number };
type MessageDb = { id: string; conversation_id: string; role: "user" | "assistant"; content: string; selection: string | null; created_at: number };

const toConversation = (r: ConversationDb): ConversationRow => ({ id: r.id, layoutId: r.layout_id, title: r.title, createdAt: r.created_at });
const toMessage = (r: MessageDb): MessageRow => ({
  id: r.id,
  conversationId: r.conversation_id,
  role: r.role,
  content: ContentSchema.parse(JSON.parse(r.content)),
  selection: r.selection === null ? null : SelectionSchema.parse(JSON.parse(r.selection)),
  createdAt: r.created_at,
});

export function insertConversation(db: Database, input: { layoutId: string; title: string; now?: number }): ConversationRow {
  const id = newId("conv");
  db.query("INSERT INTO conversations (id, layout_id, title, created_at) VALUES (?, ?, ?, ?)").run(id, input.layoutId, input.title, input.now ?? Date.now());
  return findConversation(db, id) as ConversationRow;
}

export function findConversation(db: Database, id: string): ConversationRow | undefined {
  const row = db.query("SELECT * FROM conversations WHERE id = ?").get(id) as ConversationDb | null;
  return row ? toConversation(row) : undefined;
}

/** Newest first. */
export function listConversations(db: Database, layoutId: string): ConversationRow[] {
  const rows = db.query("SELECT * FROM conversations WHERE layout_id = ? ORDER BY created_at DESC, id DESC").all(layoutId);
  return (rows as ConversationDb[]).map(toConversation);
}

export function insertMessage(
  db: Database,
  input: { conversationId: string; role: "user" | "assistant"; content: ContentBlock[]; selection?: Selection; now?: number },
): MessageRow {
  const id = newId("msg");
  db.query("INSERT INTO messages (id, conversation_id, role, content, selection, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    id, input.conversationId, input.role, JSON.stringify(input.content), input.selection ? JSON.stringify(input.selection) : null, input.now ?? Date.now(),
  );
  return toMessage(db.query("SELECT * FROM messages WHERE id = ?").get(id) as MessageDb);
}

/** Oldest first; the monotonic ID breaks a tie between two written in one millisecond. */
export function listMessages(db: Database, conversationId: string): MessageRow[] {
  const rows = db.query("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC").all(conversationId);
  return (rows as MessageDb[]).map(toMessage);
}
