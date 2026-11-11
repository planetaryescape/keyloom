// Real App/Viewer with a long synthetic review. No database, provider, firmware or devices.
import type { ReviewResponse } from "../../src/api/review.ts";
import { startServer } from "../../src/server/start-server.ts";
import type { ReviewBackend } from "../../src/server/review-backend.ts";
import { devSample } from "../helpers/dev-sample.ts";
import { FakeEditor } from "../helpers/fake-editor-backend.ts";
import { FakeChat } from "../helpers/fake-chat-backend.ts";

const sample = await devSample();
const editor = new FakeEditor(sample);
const body = `The synthetic profile has an 80-position hold-trigger set, with positions 1 through 80 currently included. The proposed setting also changes the quick-tap term to 300 ms. This intentionally long, human-readable finding checks wrapping and sidebar scrolling without exposing serialized config or suggesting a typing outcome.`;
const show = async (ref: string): Promise<ReviewResponse> => ({
  layoutId: ref, headRevisionId: sample.revision.id, workloadActivities: [], review: {
    id: "synthetic-long-review", layoutId: ref, revisionId: sample.revision.id, trigger: "connect", checkedAt: 0,
    checks: { status: "done", summary: { layers: sample.document.layers.length, keys: 72, combos: 0 } },
    ai: { status: "done", reason: null, model: "synthetic" }, freshness: { current: true, reason: null }, fixed: [],
    items: Array.from({ length: 8 }, (_, index) => ({
      id: `synthetic-${index}`, source: "check", kind: "hint", severity: "info",
      code: "synthetic-long-review", title: index === 0 ? "Synthetic long-content overflow finding" : `Synthetic finding ${index}`,
      body: index === 0 ? body : "This synthetic source finding is long enough to wrap onto another line in the review sidebar without losing its last words.",
      keys: [], layers: [sample.document.layers[0]!.id], proposalId: null, fixes: [], dismissedAt: null,
    })),
  },
});
const review: ReviewBackend = { show, run: show, stop: show, dismiss: show, restore: show, subscribe: () => () => {} };
const server = startServer({ port: Number(process.argv[2] ?? 4518), token: "dev-editor-token", source: editor.source(), editor, chat: new FakeChat(editor, "moonlander-daily"), review });
console.log(server.url);
