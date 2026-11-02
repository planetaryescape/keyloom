// Persisted synthetic source finding and the real App-backed routes on assigned port 4531.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { openApp, importLayout, getLayout, ReviewEngine } from "../../src/app/index.ts";
import { createLayout } from "../../src/persistence/layouts.ts";
import { optionOnlyOnS } from "../helpers/option-option.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { draft } from "../helpers/ops.ts";
import { fakeAnthropic, type SeenRequest } from "../helpers/fake-anthropic.ts";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { appChatBackend } from "../../src/cli/chat-backend.ts";
import { appEditorBackend } from "../../src/cli/editor-backend.ts";
import { appLayoutSource } from "../../src/cli/serve.ts";
import { appReviewBackend } from "../../src/cli/review-backend.ts";
import { startServer } from "../../src/server/start-server.ts";
import { noModel } from "../helpers/review-world.ts";

const evidence = process.argv[2];
if (!evidence) throw new Error("Pass the coordinator-assigned evidence directory");
process.env.ANTHROPIC_API_KEY = "synthetic-review-repair-test-key";
mkdirSync(evidence, { recursive: true });
const dataDir = join(evidence, `persisted-review-repair-data-${process.pid}`);
mkdirSync(dataDir, { recursive: true });
const app = openApp({ dataDir });
const imported = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "Synthetic repair journey" });
const initial = getLayout(app, imported.layoutId);
const document = optionOnlyOnS(initial.document);
// Keep exactly one actionable blank key; the opposite-hand neighbor is an intentional synthetic binding.
document.layers[0]!.bindings[36] = { kind: "key", code: "F18" };
createLayout(app.db, { name: "Scoped repair journey", layout: document, summary: "Synthetic source review fixture", origin: "import", selectFirst: false });
// SAFETY: createLayout inserts this unique test name, so the lookup returns its persisted id.
const layoutId = app.db.query("SELECT id FROM layouts WHERE name = 'Scoped repair journey'").get() as { id: string };
app.db.query("UPDATE board_config SET layout_id = ? WHERE board_id = ?").run(layoutId.id, document.boardId);
const engine = new ReviewEngine(app, noModel, { quietMs: 0, tickMs: 600_000 });
await engine.review(layoutId.id, "manual", { force: true }).done;
let repairCalls = 0;
const Messages = z.array(z.object({ role: z.string(), content: z.unknown() }));
const Content = z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string().optional() }))]);
const script = async (seen: SeenRequest) => {
  const messages = Messages.parse(seen.body.messages);
  const userMessages = messages.filter((message) => message.role === "user");
  const text = userMessages.map((message) => {
    const content = Content.parse(message.content);
    return Array.isArray(content) ? content.map((block) => block.text ?? "").join("\n") : content;
  }).filter(Boolean).at(-1) ?? "";
    if (!text.startsWith("Please investigate this board-review finding")) {
      if (text.includes("lifecycle ordinary send")) await new Promise((resolve) => setTimeout(resolve, 2_000));
      return { blocks: [{ text: "I checked the current request." }] };
    }
    repairCalls++;
    if (repairCalls === 1) return { blocks: [{ tool: "get_review", input: {} }] };
    if (repairCalls === 2) return { blocks: [{ tool: "propose_changes", input: { alternatives: [{
      title: "Put F17 on the empty key", ops: [{ op: "setBinding", at: { layerId: "layer-0", position: 33 }, binding: { kind: "key", code: "F17" } }],
      explanation: "The left empty key now types F17.", tradeoffs: { gains: ["One more key works"], costs: [] },
      decisionDraft: draft({ goal: "Repair the selected empty-key finding", choice: "Put F17 on the left empty key", reason: "You asked to repair this review finding." }),
    }] } }] };
    return { blocks: [{ text: "The selected empty key now types F17." }] };
};
const fake = fakeAnthropic([script, script, script, script]);
const server = startServer({
  port: 4531, token: "review-repair-synthetic-token", source: appLayoutSource(app),
  editor: appEditorBackend(app), chat: appChatBackend(app, { model: anthropicModel(fake.client) }),
  review: appReviewBackend(engine),
});
  console.log(JSON.stringify({ url: server.url, layoutId: layoutId.id, dataDir, stateFile: join(dataDir, "keyloom.db") }));
process.on("SIGINT", () => { server.stop(); app.db.close(); process.exit(0); });
process.on("SIGTERM", () => { server.stop(); app.db.close(); process.exit(0); });
