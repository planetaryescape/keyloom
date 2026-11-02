// Real review hook and panel, synthetic HTTP only. Serve with Bun's HTML imports; no model, device or app data.
import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ReviewEvent, ReviewResponse } from "../../src/api/review.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { ReviewPanel, ReviewMarker } from "../../src/web/review/ReviewPanel.tsx";
import { useReview, type Review } from "../../src/web/review/useReview.ts";
import "../../src/web/tokens.css";
import "../../src/web/app.css";
import "../../src/web/shell/shell.css";

const layout: Layout = { schemaVersion: 1, boardId: "zsa/moonlander", firmware: "qmk", layers: [{ id: "base", name: "Base", bindings: [{ kind: "key", code: "A" }] }], macros: [], combos: [], tapDances: [], conditionalLayers: [], holdTapProfiles: [], settings: [], passthrough: [] };
const response = (status: "done" | "running" = "done", layoutId = "lay"): ReviewResponse => ({
  layoutId, headRevisionId: "rev", review: {
    id: `review-${layoutId}`, layoutId, revisionId: "rev", trigger: "connect", checkedAt: Date.now(),
    checks: { status: "done", summary: { layers: 1, keys: 4, combos: 0 } },
    ai: { status, model: "synthetic", reason: null }, freshness: { current: true, reason: null }, fixed: [],
    items: [{ id: "finding", source: "check", code: "test-finding", kind: "hint", severity: "info", title: `Finding for ${layoutId}`, body: "Synthetic source finding.", keys: [], layers: [layout.layers[0]!.id], fixes: [], proposalId: null, dismissedAt: null }],
  },
});
const pending: { path: string; method: string; finish: (result: ReviewResponse) => void; fail: () => void }[] = [];
globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(String(input), location.origin).pathname;
  if (!path.includes("/review")) return Response.json({}, { status: 404 });
  // Deliberately ignore abort: the client must also reject superseded responses at publication.
  return new Promise<Response>((resolve) => pending.push({ path, method: init?.method ?? "GET", finish: (result) => resolve(Response.json(result)), fail: () => resolve(Response.json({ error: "Synthetic failure" }, { status: 500 })) }));
}, { preconnect: globalThis.fetch.preconnect });
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
let current: Review;
let sendEvent: (event: ReviewEvent) => void;
let chooseLayout: (id: string) => void;
let chooseHead: (id: string) => void;
let runningChecks = false;
const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
const take = () => { const next = pending.shift(); if (!next) throw new Error("Expected a pending request"); return next; };
const panel = () => document.querySelector(".br-panel")!;
const locked = () => {
  check(panel().getAttribute("aria-busy") === "true", "Review did not enter loading");
  check(panel().querySelectorAll("button").length === 1, "Previous result controls remain usable");
  check(!panel().textContent?.includes("Finding for"), "Previous findings remain visible");
};
async function runChecks() {
  if (runningChecks) return;
  runningChecks = true;
  const output = document.querySelector("output")!;
  try {
    locked();
    take().fail(); await frame();
    check(document.querySelector(".br-marker")?.textContent?.includes("Review unavailable") === true, "Initial failure has no openable marker");
    check(panel().querySelector(".spin") === null, "Failed read still claims to be running");
    Array.from(panel().querySelectorAll("button")).find((button) => button.textContent === "Try loading again")!.click(); await frame();
    take().finish(response()); await frame();
    check(panel().textContent?.includes("Finding for lay") === true, "Finished results not shown");
    const activity = panel().querySelector<HTMLInputElement>('.br-activities input')!;
    activity.click();
    const hiding = current.dismiss("finding"); await frame();
    check(panel().textContent?.includes("Finding for lay") === true, "Dismissal replaced results with loading");
    check(panel().querySelector('.br-activities input') === activity && activity.checked, "Dismissal unmounted the activity draft");
    take().finish(response()); await hiding; await frame();
    const manual = current.run(true); await frame(); locked();
    const post = take();
    check(post.method === "POST", "Rerun did not submit");
    // The event and GET finish while the initiating POST remains outstanding.
    sendEvent({ type: "review", layoutId: "lay", revisionId: "rev", reviewId: "review-lay", aiStatus: "running" }); await frame(); locked();
    take().finish(response("running")); await frame(); locked();
    sendEvent({ type: "review", layoutId: "lay", revisionId: "rev", reviewId: "review-lay", aiStatus: "done" }); await frame(); locked();
    take().finish(response()); await frame();
    // Release the superseded POST only after the newer done event has been read.
    // Its running response must not replace the finished snapshot.
    post.finish(response("running")); await manual; await frame();
    check(panel().textContent?.includes("Finding for lay") === true, "Late POST replaced the completed review");
    current.reload(); await frame(); const oldGet = take();
    current.reload(); await frame(); take().finish(response()); await frame();
    oldGet.finish(response("running")); await frame();
    check(panel().textContent?.includes("Finding for lay") === true, "Late GET restored an old running snapshot");
    sendEvent({ type: "review", layoutId: "foreign", revisionId: "rev", reviewId: "foreign-review", aiStatus: "running" }); await frame();
    check(pending.length === 0 && panel().textContent?.includes("Finding for lay") === true, "A foreign event hid or reloaded settled results");
    chooseLayout("other"); await frame(); locked();
    take().finish(response("done", "other")); await frame();
    check(panel().textContent?.includes("Finding for other") === true, "Config switch retained the old review");
    sendEvent({ type: "review", layoutId: "other", revisionId: "rev", reviewId: "review-other", aiStatus: "running" }); await frame(); locked();
    take().fail(); await frame();
    check(panel().querySelector('[role="alert"]') !== null, "Fetch failure did not explain the failure");
    check(!panel().textContent?.includes("Finding for"), "Fetch failure unlocked the previous review");
    check(panel().querySelector(".spin") === null, "Fetch failure kept the running spinner");
    sendEvent({ type: "review", layoutId: "foreign", revisionId: "rev", reviewId: "foreign-review", aiStatus: "done" }); await frame();
    check(pending.length === 0 && !panel().textContent?.includes("Finding for"), "A foreign event released a failed refresh lock");
    current.reload(); await frame(); take().finish(response("done", "other")); await frame();
    check(panel().textContent?.includes("Finding for other") === true, "Retry did not recover the completed review");
    chooseHead("rev-next"); await frame(); locked(); take().fail(); await frame();
    const retry = Array.from(panel().querySelectorAll("button")).find((button) => button.textContent === "Try loading again");
    check(retry !== undefined && panel().querySelector(".spin") === null, "Head-change failure has no read-only retry");
    retry!.click(); await frame();
    const retryRequest = take(); check(retryRequest.method === "GET", "Read retry started a model run");
    const next = response("done", "other"); next.headRevisionId = "rev-next"; next.review!.revisionId = "rev-next";
    retryRequest.finish(next); await frame();
    check(panel().textContent?.includes("Finding for other") === true, "Head-change retry did not restore current findings");
    output.textContent = "PASS: initial read failure/retry, dismissal draft retention, manual refresh, event-before-GET lockout, running lockout, late POST/GET rejection, foreign-event isolation, config switch, failed refresh lock, head-change read retry.";
  } catch (error) { output.textContent = `FAIL: ${error instanceof Error ? error.message : String(error)}`; }
}
function Harness() {
  const [event, setEvent] = useState<ReviewEvent | null>(null);
  const [id, setId] = useState("lay");
  const [head, setHead] = useState("rev");
  const review = useReview("synthetic", id, head, event);
  useLayoutEffect(() => { current = review; sendEvent = setEvent; chooseLayout = setId; chooseHead = setHead; });
  return <main style={{ padding: 16, maxWidth: 520, margin: "auto", height: "100dvh", display: "flex", flexDirection: "column", gap: 12 }}>
    <header><button onClick={() => void runChecks()}>Run regression checks</button><ReviewMarker review={review} open onToggle={() => {}} /></header>
    <ReviewPanel token="synthetic" review={review} layout={layout} rows={{}} boardName="Moonlander" configName="Daily" proposals={[]} pinnedId={null} onPin={() => {}} onApply={async () => {}} onShowLayer={() => {}} onFixIssues={() => {}} onClose={() => {}} />
    <output>Ready · synthetic data only</output>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
