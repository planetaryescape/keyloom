// Wire format shared by the server and the browser client. The layout, board and
// geometry schemas are imported from their owning modules, not redefined here.
import { z } from "zod";
import { BoardDefinitionSchema, GeometrySchema } from "../boards/schema.ts";
import { ChangeOpSchema, DecisionDraftSchema, SlotSchema } from "../layout/change.ts";
import { BindingSchema, LayoutSchema } from "../layout/schema.ts";
import { DetectedKeyboardSchema } from "./detected-keyboards.ts";
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
  // What the head holds as Oryx code that keyloom can now read into the model (D-193); null when nothing, and the page then offers nothing.
  upgrade: z.object({ colours: z.boolean(), tapDances: z.boolean() }).nullable().default(null),
});
export type LayoutDetail = z.infer<typeof LayoutDetailSchema>;

// Editing, building and flashing (rung 2). Every route below takes and returns JSON, needs the
// session token like the reads, and reports failure with ApiErrorBody.
//   POST /api/layouts/:ref/check        CheckRequest  -> CheckResponse
//   POST /api/layouts/:ref/parse-binding ParseBindingRequest -> ParseBindingResponse (reads a typed QMK or ZMK expression; writes nothing)
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

// The editor's Any field: a firmware expression such as `LCTL_T(KC_A)` or `&mt LCTRL A`, read as the
// importers read one. An expression keyloom doesn't model comes back as a native binding; text that
// isn't an expression at all comes back as ok: false, with a sentence to show.
export const ParseBindingRequestSchema = z.object({
  expression: z.string().max(500),
  // The key it is for, which decides the profile of a QMK mod-tap (home row or not).
  position: z.number().int().nonnegative().optional(),
});
export type ParseBindingRequest = z.infer<typeof ParseBindingRequestSchema>;

export const ParseBindingResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), binding: BindingSchema, native: z.boolean(), note: z.string().optional() }),
  z.object({ ok: z.literal(false), message: z.string().min(1) }),
]);
export type ParseBindingResponse = z.infer<typeof ParseBindingResponseSchema>;

export const ApplyRequestSchema = CheckRequestSchema.extend({
  // One line for the revision history, such as "Layer 2, key 31: Left Alt".
  summary: z.string().min(1).max(200),
  // Why, if the person wants keyloom to remember it: a later change to these keys brings it back (08).
  reason: z.string().max(1000).optional(),
});
export type ApplyRequest = z.infer<typeof ApplyRequestSchema>;

export const ApplyResponseSchema = z.object({
  revisionId: z.string().min(1),
  changeSetId: z.string().min(1),
  validation: ValidationResultSchema,
  // The decision written for this change, or null when it had no reason to remember.
  decisionId: z.string().min(1).nullable(),
});
export type ApplyResponse = z.infer<typeof ApplyResponseSchema>;

// Undo names the head it expects to undo, so a stale tab can't undo someone else's change.
// `to` goes back to an earlier revision of the same layout instead of one step; it is still one new revision (D-170).
export const UndoRequestSchema = z.object({ revisionId: z.string().min(1), to: z.string().min(1).optional() });
export type UndoRequest = z.infer<typeof UndoRequestSchema>;

export const UpgradeResponseSchema = z.object({ changed: z.boolean(), message: z.string().min(1), revisionId: z.string().min(1).nullable() });
export type UpgradeResponse = z.infer<typeof UpgradeResponseSchema>;

export const UndoResponseSchema = z.object({ revisionId: z.string().min(1) });
export type UndoResponse = z.infer<typeof UndoResponseSchema>;

// History is the layout's revisions, newest first (18#words, D-102).
//   GET  /api/layouts/:ref/revisions                 -> RevisionListResponse
//   GET  /api/boards                                 -> BoardListResponse     (what the import screen offers)
//   POST /api/import?board=&filename=&name=  <file bytes as application/octet-stream> -> ImportResponse
export const RevisionEntrySchema = RevisionInfoSchema.omit({ undoable: true }).extend({ isHead: z.boolean() });
export type RevisionEntry = z.infer<typeof RevisionEntrySchema>;
export const RevisionListResponseSchema = z.object({ revisions: z.array(RevisionEntrySchema) });

