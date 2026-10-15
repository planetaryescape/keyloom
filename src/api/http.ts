// Wire format shared by the server and the browser client. The layout, board and
// geometry schemas are imported from their owning modules, not redefined here.
import { z } from "zod";
import { BoardDefinitionSchema, GeometrySchema } from "../boards/schema.ts";
import { ChangeOpSchema } from "../layout/change.ts";
import { LayoutSchema } from "../layout/schema.ts";
import { ValidationResultSchema } from "../validation/result.ts";

export const LayoutSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  boardId: z.string().min(1),
  // When the layout was first saved (its import, today) and the revision the viewer is showing.
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  revisionId: z.string().min(1),
});
export type LayoutSummary = z.infer<typeof LayoutSummarySchema>;

export const LayoutListResponseSchema = z.object({
  layouts: z.array(LayoutSummarySchema),
});

// The revision the detail shows. `undoable` is false for the import revision, which has no parent.
export const RevisionInfoSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  origin: z.enum(["import", "editor", "agent", "undo"]),
  summary: z.string(),
  createdAt: z.number().finite(),
  undoable: z.boolean(),
});
export type RevisionInfo = z.infer<typeof RevisionInfoSchema>;

export const LayoutDetailSchema = z.object({
  revision: RevisionInfoSchema,
  document: LayoutSchema,
  board: BoardDefinitionSchema,
  geometry: GeometrySchema,
});
export type LayoutDetail = z.infer<typeof LayoutDetailSchema>;

// Editing, building and flashing (rung 2). Every route below takes and returns JSON, needs the
// session token like the reads, and reports failure with ApiErrorBody.
//   POST /api/layouts/:ref/check        CheckRequest  -> CheckResponse
//   POST /api/layouts/:ref/apply        ApplyRequest  -> ApplyResponse     (409 on stale_base or invalid ops)
//   POST /api/layouts/:ref/undo         UndoRequest   -> UndoResponse      (409 when the head moved)
//   POST /api/layouts/:ref/builds       BuildRequest  -> Build             (202; poll GET /api/builds/:id)
//   GET  /api/builds/:id                              -> Build
//   POST /api/builds/:id/flashes        {}            -> Flash             (202; poll GET /api/flashes/:id)
//   GET  /api/flashes/:id                             -> Flash

