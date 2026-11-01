// get_review (D-461): the newest board review as the agent acts on it — plain words, the keys by position, and a suggestion's checked ops —
// leaving out the findings BK hid and saying when the head has moved past the review.
import { describe, expect, test } from "bun:test";
import type { ModelTool } from "../../src/agent/model.ts";
import { assembleSystemPrompt } from "../../src/agent/prompt.ts";
import { createTools } from "../../src/agent/tools/index.ts";
import { createAgentPorts } from "../../src/app/agent-ports.ts";
import { applyChange, getLayout, rejectChange } from "../../src/app/index.ts";
import { createReview, dismissReviewItem, runReviewAi } from "../../src/app/review.ts";
import { findChangeSet } from "../../src/persistence/change-sets.ts";
import { invalidateReview } from "../../src/persistence/reviews.ts";
import { EMPTY_KEYS_ID, finished, proposeStep, reviewWorld, savedId, scriptedModel, submit, touch } from "../helpers/review-world.ts";

const getLayoutStep = { blocks: [{ tool: "get_layout", input: { layers: ["layer-0"] } }] };

/** A review whose agent part proposed F17 on an empty key and offered it as the suggestion for the empty-keys hint. */
async function reviewed() {
  const w = await reviewWorld();
  const { review } = createReview(w.app, w.layoutId, "manual");
  const m = scriptedModel([
    getLayoutStep,
    proposeStep,
    (seen) =>
      submit([
        {
          kind: "suggestion", code: "empty-key-use", title: "Use the empty key {key:layer-0:33}",
          body: "{key:layer-0:33} does nothing on {layer:layer-0}.", keys: [{ layerId: "layer-0", position: 33 }], layers: ["layer-0"],
          proposalId: savedId(seen.toolResults), fixes: [EMPTY_KEYS_ID],
        },
      ]),
    finished,
  ]);
  const done = await runReviewAi(w.app, review.id, m.deps);
  const suggestion = done.items.find((i) => i.kind === "suggestion");
  const tool = async () => {
    const tools = createTools(createAgentPorts(w.app, w.layoutId, null), { validation() {} } as never, { onProposal() {}, onPriority() {} });
    return String(await (tools.find((t) => t.name === "get_review") as ModelTool).run({}));
  };
  return { ...w, review: done, suggestion, tool };
}