export const BoardChoiceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  vendor: z.string().min(1),
  firmware: z.enum(["qmk", "zmk", "kanata"]),
  keyCount: z.number().int().positive(),
  importers: z.array(z.string().min(1)).min(1),
  // The board's keys and display hints, so the top bar can draw each board's silhouette before its layout is open (D-269).
  keys: GeometrySchema.shape.keys.optional(),
  display: BoardDefinitionSchema.shape.display,
});
export type BoardChoice = z.infer<typeof BoardChoiceSchema>;
export const BoardListResponseSchema = z.object({ boards: z.array(BoardChoiceSchema) });

export const ImportResponseSchema = z.object({
  layoutId: z.string().min(1),
  revisionId: z.string().min(1),
  name: z.string().min(1),
  layers: z.number().int().nonnegative(),
  keysPerLayer: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});
export type ImportResponse = z.infer<typeof ImportResponseSchema>;

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
  // What keyloom confirmed after a successful flash, such as "Verified: the keyboard is running build bld_...".
  note: z.string().nullable(),
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

// The agent's question to BK (D-380): the options as buttons, the recommended one first. `answer` is null while it is open.
export const QuestionCardSchema = z.object({
  toolUseId: z.string().min(1),
  question: z.string().min(1),
  options: z.array(z.object({ label: z.string().min(1), description: z.string().min(1).optional() })).min(2).max(4),
  allowOther: z.boolean(),
  answer: z.string().nullable(),
});
export type QuestionCard = z.infer<typeof QuestionCardSchema>;

export const ChatRequestSchema = z.object({
  // Omitted to start a conversation; its id comes back in the `start` event.
  conversationId: z.string().min(1).optional(),
  message: z.string().min(1).max(8000).optional(),
  // The answer to the question the conversation is waiting on, in place of a message (D-382).
  answer: z.object({ toolUseId: z.string().min(1), text: z.string().min(1).max(500) }).optional(),
  // The keys selected in the editor when the message was sent (D-012).
  selection: ChatSelectionSchema.optional(),
  // Key changes kept on the board but not applied (D-317), so the agent knows what BK is in the middle of.
  drafts: z.array(z.object({ layerId: z.string().min(1), position: z.number().int().nonnegative(), binding: BindingSchema })).max(100).optional(),
}).refine((r) => (r.message === undefined) !== (r.answer === undefined), { message: "send either a message or an answer to the open question" });
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ProposalCardSchema = z.object({
  changeSetId: z.string().min(1),
  // The alternatives from one propose_changes call share a group, so the panel can compare them. Null for a lone change set.
  proposalGroup: z.string().nullable(),
  title: z.string().min(1),
  explanation: z.string(),
  tradeoffs: z.object({ gains: z.array(z.string()), costs: z.array(z.string()) }),
  // What keyloom will remember if this is applied (rung 6, 08); null when the change set carries no reason.
  decisionDraft: DecisionDraftSchema.nullable(),
  status: z.enum(["proposed", "applied", "rejected", "superseded"]),
  validation: ValidationResultSchema,
  ops: z.array(ChangeOpSchema),
});
export type ProposalCard = z.infer<typeof ProposalCardSchema>;

// A priority BK stated (rung 4, 08): shown as a chip with a remove button.
//   DELETE /api/priorities/:id            -> 204   (404 not_found; the decision is retired, not erased)
export const PriorityCardSchema = z.object({
  id: z.string().min(1),
  priorityKind: z.enum(["pinned", "rarely_used", "frequent", "willing_to_relearn"]),
  // BK's words as he said them.
  statement: z.string().min(1),
  reason: z.string(),
  subject: z.object({ slots: z.array(SlotSchema).optional(), functions: z.array(z.string().min(1)).optional() }),
  // Ids of his messages it came from, so a reopened conversation shows the chip under the right reply.
  sourceMessageIds: z.array(z.string()),
  createdAt: z.number().finite(),
});
export type PriorityCard = z.infer<typeof PriorityCardSchema>;