export const ApiErrorBodySchema = z.object({
  error: z.object({ code: z.string().min(1), message: z.string().min(1) }),
  // Present when ops failed validation, so the editor can point at the slots.
  validation: ValidationResultSchema.optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

export const CheckRequestSchema = z.object({
  baseRevisionId: z.string().min(1),
  ops: z.array(ChangeOpSchema).min(1),
});
export type CheckRequest = z.infer<typeof CheckRequestSchema>;

export const CheckResponseSchema = z.object({ validation: ValidationResultSchema });
export type CheckResponse = z.infer<typeof CheckResponseSchema>;

export const ApplyRequestSchema = CheckRequestSchema.extend({
  // One line for the revision history, such as "Layer 2, key 31: Left Alt".
  summary: z.string().min(1).max(200),
});
export type ApplyRequest = z.infer<typeof ApplyRequestSchema>;

export const ApplyResponseSchema = z.object({
  revisionId: z.string().min(1),
  changeSetId: z.string().min(1),
  validation: ValidationResultSchema,
});
export type ApplyResponse = z.infer<typeof ApplyResponseSchema>;

// Undo names the head it expects to undo, so a stale tab can't undo someone else's change.
export const UndoRequestSchema = z.object({ revisionId: z.string().min(1) });
export type UndoRequest = z.infer<typeof UndoRequestSchema>;

export const UndoResponseSchema = z.object({ revisionId: z.string().min(1) });
export type UndoResponse = z.infer<typeof UndoResponseSchema>;

export const BuildRequestSchema = z.object({
  revisionId: z.string().min(1),
  // The board revision to build for, such as "revb". Omitted, keyloom detects the connected keyboard
  // and answers 400 `usage` when none is connected, so the editor can ask.
  boardRevision: z.string().min(1).optional(),
});
export type BuildRequest = z.infer<typeof BuildRequestSchema>;

export const BuildSchema = z.object({
  id: z.string().min(1),
  revisionId: z.string().min(1),
  status: z.enum(["running", "succeeded", "failed"]),
  error: z.string().nullable(),
  startedAt: z.number().finite(),
  finishedAt: z.number().finite().nullable(),
  // The last lines of the build log, oldest first, for a progress view.
  logTail: z.array(z.string()),
});
export type Build = z.infer<typeof BuildSchema>;

export const FlashSchema = z.object({
  id: z.string().min(1),
  buildId: z.string().min(1),
  status: z.enum(["waiting_for_bootloader", "writing", "succeeded", "failed"]),
  error: z.string().nullable(),
  startedAt: z.number().finite(),
  finishedAt: z.number().finite().nullable(),
  // What the person must do now, such as "Press the reset button on the Moonlander".
  instruction: z.string().nullable(),
  logTail: z.array(z.string()),
});
export type Flash = z.infer<typeof FlashSchema>;

// Chat (rung 3). Same token and error conventions as above.
//   POST /api/layouts/:ref/chat           ChatRequest -> text/event-stream of ChatEvent
//                                         (400 usage, 404 not_found, 409 busy, 429/502/503 model failures, as ApiErrorBody, before the stream opens)
//   GET  /api/layouts/:ref/conversations              -> ConversationListResponse
//   GET  /api/conversations/:id                       -> ConversationDetail
// The stream is Server-Sent Events frames (`event: <type>` and `data: <ChatEvent JSON>`) read from a
// fetch response, because EventSource cannot POST. It always ends with `done` or `error`.

export const ChatSelectionSchema = z.object({
  layerId: z.string().min(1),
  positions: z.array(z.number().int().nonnegative()).min(1).max(500),
});
export type ChatSelection = z.infer<typeof ChatSelectionSchema>;

export const ChatRequestSchema = z.object({
  // Omitted to start a conversation; its id comes back in the `start` event.
  conversationId: z.string().min(1).optional(),
  message: z.string().min(1).max(8000),
  // The keys selected in the editor when the message was sent (D-012).
  selection: ChatSelectionSchema.optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ProposalCardSchema = z.object({
  changeSetId: z.string().min(1),
  title: z.string().min(1),
  explanation: z.string(),
  tradeoffs: z.object({ gains: z.array(z.string()), costs: z.array(z.string()) }),
  status: z.enum(["proposed", "applied", "rejected", "superseded"]),
  validation: ValidationResultSchema,
  ops: z.array(ChangeOpSchema),
});
export type ProposalCard = z.infer<typeof ProposalCardSchema>;

export const ChatUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
});

// `refused`: the model declined even after the server-side fallback. `truncated`, `context_full` and
// `iteration_limit` mean the reply is incomplete; the panel should say so.
export const ChatOutcomeSchema = z.object({
  conversationId: z.string().min(1),
  messageIds: z.array(z.string().min(1)),
  status: z.enum(["complete", "refused", "truncated", "context_full", "iteration_limit"]),
  text: z.string(),
  proposals: z.array(ProposalCardSchema),
  model: z.string(),
  effort: z.string(),
  usage: ChatUsageSchema,
  iterations: z.number().int().nonnegative(),
});
export type ChatOutcome = z.infer<typeof ChatOutcomeSchema>;

export const ChatEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), conversationId: z.string().min(1), messageId: z.string().min(1) }),
  z.object({ type: z.literal("text"), delta: z.string() }),
  // A tool the agent is running ("get_layout", "propose_changes"), for a progress line.
  z.object({ type: z.literal("tool"), name: z.string().min(1) }),
  z.object({ type: z.literal("proposal"), proposal: ProposalCardSchema }),
  z.object({ type: z.literal("done"), outcome: ChatOutcomeSchema }),
  z.object({ type: z.literal("error"), code: z.string().min(1), message: z.string().min(1) }),
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;

export const ConversationSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.number().finite(),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

export const ConversationListResponseSchema = z.object({ conversations: z.array(ConversationSummarySchema) });
export type ConversationListResponse = z.infer<typeof ConversationListResponseSchema>;

export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  toolCalls: z.array(z.string()),
  selection: ChatSelectionSchema.nullable(),
  createdAt: z.number().finite(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ConversationDetailSchema = z.object({
  conversation: ConversationSummarySchema.extend({ layoutId: z.string().min(1) }),
  messages: z.array(ChatMessageSchema),
  proposals: z.array(ProposalCardSchema),
});
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;

// Applying a stored proposal (rung 3). Same token and error conventions as the editor routes above.
//   POST /api/change-sets/:id/apply       {} -> ApplyResponse   (404 not_found; 400 usage when the change set is no
//                                                                 longer proposed; 409 stale_base or validation_failed)
// It applies the change set exactly as stored, against the head, and marks its siblings superseded. It
// never builds or flashes.
