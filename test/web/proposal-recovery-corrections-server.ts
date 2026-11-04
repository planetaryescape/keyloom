// Synthetic App/domain proof for the three accepted review corrections. No sync engine or hardware.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, importLayout, getLayout, sendMessage, proposeChange, applyChange, applyOps } from "../../src/app/index.ts";
import { toCard } from "../../src/app/proposal-card.ts";
import { findChangeSet } from "../../src/persistence/change-sets.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { draft, setKey } from "../helpers/ops.ts";
import { fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { appChatBackend } from "../../src/cli/chat-backend.ts";
import { appEditorBackend } from "../../src/cli/editor-backend.ts";
import { appLayoutSource } from "../../src/cli/serve.ts";
import { startServer } from "../../src/server/start-server.ts";
import cardHtml from "./proposal-recovery-corrections.html";

const evidence = process.argv[2]; const mode = process.argv[3] ?? "app";
if (!evidence || !["app", "cards"].includes(mode)) throw new Error("Pass assigned evidence directory and app|cards");
mkdirSync(evidence, { recursive: true });
const dataDir = join(evidence, `correction-${mode}-data-${process.pid}`);
const app = openApp({ dataDir });
const { layoutId } = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "Synthetic question recovery" });
let stop: () => void;
if (mode === "app") {
  process.env.ANTHROPIC_API_KEY = "synthetic-correction-test-key";
  const alternative = { title: "Revised F17 after the hand answer", ops: setKey(33, "F17"), explanation: "Put F17 on the selected index key; preserve its neighbor.", tradeoffs: { gains: ["F17 on the selected key"], costs: [] }, decisionDraft: draft() };
  const fake = fakeAnthropic([
    { blocks: [{ tool: "ask_user", input: { question: "Which hand do you prefer?", considerations: ["The target should be comfortable."], step: { n: 1, of: 1 }, options: [{ label: "Left" }, { label: "Right" }] } }] },
    { blocks: [{ tool: "propose_changes", input: { alternatives: [{ ...alternative, title: "Refused after the hand answer", ops: setKey(33, "F17", "missing-target") }] } }] },
    { blocks: [{ text: "The target was refused by validation." }] },
    { blocks: [{ text: "Unrelated request about colors acknowledged." }] },
    { blocks: [{ tool: "get_layout", input: {} }] },
    { blocks: [{ tool: "propose_changes", input: { alternatives: [alternative] } }] },
    { blocks: [{ text: "Ready for preview; not applied." }] },
  ]);
  const model = anthropicModel(fake.client);
  const first = await sendMessage(app, layoutId, { message: "Distinctive original F17 goal: put F17 on my index finger", model });
  if (!first.question) throw new Error("Fixture did not create a real question");
  const server = startServer({ port: 4531, token: "correction-synthetic-token", source: appLayoutSource(app), editor: appEditorBackend(app), chat: appChatBackend(app, { model }) });
  stop = server.stop;
  await Bun.write(join(evidence, "correction-fixture-app.json"), JSON.stringify({ pid: process.pid, dataDir, layoutId, first }, null, 2));
  console.log(JSON.stringify({ mode, pid: process.pid, url: server.url }));
} else {
  const before = getLayout(app, layoutId);
  const added = proposeChange(app, layoutId, { source: "agent", title: "Applied synthetic addLayer", explanation: "Add an unused layer for later editing.", ops: [{ op: "addLayer", layer: { id: "correction-target", name: "Correction target" }, afterLayerId: before.document.layers.at(-1)!.id }] });
  applyChange(app, added.id);
  const history = getLayout(app, layoutId);
  const appliedCard = toCard(findChangeSet(app.db, added.id)!);
  const pending = proposeChange(app, layoutId, { source: "agent", title: "F17 on removed target layer", explanation: "Give the unused target F17.", ops: setKey(33, "F17", "correction-target") });
  applyOps(app, layoutId, { baseRevisionId: history.revision.id, ops: [{ op: "removeLayer", layerId: "correction-target" }], summary: "Remove unused synthetic target" });
  const missingLayer = getLayout(app, layoutId);
  // Replace every copy: a native still present on another layer is correctly treated as moved, not lost.
  const nativeOps = missingLayer.document.layers.flatMap((layer) => layer.bindings.flatMap((binding, position) => binding.kind === "native" && binding.source === "OSM(MOD_LSFT)" ? setKey(position, "F17", layer.id) : []));
  const native = proposeChange(app, layoutId, { source: "agent", title: "Replace synthetic custom key with F17", explanation: "Replace the imported custom key deliberately.", ops: nativeOps });
  applyOps(app, layoutId, { baseRevisionId: missingLayer.revision.id, ops: setKey(57, "F20"), summary: "Advance the synthetic native target to F20" });
  const invalidNative = getLayout(app, layoutId);
  const snapshots = {
    board: history.board.definition,
    applied: { proposal: appliedCard, layout: history.document },
    missing: { proposal: toCard(findChangeSet(app.db, pending.id)!), layout: missingLayer.document },
    confirmation: { proposal: toCard(findChangeSet(app.db, native.id)!), before: missingLayer.document, after: invalidNative.document },
  };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 4531, routes: { "/": cardHtml, "/snapshots": () => Response.json(snapshots) } });
  stop = () => server.stop(true);
  await Bun.write(join(evidence, "correction-fixture-cards.json"), JSON.stringify({ pid: process.pid, dataDir, layoutId, revisions: { history: history.revision.id, missingLayer: missingLayer.revision.id, invalidNative: invalidNative.revision.id } }, null, 2));
  console.log(JSON.stringify({ mode, pid: process.pid, url: "http://127.0.0.1:4531" }));
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stop(); app.db.close(); process.exit(0); });
