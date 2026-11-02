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
import { retargetLayerHold } from "../../src/layout/behavior-facts.ts";

const sample = await devSample();
const glove = await glove80();
sample.document = (await importZmkSource(STYLE_FIXTURE, glove.definition)).layout;
sample.board = glove.definition;
sample.geometry = glove.geometry;
sample.document.layers[1]!.name = "Navigation";
sample.document.layers[1]!.shortLabel = "MAG";
sample.document.layers[2]!.name = "Numbers";
sample.document.layers[2]!.shortLabel = "MAG";
sample.document.passthrough.push({ firmware: "zmk", file: "glove80.keymap", anchor: "behavior:magic", source: "magic: magic_hold_tap { compatible = \"zmk,behavior-hold-tap\"; #binding-cells = <2>; bindings = <&mo>, <&bootloader>; };", refersToLayerIndices: false });
sample.document.layers[0]!.bindings[74] = { kind: "native", firmware: "zmk", source: "&magic 1 0", label: "Magic", layerRefs: [{ start: 7, end: 8, layerId: sample.document.layers[1]!.id }] };
sample.revision = { ...sample.revision, id: "rev_review_clarity" };
const profile = sample.document.holdTapProfiles[0];
if (!profile) throw new Error("Synthetic source has no tap/hold profile");
profile.options["tapping-term-ms"] = 200;
const editor = new FakeEditor(sample);
const baseLayer = sample.document.layers[0]!;
const firstBinding = baseLayer.bindings[14]!;
const secondBinding = baseLayer.bindings[15]!;
const profileOps: ProposalCard["ops"] = [
  { op: "upsertHoldTapProfile", profile: { ...profile, options: { ...profile.options, "tapping-term-ms": 240, "hold-trigger-key-positions": Array.from({ length: 40 }, (_, index) => index) } } },
  { op: "setBinding", at: { layerId: baseLayer.id, position: 14 }, binding: secondBinding },
  { op: "setBinding", at: { layerId: baseLayer.id, position: 15 }, binding: firstBinding },
];
const comboOps: ProposalCard["ops"] = [{ op: "upsertCombo", combo: { id: "save-shortcut", name: "Save shortcut", positions: [0, 3], layerIds: "all", output: { kind: "key", code: "S", mods: ["LCTL"] }, timeoutMs: 45 } }];
const nativeOps = retargetLayerHold(sample.document, { layerId: baseLayer.id, position: 74 }, sample.document.layers[2]!.id).ops;
const cards: ProposalCard[] = [];
for (const [title, ops, group] of [
  ["Change a key and tune tap/hold settings", profileOps, "review-clarity-profile"],
  ["Create the Save shortcut combo", comboOps, "review-clarity-combo"],
  ["Retarget the Magic hold layer", nativeOps, "review-clarity-native"],
] as const) {
  const validation = evaluate(sample.board, sample.document, ops).result;
  if (!validation.ok) throw new Error(`Synthetic ${title} proposal did not validate: ${validation.errors.map((issue) => issue.message).join("; ")}`);
  const stored = editor.storeProposal(ops, title, group);
  cards.push({ changeSetId: stored.id, proposalGroup: stored.group, title, explanation: "Legacy generated prose must not replace the current/proposed comparison.", status: "proposed", ops, validation, tradeoffs: { gains: ["Synthetic preview"], costs: ["No runtime claim"] }, decisionDraft: null });
}
const [card] = cards;
if (!card) throw new Error("Synthetic review fixture failed to create its profile proposal");
const config = {
  id: "glove80-daily", name: "Review clarity fixture", boardId: sample.board.id, boardName: sample.board.name,
  headRevisionId: sample.revision.id, createdAt: sample.revision.createdAt, updatedAt: sample.revision.createdAt,
  onKeyboard: false, archivedAt: null, copiedFrom: null,
};
const configs: ConfigsBackend = {
  list: async () => [config], proposals: async () => cards.flatMap((proposal) => editor.proposalStatus(proposal.changeSetId) === "proposed" ? [{ ...proposal, status: "proposed" }] : []),
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
    items: cards.map((proposal, index) => ({ id: `review-clarity-suggestion-${index}`, source: "agent", kind: "suggestion", severity: "info", code: "synthetic",
      title: proposal.title, body: proposal.explanation, keys: [], layers: [], proposalId: proposal.changeSetId, fixes: [], dismissedAt: null })),
  },
});
const review: ReviewBackend = { show: async () => response(), run: async () => response(), dismiss: async () => response(), restore: async () => response(), subscribe: () => () => {} };
const server = startServer({ port: Number(process.argv[2] ?? 4531), token: "dev-editor-token", source: editor.source("glove80-daily"), editor, chat: new FakeChat(editor, "glove80-daily"), configs, review });
console.log(JSON.stringify({ url: server.url, proposals: cards.map(({ changeSetId, title, ops }) => ({ changeSetId, title, ops })) }));