// Which provider answers, so the panel can say so and, when none is set up, list every way to set one up (19).
//   GET  /api/chat/provider                           -> ChatProviderStatus
export const ChatProviderIdSchema = z.enum(["anthropic", "openrouter", "codex"]);
export const ChatProviderStatusSchema = z.object({
  // What the next new conversation uses; null when no provider has a credential, which is the missing-key state.
  active: z.object({ provider: ChatProviderIdSchema, model: z.string().min(1), effort: z.string().min(1) }).nullable(),
  // Set when something outranks the config file, so the picker can say why a choice would not apply: the --provider flag or KEYLOOM_PROVIDER.
  lockedBy: z.enum(["--provider", "KEYLOOM_PROVIDER"]).nullable().default(null),
  providers: z.array(z.object({
    id: ChatProviderIdSchema,
    label: z.string().min(1),
    // What a conversation on this provider uses when the config names no model.
    defaultModel: z.string().min(1),
    ready: z.boolean(),
    // What to do to use it, as a sentence for the missing-key state.
    setup: z.string().min(1),
    // A command to copy, when there is one.
    command: z.string().min(1),
  })),
});
export type ChatProviderStatus = z.infer<typeof ChatProviderStatusSchema>;

//   POST /api/chat/provider   ChatProviderChoice -> ChatProviderStatus   (writes <data dir>/config.json; the next conversation uses it)
export const ChatProviderChoiceSchema = z.object({
  provider: ChatProviderIdSchema,
  // Omitted means the provider's default model.
  model: z.string().trim().min(1).optional(),
});
export type ChatProviderChoice = z.infer<typeof ChatProviderChoiceSchema>;

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
  status: z.enum(["awaiting_answer", "complete", "refused", "truncated", "context_full", "iteration_limit"]),
  text: z.string(),
  proposals: z.array(ProposalCardSchema),
  priorities: z.array(PriorityCardSchema),
  // Set with the status `awaiting_answer`.
  question: QuestionCardSchema.optional(),
  provider: ChatProviderIdSchema,
  model: z.string(),
  effort: z.string(),
  usage: ChatUsageSchema,
  // What the provider charged, when it says (OpenRouter does; Codex and Anthropic don't).
  costUsd: z.number().nonnegative().optional(),
  iterations: z.number().int().nonnegative(),
});
export type ChatOutcome = z.infer<typeof ChatOutcomeSchema>;

export const ChatEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), conversationId: z.string().min(1), messageId: z.string().min(1) }),
  z.object({ type: z.literal("text"), delta: z.string() }),
  // A tool the agent is running ("get_layout", "propose_changes"), for a progress line.
  z.object({ type: z.literal("tool"), name: z.string().min(1) }),
  z.object({ type: z.literal("proposal"), proposal: ProposalCardSchema }),
  // A priority the agent just recorded from what BK said (rung 4).
  z.object({ type: z.literal("priority"), priority: PriorityCardSchema }),
  z.object({ type: z.literal("done"), outcome: ChatOutcomeSchema }),
  z.object({ type: z.literal("error"), code: z.string().min(1), message: z.string().min(1) }),
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;

export const ConversationSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.number().finite(),
  // What came of it, so two conversations about the same thing read apart in the list (P3 review). Absent from older servers.
  outcome: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("applied"), title: z.string() }),
      z.object({ kind: z.literal("options"), count: z.number().int().positive() }),
      z.object({ kind: z.literal("talk") }),
    ])
    .optional(),
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
  // The question this reply asked, open or answered (D-381).
  question: QuestionCardSchema.optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ConversationDetailSchema = z.object({
  // The provider and model it started on and stays on (D-111); model is null for one from before it was recorded.
  conversation: ConversationSummarySchema.extend({ layoutId: z.string().min(1), provider: ChatProviderIdSchema, model: z.string().nullable() }),
  messages: z.array(ChatMessageSchema),
  proposals: z.array(ProposalCardSchema),
  priorities: z.array(PriorityCardSchema),
});
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;

// Applying a stored proposal (rung 3). Same token and error conventions as the editor routes above.
//   POST /api/change-sets/:id/apply       {} -> ApplyResponse   (404 not_found; 400 usage when the change set is no
//                                                                 longer proposed; 409 stale_base or validation_failed)
// It applies the change set exactly as stored, against the head, and marks its siblings superseded. It
// never builds or flashes.

