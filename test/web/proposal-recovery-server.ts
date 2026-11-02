// Synthetic persisted App only. No discovery, sync engine, hardware or real model.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, importLayout, getLayout, sendMessage, applyOps, listConfigs, openProposalsOutsideChat } from "../../src/app/index.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { draft, setKey } from "../helpers/ops.ts";
import { fakeAnthropic, type ScriptStep } from "../helpers/fake-anthropic.ts";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { appChatBackend } from "../../src/cli/chat-backend.ts";
import { appEditorBackend } from "../../src/cli/editor-backend.ts";
import { appLayoutSource } from "../../src/cli/serve.ts";
import { startServer } from "../../src/server/start-server.ts";

const evidence = process.argv[2];
if (!evidence) throw new Error("Pass assigned evidence directory");
process.env.ANTHROPIC_API_KEY = "synthetic-recovery-test-key";
mkdirSync(evidence, { recursive: true });
const dataDir = join(evidence, `proposal-recovery-data-${process.pid}`);
const app = openApp({ dataDir });
const refused = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "Refused synthetic goal" });
const stale = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "Stale synthetic goal" });
function proposal(layerId: string, title: string): ScriptStep { return { blocks: [{ tool: "propose_changes", input: { alternatives: [{ title, ops: setKey(33, "F17", layerId), explanation: "Give the selected key F17; replace the synthetic conflicting F19 if present and keep its neighbor.", tradeoffs: { gains: ["F17 on the selected key"], costs: ["Replaces synthetic F19 when present"] }, decisionDraft: draft({ goal: "Distinctive original F17 goal" }) }] } }] }; }
const fake = fakeAnthropic([
  proposal("synthetic-missing-layer", "Rejected missing target"), { blocks: [{ text: "Validation refused this proposal." }] },
  proposal("layer-0", "Distinctive saved F17 proposal"), { blocks: [{ text: "Ready for preview." }] },
  { blocks: [{ text: "Unrelated later request acknowledged." }] },
  ...Array.from({ length: 12 }, (): ScriptStep[] => [{ blocks: [{ tool: "get_layout", input: {} }] }, proposal("layer-0", "Revised F17 proposal"), { blocks: [{ text: "Ready to preview; not applied." }] }]).flat(),
]);
const model = anthropicModel(fake.client);
const refusal = await sendMessage(app, refused.layoutId, { message: "Distinctive original refusal goal: F17 for my left index", model });
const saved = await sendMessage(app, stale.layoutId, { message: "Distinctive original stale goal: F17 for my left index", model });
await sendMessage(app, stale.layoutId, { message: "Unrelated later request about colors", conversationId: saved.conversationId, model });
applyOps(app, stale.layoutId, { baseRevisionId: getLayout(app, stale.layoutId).revision.id, ops: setKey(33, "F19"), summary: "Synthetic conflicting edit" });
const unsupported = (): never => { throw new Error("Outside this synthetic proof fixture"); };
const server = startServer({ port: 4531, token: "proposal-recovery-synthetic-token", source: appLayoutSource(app), editor: appEditorBackend(app), chat: appChatBackend(app, { model }), configs: {
  list: async (opts) => listConfigs(app, { includeArchived: opts.includeArchived }), proposals: async (ref) => openProposalsOutsideChat(app, ref),
  create: unsupported, rename: unsupported, archive: unsupported, restore: unsupported, remove: unsupported, use: unsupported, versions: unsupported, nameVersion: unsupported, restoreVersion: unsupported, compare: unsupported,
} });
await Bun.write(join(evidence, "fixture.json"), JSON.stringify({ pid: process.pid, dataDir, refused, stale, refusal, saved }, null, 2));
console.log(JSON.stringify({ pid: process.pid, url: server.url, dataDir }));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { server.stop(); app.db.close(); process.exit(0); });
