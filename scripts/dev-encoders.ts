// Synthetic Corne and a recorded failed-lookup reply. No model, database, Docker or device.
// bun scripts/dev-encoders.ts [port]
import { loadBoardDir } from "../src/boards/load.ts";
import { importZmkSource } from "../src/firmware/zmk/import.ts";
import { FakeEditor } from "../test/helpers/fake-editor-backend.ts";
import { FakeChat } from "../test/helpers/fake-chat-backend.ts";
import { startServer } from "../src/server/start-server.ts";
import type { ChatBackend } from "../src/server/chat-backend.ts";
import type { ConversationDetail, LayoutDetail } from "../src/api/http.ts";
import { evaluate } from "../src/validation/validate.ts";
import { EditorError } from "../src/server/editor-backend.ts";

const board = await loadBoardDir("boards/keebart/corne-choc-pro-bt");
const { layout } = await importZmkSource("test/fixtures/zmk/encoder-layers.keymap", board.definition);
const fixture: LayoutDetail = { document: layout, board: board.definition, geometry: board.geometry, upgrade: null,
  revision: { id: "rev_encoder_sample", parentId: null, origin: "import", summary: "Synthetic encoder sample", createdAt: Date.UTC(2026, 10, 1), undoable: false } };
const editor = new FakeEditor(fixture);
// Unlike FakeEditor's toy checker, this harness exercises the production validator.
editor.check = async (_ref, request) => evaluate(board.definition, editor.detail().document, request.ops).result;
editor.apply = async (_ref, request) => {
  if (request.baseRevisionId !== editor.detail().revision.id) throw new EditorError(409, "stale_base", "The config changed.");
  const validation = evaluate(board.definition, editor.detail().document, request.ops).result;
  if (!validation.ok) throw new EditorError(409, "invalid_ops", "The change is invalid.", validation);
  const proposal = editor.storeProposal(request.ops, request.summary, "encoder-edit");
  return editor.applyChangeSet(proposal.id);
};
const fake = new FakeChat(editor, "encoder-sample");
const history: ConversationDetail = {
  conversation: { id: "encoder-history", layoutId: "encoder-sample", title: "Encoder controls", provider: "codex", model: "synthetic", createdAt: 1 },
  messages: [
    { id: "user-encoder", role: "user", text: "Use my encoders as a mouse on Base; keep volume and brightness on Numbers.", toolCalls: [], selection: null, createdAt: 1 },
    { id: "answer-encoder", role: "assistant", text: "I couldn’t finish the lookup. Nothing changed. Ask me to read the current encoder actions and try again; a failed lookup doesn’t mean the keyboard cannot do it.", toolCalls: [], selection: null, createdAt: 2 },
  ], proposals: [], priorities: [], presentations: [{ version: 1, userMessageId: "user-encoder", status: "completed", effectsMayHaveOccurred: false, warning: null, detailsTruncated: false,
    messages: [{ id: "note", kind: "working_note", text: "I’ll read the encoder actions and check a layer-specific change." }, { id: "answer", kind: "answer", text: "I couldn’t finish the lookup. Nothing changed. Ask me to read the current encoder actions and try again; a failed lookup doesn’t mean the keyboard cannot do it.", messageId: "answer-encoder" }],
    operations: [
      { id: "read", tool: "get_layout", label: "Read layout", status: "succeeded", durationMs: 7, accepted: 0, declined: 0, validationCodes: [], references: [] },
      ...["first", "second"].map((id) => ({ id, tool: "find_function", label: "Find function", status: "failed" as const, failureCode: "function_id" as const, durationMs: 0, accepted: 0, declined: 0, validationCodes: [], references: [] })),
    ],
  }],
};
const chat: ChatBackend = {
  provider: () => fake.provider(), chooseProvider: (choice) => fake.chooseProvider(choice), retirePriority: () => Promise.resolve(false),
  get: async () => history, list: async () => [{ id: history.conversation.id, title: history.conversation.title, createdAt: 1, layoutId: "encoder-sample" }],
  send: async (_ref, _request, emit) => {
    emit({ type: "start", conversationId: history.conversation.id, messageId: "user-encoder" });
    emit({ type: "presentation", presentation: history.presentations![0]! });
    emit({ type: "done", outcome: { conversationId: history.conversation.id, messageIds: ["user-encoder", "answer-encoder"], status: "complete", text: history.messages[1]!.text, proposals: [], priorities: [], provider: "codex", model: "synthetic", effort: "medium", iterations: 1, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 } } });
  },
};
const server = startServer({ port: Number(process.argv[2] ?? 4493), source: editor.source("encoder-sample", "Encoder sample"), editor, chat, token: "dev-encoder-token" });
console.log(server.url);