// Decisions (rung 6, 08): what keyloom remembers about why keys are where they are.
//   GET    /api/layouts/:ref/decisions             -> DecisionListResponse     (retired ones are left out)
//   PATCH  /api/decisions/:id    DecisionPatch     -> DecisionCard             (400 usage on an empty field)
//   DELETE /api/decisions/:id                      -> 204                      (retires it; the record stays)
//   GET    /api/layouts/:ref/outcome-questions     -> OutcomeQuestionsResponse (the 7-day question, Q6)
//   POST   /api/decisions/:id/outcome  OutcomeAnswer -> DecisionCard           (400 usage when it no longer applies)
export const DecisionStatusSchema = z.enum(["hypothesis", "tried_helpful", "tried_unhelpful", "superseded", "retired"]);

export const DecisionCardSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["choice", "priority"]),
  priorityKind: z.enum(["pinned", "rarely_used", "frequent", "willing_to_relearn"]).nullable(),
  status: DecisionStatusSchema,
  goal: z.string(),
  choice: z.string(),
  reason: z.string(),
  scope: z.object({ apps: z.array(z.string()), habits: z.array(z.string()) }),
  subject: z.object({ slots: z.array(SlotSchema).optional(), functions: z.array(z.string().min(1)).optional() }),
  outcomeNote: z.string().nullable(),
  // The decision that replaced this one; null while it is active, or when it was overridden without a recorded reason.
  supersededBy: z.string().nullable(),
  // The link back to the words it came from (08): the conversation and BK's messages in it.
  conversationId: z.string().nullable(),
  sourceMessageIds: z.array(z.string()),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
});
export type DecisionCard = z.infer<typeof DecisionCardSchema>;

export const DecisionListResponseSchema = z.object({ decisions: z.array(DecisionCardSchema) });
export type DecisionListResponse = z.infer<typeof DecisionListResponseSchema>;

export const DecisionPatchSchema = z
  .object({
    goal: z.string().min(1).max(500),
    choice: z.string().min(1).max(500),
    reason: z.string().min(1).max(1000),
    scope: z.object({ apps: z.array(z.string().min(1)).max(20), habits: z.array(z.string().min(1)).max(20) }),
    // BK may move a decision between these; superseded and retired are set by keyloom and by Retire.
    status: z.enum(["hypothesis", "tried_helpful", "tried_unhelpful"]),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "nothing to change" });
export type DecisionPatch = z.infer<typeof DecisionPatchSchema>;

export const OutcomeQuestionsResponseSchema = z.object({
  questions: z.array(z.object({ decision: DecisionCardSchema, flashedAt: z.number().finite() })),
});
export type OutcomeQuestionsResponse = z.infer<typeof OutcomeQuestionsResponseSchema>;

// Either a verdict in BK's words, or "not now", which ends the question and leaves the decision a hypothesis.
export const OutcomeAnswerSchema = z.union([
  z.object({ status: z.enum(["tried_helpful", "tried_unhelpful"]), note: z.string().trim().min(1).max(500) }),
  z.object({ dismiss: z.literal(true) }),
]);
export type OutcomeAnswer = z.infer<typeof OutcomeAnswerSchema>;

// Keyboard sync (rung 13, 17): where each keyboard stands against its layout's head, and what turns that into a flash.
//   GET  /api/sync                       -> SyncStatusResponse
//   POST /api/sync        SyncNowRequest -> SyncNowResponse   (202; 400 usage when the board can't be synced right now, with the reason)
//   POST /api/sync/auto   AutoSyncRequest -> SyncStatusResponse (400 usage when auto-sync can't be on yet)
//   POST /api/sync/pause  PauseRequest   -> SyncStatusResponse
//   POST /api/sync/disable-remapping DisableRemappingRequest -> SyncStatusResponse (400 usage when the board is not a software remapper or kanata is not running)
//   GET  /api/events                     -> text/event-stream of SyncEvent; the first frame is the current state
// A state is the same word the CLI prints: in_sync, syncing, behind, needs_hand, not_connected, not_keyloom.
export const SyncStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("in_sync") }),
  z.object({
    kind: z.literal("syncing"),
    step: z.enum(["building", "restarting", "writing", "verifying"]),
    syncId: z.string().min(1),
    startedAt: z.number().finite(),
    trigger: z.enum(["auto", "manual"]),
  }),
  z.object({
    kind: z.literal("behind"),
    // Revisions between what the keyboard runs and the head; null when keyloom can't count them.
    changes: z.number().int().nonnegative().nullable(),
    why: z.enum(["waiting", "auto_off", "paused", "unproven", "failed", "unknown_build", "other_config", "changed_since", "remapping_off"]),
    error: z.string().nullable(),
  }),
  z.object({ kind: z.literal("needs_hand"), instruction: z.string(), reason: z.string() }),
  // changes: what was applied since the last build keyloom put on the keyboard, when it knows (see SyncFacts.lastKnown).
  z.object({ kind: z.literal("not_connected"), changes: z.number().int().nonnegative().nullable().optional() }),
  z.object({ kind: z.literal("not_keyloom"), detail: z.string() }),
]);
export type SyncState = z.infer<typeof SyncStateSchema>;

