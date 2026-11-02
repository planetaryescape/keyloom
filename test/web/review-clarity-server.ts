// Real App/Viewer with one validated synthetic review proposal; Apply writes only to FakeEditor memory.
import type { ProposalCard } from "../../src/api/http.ts";
import type { ReviewResponse } from "../../src/api/review.ts";
import type { ConfigsBackend } from "../../src/server/configs-backend.ts";
import type { ReviewBackend } from "../../src/server/review-backend.ts";
import { evaluate } from "../../src/validation/validate.ts";
import { startServer } from "../../src/server/start-server.ts";
import { devSample } from "../helpers/dev-sample.ts";
import { glove80, STYLE_FIXTURE } from "../helpers/zmk.ts";
import { importZmkSource } from "../../src/firmware/zmk/import.ts";
import { FakeEditor } from "../helpers/fake-editor-backend.ts";
import { FakeChat } from "../helpers/fake-chat-backend.ts";

const sample = await devSample();
const glove = await glove80();
sample.document = (await importZmkSource(STYLE_FIXTURE, glove.definition)).layout;
sample.board = glove.definition;
sample.geometry = glove.geometry;
sample.revision = { ...sample.revision, id: "rev_review_clarity" };
const profile = sample.document.holdTapProfiles[0];
if (!profile) throw new Error("Synthetic source has no tap/hold profile");
profile.options["tapping-term-ms"] = 200;
const editor = new FakeEditor(sample);
const baseLayer = sample.document.layers[0]!;
const firstBinding = baseLayer.bindings[14]!;
const secondBinding = baseLayer.bindings[15]!;
const ops: ProposalCard["ops"] = [
  { op: "upsertHoldTapProfile", profile: { ...profile, options: { ...profile.options, "tapping-term-ms": 240, "hold-trigger-key-positions": Array.from({ length: 40 }, (_, index) => index) } } },
  { op: "setBinding", at: { layerId: baseLayer.id, position: 14 }, binding: secondBinding },
  { op: "setBinding", at: { layerId: baseLayer.id, position: 15 }, binding: firstBinding },
];
const validation = evaluate(sample.board, sample.document, ops).result;
if (!validation.ok) throw new Error(`Synthetic proposal did not validate: ${validation.errors.map((issue) => issue.message).join("; ")}`);
const stored = editor.storeProposal(ops, "Synthetic review-clarity proposal", "review-clarity");
const card: ProposalCard = {
  changeSetId: stored.id, proposalGroup: stored.group, title: "Change a key and tune tap/hold settings",
  explanation: "Legacy generated prose must not replace the current/proposed comparison.", status: "proposed", ops,
  validation, tradeoffs: { gains: ["Synthetic preview"], costs: ["No runtime claim"] }, decisionDraft: null,
};
const config = {
  id: "glove80-daily", name: "Review clarity fixture", boardId: sample.board.id, boardName: sample.board.name,
  headRevisionId: sample.revision.id, createdAt: sample.revision.createdAt, updatedAt: sample.revision.createdAt,
  onKeyboard: false, archivedAt: null, copiedFrom: null,
};
const configs: ConfigsBackend = {
  list: async () => [config], proposals: async () => editor.proposalStatus(stored.id) === "proposed" ? [{ ...card, status: "proposed" }] : [],
  create: async () => { throw new Error("fixture disables config mutations"); }, rename: async () => { throw new Error("fixture disables config mutations"); },
  archive: async () => { throw new Error("fixture disables config mutations"); }, restore: async () => { throw new Error("fixture disables config mutations"); },
  remove: async () => { throw new Error("fixture disables config mutations"); }, use: async () => { throw new Error("fixture disables config mutations"); },
  versions: async () => ({ layoutId: config.id, layoutName: config.name, headRevisionId: sample.revision.id, pending: [], versions: [] }), nameVersion: async () => null, restoreVersion: async () => { throw new Error("fixture disables version mutations"); },
  compare: async () => { throw new Error("fixture has no versions"); },
};
const response = (): ReviewResponse => ({
  layoutId: "glove80-daily", headRevisionId: sample.revision.id, workloadActivities: [], review: {
    id: "review-clarity-synthetic", layoutId: "glove80-daily", revisionId: sample.revision.id,
    trigger: "manual", checkedAt: Date.now(), checks: { status: "done", summary: { layers: sample.document.layers.length, keys: sample.board.keyCount, combos: 0 } },
    ai: { status: "done", reason: null, model: "synthetic" }, freshness: { current: true, reason: null }, fixed: [],
    items: [{ id: "review-clarity-suggestion", source: "agent", kind: "suggestion", severity: "info", code: "synthetic",
      title: card.title, body: card.explanation, keys: [], layers: [], proposalId: stored.id, fixes: [], dismissedAt: null }],
  },
});
const review: ReviewBackend = { show: async () => response(), run: async () => response(), dismiss: async () => response(), restore: async () => response(), subscribe: () => () => {} };
const server = startServer({ port: Number(process.argv[2] ?? 4531), token: "dev-editor-token", source: editor.source("glove80-daily"), editor, chat: new FakeChat(editor, "glove80-daily"), configs, review });
console.log(JSON.stringify({ url: server.url, proposalId: stored.id, ops }));
