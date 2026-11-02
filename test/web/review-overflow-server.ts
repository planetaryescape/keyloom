// Real App/Viewer with a long synthetic review. No database, provider, firmware or devices.
import type { ReviewResponse } from "../../src/api/review.ts";
import { startServer } from "../../src/server/start-server.ts";
import type { ReviewBackend } from "../../src/server/review-backend.ts";
import { devSample } from "../helpers/dev-sample.ts";
import { FakeEditor } from "../helpers/fake-editor-backend.ts";
import { FakeChat } from "../helpers/fake-chat-backend.ts";

const sample = await devSample();
const editor = new FakeEditor(sample);
const options = { bindings: "&kp &kp", "tapping-term-ms": 200, flavor: "tap-preferred", "hold-trigger-on-release": true, "hold-trigger-key-positions": Array.from({ length: 80 }, (_, i) => i) };
const body = `Tap/hold profile synthetic_hold: ${JSON.stringify(options)} → ${JSON.stringify({ ...options, "quick-tap-ms": 300 })}. These are source settings, not proof of better rolls or chords. Source-derived change only; consult the separate runtime-test coverage.`;
const show = async (ref: string): Promise<ReviewResponse> => ({
  layoutId: ref, headRevisionId: sample.revision.id, workloadActivities: [], review: {
    id: "synthetic-long-review", layoutId: ref, revisionId: sample.revision.id, trigger: "connect", checkedAt: 0,
    checks: { status: "done", summary: { layers: sample.document.layers.length, keys: 72, combos: 0 } },
    ai: { status: "done", reason: null, model: "synthetic" }, freshness: { current: true, reason: null }, fixed: [],
    items: Array.from({ length: 8 }, (_, index) => ({
      id: `synthetic-${index}`, source: index === 0 ? "agent" : "check", kind: index === 0 ? "suggestion" : "hint", severity: "info",
      code: "synthetic-long-review", title: index === 0 ? "Review synthetic tap/hold settings" : `Synthetic finding ${index}`,
      body: index === 0 ? body : "This synthetic source finding is long enough to wrap onto another line in the review sidebar without losing its last words.",
      keys: [], layers: [sample.document.layers[0]!.id], proposalId: index === 0 ? "synthetic-proposal" : null, fixes: [], dismissedAt: null,
    })),
  },
});
const review: ReviewBackend = { show, run: show, dismiss: show, restore: show, subscribe: () => () => {} };
const server = startServer({ port: Number(process.argv[2] ?? 4518), token: "dev-editor-token", source: editor.source(), editor, chat: new FakeChat(editor, "moonlander-daily"), review });
console.log(server.url);
