// Computer Use fixture: real Viewer, ChatPanel/useChat, durable app, tool and ack endpoint.
// No sync engine, hardware transports, credentials or external model. All mutations are refused.
// bun test/web/open-view-server.ts [port] [task-owned-scratch-directory]
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openApp, importLayout, listConfigs, versionHistory, compareRevision } from "../../src/app/index.ts";
import { emptyUsage, type AgentModel, type ModelMessage } from "../../src/agent/model.ts";
import { appChatBackend } from "../../src/cli/chat-backend.ts";
import { appLayoutSource } from "../../src/cli/serve.ts";
import { appDecisionsBackend } from "../../src/cli/decisions-backend.ts";
import { startServer } from "../../src/server/start-server.ts";
import { FakeEditor } from "../helpers/fake-editor-backend.ts";
import { FakeChat } from "../helpers/fake-chat-backend.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { drainAgentRuns } from "../../src/app/agent-runs.ts";

const dir = process.argv[3] ?? mkdtempSync(join(tmpdir(), "keyloom-D-open-view-"));
const app = openApp({ dataDir: dir });
await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "Synthetic view fixture" });
await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "Synthetic second config" });
const source = appLayoutSource(app);
const first = (await source.list())[0];
if (!first) throw new Error("Missing fixture config");
const detail = await source.get(first.id);
if (!detail) throw new Error("Missing fixture layout");
const fake = new FakeEditor({ ...detail, upgrade: detail.upgrade ?? null });
const provider = new FakeChat(fake, first.id);
await provider.chooseProvider({ provider: "anthropic", model: "synthetic-open-view" });
const model: AgentModel = {
  provider: "anthropic", model: "synthetic-open-view", effort: "medium", classifyError: () => null,
  async run(request) {
    const text = request.messages.at(-1)?.content.flatMap((block) => block.type === "text" ? [block.text] : []).join(" ").toLowerCase() ?? "";
    if (text.includes("delay")) await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException("Stopped", "AbortError")); };
      const timer = setTimeout(() => { request.signal?.removeEventListener("abort", abort); resolve(); }, 1500);
      request.signal?.addEventListener("abort", abort, { once: true });
    });
    const view = text.includes("lab") ? "lab" : text.includes("decision") ? "decisions" : text.includes("setting") ? "settings" : "history";
    const result = String(await request.tools.find((tool) => tool.name === "open_view")?.run({ view }));
    const parsed = JSON.parse(result);
    const words = parsed.status === "unavailable" ? `Could not open ${view}: ${parsed.reason}.` : `${view} ${parsed.status === "already-open" ? "was already open" : "opened"}.`;
    const messages: ModelMessage[] = [
      { role: "assistant", content: [{ type: "tool_use", id: "synthetic-view", name: "open_view", input: { view } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "synthetic-view", content: result }] },
      { role: "assistant", content: [{ type: "text", text: words }] },
    ];
    return { messages, stopReason: "end_turn", iterations: 1, usage: emptyUsage() };
  },
};
const forbidden = async (): Promise<never> => { throw new Error("D fixture refuses mutations and recording"); };
const backend = appChatBackend(app, { model });
const decisions = appDecisionsBackend(app);
const server = startServer({
  port: Number(process.argv[2] ?? 0), source, token: "synthetic-D-view", chat: { ...backend, provider: () => provider.provider(), chooseProvider: forbidden },
  editor: new Proxy(fake, { get(target, property, receiver) {
    if (["apply", "applyChangeSet", "undo", "build", "flash", "delete", "rename"].includes(String(property))) return forbidden;
    const value: unknown = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  } }),
  decisions: { ...decisions, update: forbidden, retire: forbidden, answer: forbidden },
  configs: {
    list: async (opts) => listConfigs(app, { ...(opts.board === undefined ? {} : { board: opts.board }), includeArchived: opts.includeArchived }),
    versions: async (ref) => versionHistory(app, ref), compare: async (ref, target) => compareRevision(app, ref, target), proposals: async () => [],
    create: forbidden, rename: forbidden, archive: forbidden, restore: forbidden, remove: forbidden, use: forbidden, nameVersion: forbidden, restoreVersion: forbidden,
  },
  lab: { passages: async () => ({ passages: [], canRecord: false, why: "Synthetic fixture: recording is disabled" }), sessions: async () => [], start: forbidden, stop: forbidden, cancel: forbidden, readout: forbidden, analyse: forbidden, remove: forbidden },
});
console.log(JSON.stringify({ url: server.url, dataDir: dir, configId: first.id, pid: process.pid }));
process.on("SIGTERM", () => { server.stop(); void drainAgentRuns(app).then(() => { app.db.close(); process.exit(0); }); });