describe("get_review", () => {
  test("says plainly when the config has no review at all", async () => {
    const w = await reviewWorld();
    const tools = createTools(createAgentPorts(w.app, w.layoutId, null), { validation() {} } as never, { onProposal() {}, onPriority() {} });
    const text = String(await (tools.find((t) => t.name === "get_review") as ModelTool).run({}));
    expect(text).toContain("has no board review yet");
    expect(createAgentPorts(w.app, w.layoutId, null).reviewFindings()).toMatchObject({ layoutId: w.layoutId, review: null });
  });

  test("gives the findings in plain words with their positions and a suggestion's checked ops", async () => {
    const w = await reviewed();
    const text = await w.tool();
    expect(w.suggestion?.proposalId).toBeTruthy();
    // Markers the screen draws are words here, so the model never parses them.
    expect(text).not.toContain("{key:");
    expect(text).not.toContain("{layer:");
    expect(text).toContain("Set F17 on Layer 0");
    expect(text).toContain("blank (left index, home row, middle, Layer 0): empty → key F17.");
    expect(text).toContain("Positions: layer-0/33");
    expect(text).toContain(`Already a checked proposal: ${w.suggestion?.proposalId}`);
    const cs = findChangeSet(w.app.db, w.suggestion?.proposalId ?? "");
    expect(cs?.status).toBe("proposed");
    for (const op of cs?.ops ?? []) expect(text).toContain(JSON.stringify(op));
  });

  test("leaves out the findings BK hid, and counts them", async () => {
    const w = await reviewed();
    dismissReviewItem(w.app, w.layoutId, EMPTY_KEYS_ID);
    const findings = createAgentPorts(w.app, w.layoutId, null).reviewFindings();
    expect(findings.review?.items.map((i) => i.id)).not.toContain(EMPTY_KEYS_ID);
    expect(findings.review?.hidden).toBe(1);
    const text = await w.tool();
    expect(text).not.toContain("2 keys do nothing");
    expect(text).toContain("1 finding BK hid is left out on purpose");
  });

  test("says the review is of an earlier version, with both revision ids, once the head moves", async () => {
    const w = await reviewed();
    const before = createAgentPorts(w.app, w.layoutId, null).reviewFindings();
    expect(before.review?.current).toBe(true);
    const head = touch(w.app, w.layoutId);
    const findings = createAgentPorts(w.app, w.layoutId, null).reviewFindings();
    expect(findings.review).toMatchObject({ current: false, revisionId: w.review.revisionId, hidden: 0 });
    expect(findings.headRevisionId).toBe(head);
    expect(findings.headRevisionId).not.toBe(findings.review?.revisionId);
    // Deterministic checks remain as historical pointers; old recommendations are no longer actionable.
    expect(findings.review?.items.map((i) => i.id)).toEqual(before.review?.items.filter((i) => i.source === "check").map((i) => i.id));
    expect(await w.tool()).toContain("It is the review of an earlier version");
  });

  test("a rejected suggestion keeps its id without ops; applying it hides the old recommendation", async () => {
    const refused = await reviewed();
    rejectChange(refused.app, refused.suggestion?.proposalId ?? "");
    const rejected = createAgentPorts(refused.app, refused.layoutId, null).reviewFindings().review?.items.find((i) => i.id === refused.suggestion?.id);
    expect(rejected?.proposal).toMatchObject({ id: refused.suggestion?.proposalId, status: "rejected", ops: null });

    const w = await reviewed();
    applyChange(w.app, w.suggestion?.proposalId ?? "");
    const findings = createAgentPorts(w.app, w.layoutId, null).reviewFindings();
    const suggestion = findings.review?.items.find((i) => i.id === w.suggestion?.id);
    expect(suggestion).toBeUndefined(); // Applying changed the snapshot, so its old recommendation is hidden.
    expect(await w.tool()).toContain("earlier version");
  });

  test("a same-head invalidation reports its reason and withholds old suggestions", async () => {
    const w = await reviewed();
    const head = getLayout(w.app, w.layoutId).revision.id;
    invalidateReview(w.app.db, w.review.id, "The keyboard reconnected. Run a fresh review.");
    const findings = createAgentPorts(w.app, w.layoutId, null).reviewFindings();
    expect(findings.headRevisionId).toBe(head);
    expect(findings.review?.revisionId).toBe(head);
    expect(findings.review?.current).toBe(false);
    expect(await w.tool()).toContain("The keyboard reconnected");
    expect(findings.review?.items.some((i) => i.kind === "suggestion")).toBe(false);
  });

  test("a review still being written reads as its checks, never as half-written agent findings", async () => {
    const w = await reviewWorld();
    const { review } = createReview(w.app, w.layoutId, "connect");
    const m = scriptedModel([getLayoutStep, proposeStep, (seen) => submit([{ kind: "suggestion", code: "empty-key-use", title: "Use the empty key {key:layer-0:33}", body: "{key:layer-0:33} does nothing.", keys: [{ layerId: "layer-0", position: 33 }], layers: ["layer-0"], proposalId: savedId(seen.toolResults), fixes: [EMPTY_KEYS_ID] }]), finished]);
    const work = runReviewAi(w.app, review.id, m.deps);
    const mid = createAgentPorts(w.app, w.layoutId, null).reviewFindings();
    expect(mid.review?.ai.status).toBe("running");
    expect(mid.review?.items.every((i) => i.source === "check")).toBe(true);
    await work;
    expect(createAgentPorts(w.app, w.layoutId, null).reviewFindings().review?.items.some((i) => i.source === "agent")).toBe(true);
  });

  test("reading changes nothing, and reads the same twice", async () => {
    const w = await reviewed();
    const head = getLayout(w.app, w.layoutId).revision.id;
    const first = createAgentPorts(w.app, w.layoutId, null).reviewFindings();
    const again = createAgentPorts(w.app, w.layoutId, null).reviewFindings();
    expect(again).toEqual(first);
    expect(getLayout(w.app, w.layoutId).revision.id).toBe(head);
    expect(findChangeSet(w.app.db, w.suggestion?.proposalId ?? "")?.status).toBe("proposed");
  });
});

describe("the system prompt", () => {
  test("names the review-fix path and the one-change rule", async () => {
    const w = await reviewed();
    const prompt = assembleSystemPrompt(getLayout(w.app, w.layoutId).board, getLayout(w.app, w.layoutId).document);
    expect(prompt).toContain("Call `get_review` before you say anything about the findings");
    expect(prompt).toContain("Make one change, not one per finding");
    expect(prompt).toContain("A review of an earlier version is a pointer, not a refusal");
    expect(prompt).toContain("- `get_review`: what the newest board review of this config found");
  });
});
