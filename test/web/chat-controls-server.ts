// Isolated two-board browser fixture. No database, credentials, jobs or physical keyboards.
import { getBoard } from "../../src/boards/registry.ts";
import { blankDocument } from "../../src/app/configs.ts";
import { startServer } from "../../src/server/start-server.ts";
import { FakeChat } from "../helpers/fake-chat-backend.ts";
import { FakeEditor } from "../helpers/fake-editor-backend.ts";
import { loadFixture } from "../server/fixture.ts";

const first = await loadFixture();
const board = getBoard("moergo/glove80");
const second = { ...first, board: board.definition, geometry: board.geometry, document: blankDocument(board.definition.id) };
const a = new FakeEditor(first);
const b = new FakeEditor(second);
const chats = [new FakeChat(a, "moonlander-daily", { tokenDelayMs: 0, stepMs: 0 }), new FakeChat(b, "glove-daily", { tokenDelayMs: 0, stepMs: 0 })];
const sources = [a.source("moonlander-daily", "Daily driver"), b.source("glove-daily", "Glove daily")];
const firstChat = chats[0];
const secondChat = chats[1];
if (!firstChat || !secondChat) throw new Error("missing chat fixtures");
const server = startServer({
  port: Number(process.argv[2] ?? 4512), token: "dev-editor-token", editor: a,
  source: { list: async () => (await Promise.all(sources.map((source) => source.list()))).flat(), get: async (id) => (await sources[0]?.get(id)) ?? (await sources[1]?.get(id)) ?? null },
  chat: {
    provider: () => firstChat.provider(), chooseProvider: (choice) => firstChat.chooseProvider(choice),
    list: async (ref) => ref === "glove-daily" ? (await secondChat.list(ref))?.map((item) => ({ ...item, id: `glove-${item.id}` })) ?? null : firstChat.list(ref),
    get: async (id) => id.startsWith("glove-") ? secondChat.get(id.slice(6)).then((detail) => detail === null ? null : { ...detail, conversation: { ...detail.conversation, id } }) : firstChat.get(id),
    retirePriority: () => firstChat.retirePriority(),
    send(ref, input, emit, signal) {
      if (ref !== "glove-daily") return firstChat.send(ref, input, emit, signal);
      const request = { ...input };
      if (request.conversationId) request.conversationId = request.conversationId.slice(6);
      return secondChat.send(ref, request, (event) => {
      if (event.type === "start") emit({ ...event, conversationId: `glove-${event.conversationId}` });
      else if (event.type === "done") emit({ ...event, outcome: { ...event.outcome, conversationId: `glove-${event.outcome.conversationId}` } });
      else emit(event);
      }, signal);
    },
  },
});
console.log(server.url);