export const SyncRunSchema = z.object({
  id: z.string().min(1),
  trigger: z.enum(["auto", "manual"]),
  status: z.enum(["building", "flashing", "succeeded", "failed", "cancelled"]),
  step: z.string(),
  revisionId: z.string().min(1),
  failure: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.number().finite(),
  finishedAt: z.number().finite().nullable(),
  timings: z.object({
    waitMs: z.number().nullable(),
    buildMs: z.number().nullable(),
    flashMs: z.number().nullable(),
    totalMs: z.number().nullable(),
  }),
});

export const BoardSyncSchema = z.object({
  boardId: z.string().min(1),
  boardName: z.string().min(1),
  // A software remapper (the MacBook's keyboard): Apply writes a config and reloads it, with no build or flash (21). Absent on older senders.
  remapper: z.boolean().optional(),
  layoutId: z.string().min(1),
  layoutName: z.string().min(1),
  headRevisionId: z.string().min(1),
  otherLayouts: z.number().int().nonnegative(),
  state: SyncStateSchema,
  auto: z.object({
    on: z.boolean(),
    choice: z.boolean().nullable(),
    paused: z.boolean(),
    proven: z.boolean(),
    provenAt: z.number().nullable(),
    dueAt: z.number().nullable(),
  }),
  last: SyncRunSchema.nullable(),
});
export type BoardSync = z.infer<typeof BoardSyncSchema>;

export const SyncStatusResponseSchema = z.object({ boards: z.array(BoardSyncSchema) });
export type SyncStatusResponse = z.infer<typeof SyncStatusResponseSchema>;

export const SyncNowRequestSchema = z.object({ layoutId: z.string().min(1) });
export type SyncNowRequest = z.infer<typeof SyncNowRequestSchema>;

export const SyncNowResponseSchema = z.object({
  result: z.enum(["started", "already_running", "in_sync", "queued"]),
  boards: z.array(BoardSyncSchema),
});
export type SyncNowResponse = z.infer<typeof SyncNowResponseSchema>;

export const AutoSyncRequestSchema = z.object({ boardId: z.string().min(1), enabled: z.boolean() });
export const PauseRequestSchema = z.object({ boardId: z.string().min(1), paused: z.boolean() });
export const DisableRemappingRequestSchema = z.object({ boardId: z.string().min(1) });

// `newKeyboards`: keyboards on USB keyloom has no board for, from the engine's own reads (D-336); absent from older senders.
// `menuBar`: what the desktop app's menu-bar extra shows, worded by the server so the app carries no product text (D-325). Absent on older senders.
export const MenuBarSchema = z.object({
  /** The board that most needs looking at, as the header words it. */
  summary: z.string(),
  /** Short text beside the menu-bar icon, or null when every keyboard is fine. */
  title: z.string().nullable(),
  /** One line per board, in the order `keyloom sync status` lists them. */
  lines: z.array(z.object({ boardId: z.string(), text: z.string() })),
  /** The config Sync now would put on its keyboard, or null when nothing is waiting. */
  syncLayoutId: z.string().nullable(),
  /** Changes since the previous frame on this stream that deserve a native notification. */
  notices: z.array(z.object({ title: z.string(), body: z.string() })),
});
export type MenuBar = z.infer<typeof MenuBarSchema>;
export const SyncEventSchema = z.object({ type: z.literal("sync"), boards: z.array(BoardSyncSchema), newKeyboards: z.array(DetectedKeyboardSchema).optional(), menuBar: MenuBarSchema.optional() });
export type SyncEvent = z.infer<typeof SyncEventSchema>;
