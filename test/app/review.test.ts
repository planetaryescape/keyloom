// The board review's use cases (D-340): the checks stored once per revision, the agent's part with its guards, and what carries from
// one revision to the next.
import { describe, expect, test } from "bun:test";
import { applyOps, getLayout, openProposalsOutsideChat } from "../../src/app/index.ts";
import { createReview, dismissReviewItem, restoreReviewItem, runReviewAi, showReview } from "../../src/app/review.ts";
import { defaultAgentModel } from "../../src/app/chat-model.ts";
import { writeAgentConfig } from "../../src/app/agent-config.ts";
import { chooseProvider } from "../../src/app/chat-model.ts";
import { fakeCodex } from "../helpers/fake-codex.ts";
import { NO_CODEX } from "../helpers/no-credentials.ts";
import { findChangeSet } from "../../src/persistence/change-sets.ts";
import { draft } from "../helpers/ops.ts";
import { EMPTY_KEYS_ID, finished, fillKey, noModel, proposeStep, reviewWorld, savedId, scriptedModel, submit, touch } from "../helpers/review-world.ts";

const getLayoutStep = { blocks: [{ tool: "get_layout", input: { layers: ["layer-0"] } }] };

describe("the checks", () => {
  test("they are stored at once, and a revision is reviewed once", async () => {
    const w = await reviewWorld();
    const first = createReview(w.app, w.layoutId, "connect", { emit: w.emit });
    expect(first.created).toBe(true);
    expect(first.review).toMatchObject({ layoutId: w.layoutId, trigger: "connect", checks: { status: "done" }, ai: { status: "pending", reason: null, model: null }, fixed: [] });
    expect(first.review.items.map((i) => i.id)).toEqual([EMPTY_KEYS_ID]);

    const again = createReview(w.app, w.layoutId, "manual");
    expect(again.created).toBe(false);
    expect(again.review.id).toBe(first.review.id);
    expect(again.review.trigger).toBe("connect");
    expect(w.events).toEqual([{ type: "review", layoutId: w.layoutId, revisionId: first.review.revisionId, reviewId: first.review.id, aiStatus: "pending" }]);
  });

  test("showReview gives the newest review, and says when the head has moved past it", async () => {
    const w = await reviewWorld();
    expect(showReview(w.app, w.layoutId).review).toBeNull();
    const { review } = createReview(w.app, w.layoutId, "apply");
    const head = fillKey(w.app, w.layoutId, 33);
    const view = showReview(w.app, w.layoutId);
    expect(view.review?.id).toBe(review.id);
    expect(view.headRevisionId).toBe(head);
    expect(view.review?.revisionId).not.toBe(head);
  });
});

describe("hiding a finding", () => {
  test("it stays hidden on the next revision while the finding is the same, and comes back when restored", async () => {
    const w = await reviewWorld();
    createReview(w.app, w.layoutId, "apply");
    const hidden = dismissReviewItem(w.app, w.layoutId, EMPTY_KEYS_ID, () => 1234);
    expect(hidden.review?.items[0]).toMatchObject({ id: EMPTY_KEYS_ID, dismissedAt: 1234 });

    // A change that leaves both empty keys as they were: same finding, same id.
    touch(w.app, w.layoutId);
    const next = createReview(w.app, w.layoutId, "apply").review;
    expect(next.items.find((i) => i.id === EMPTY_KEYS_ID)).toMatchObject({ dismissedAt: 1234 });

    expect(restoreReviewItem(w.app, w.layoutId, EMPTY_KEYS_ID).review?.items.find((i) => i.id === EMPTY_KEYS_ID)?.dismissedAt).toBeNull();
  });

  test("an id the latest review doesn't have is not found", async () => {
    const w = await reviewWorld();
    createReview(w.app, w.layoutId, "apply");
    expect(() => dismissReviewItem(w.app, w.layoutId, "check:nothing::")).toThrow(/no item/);
  });
});

describe("what a change fixes", () => {
  test("a finding the new revision no longer produces comes back once, saying which review it was fixed since", async () => {
    const w = await reviewWorld();
    const before = createReview(w.app, w.layoutId, "apply").review;
    // Fill both empty keys: the hint about them is gone.
    fillKey(w.app, w.layoutId, 33);
    fillKey(w.app, w.layoutId, 36);
    const after = createReview(w.app, w.layoutId, "apply").review;
    expect(after.items).toEqual([]);
    expect(after.fixed).toMatchObject([{ id: EMPTY_KEYS_ID, kind: "hint", fixedSince: before.id }]);

    // The review after that has nothing to tick off.
    touch(w.app, w.layoutId);
    expect(createReview(w.app, w.layoutId, "apply").review.fixed).toEqual([]);
  });

  test("a list of empty keys that lost one key has changed, not gone", async () => {
    const w = await reviewWorld();
    createReview(w.app, w.layoutId, "apply");
    fillKey(w.app, w.layoutId, 33);
    const after = createReview(w.app, w.layoutId, "apply").review;
    expect(after.items.map((i) => i.id)).toEqual(["check:keys_do_nothing::layer-0/36"]);
    expect(after.fixed).toEqual([]);
  });

  test("a finding BK had hidden is not ticked off when it goes", async () => {
    const w = await reviewWorld();
    createReview(w.app, w.layoutId, "apply");
    dismissReviewItem(w.app, w.layoutId, EMPTY_KEYS_ID);
    fillKey(w.app, w.layoutId, 33);
    fillKey(w.app, w.layoutId, 36);
    expect(createReview(w.app, w.layoutId, "apply").review.fixed).toEqual([]);
  });
});

describe("the agent's part", () => {
  test("its suggestion is a real proposed change set outside any conversation, and nothing is applied", async () => {
    const w = await reviewWorld();
    const { review } = createReview(w.app, w.layoutId, "connect", { emit: w.emit });
    const head = getLayout(w.app, w.layoutId).revision.id;
    const m = scriptedModel([
      getLayoutStep, proposeStep,
      (seen) => submit([
        { kind: "suggestion", code: "empty-key-use", title: "Use the empty key {key:layer-0:33}", body: "{key:layer-0:33} does nothing on {layer:layer-0}.", keys: [{ layerId: "layer-0", position: 33 }], layers: ["layer-0"], proposalId: savedId(seen.toolResults), fixes: [EMPTY_KEYS_ID] },
        { kind: "hint", code: "layer-order", title: "Two layers are alike", body: "They share most keys.", layers: ["layer-0"] },
      ]),
      finished,
    ]);

    const done = await runReviewAi(w.app, review.id, m.deps, { emit: w.emit });

    expect(done.ai).toMatchObject({ status: "done", reason: null, model: m.model.model });
    const suggestion = done.items.find((i) => i.kind === "suggestion");
    expect(suggestion).toMatchObject({
      id: "agent:empty-key-use:layer-0:layer-0/33", source: "agent", severity: "info", fixes: [EMPTY_KEYS_ID], keys: [{ layerId: "layer-0", position: 33 }],
    });
    // Checks first, then the agent's.
    expect(done.items.map((i) => i.source)).toEqual(["check", "agent", "agent"]);
    const cs = findChangeSet(w.app.db, suggestion?.proposalId as string);
    expect(cs).toMatchObject({ status: "proposed", source: "agent", conversationId: null, baseRevisionId: head });
    expect(openProposalsOutsideChat(w.app, w.layoutId).map((p) => p.changeSetId)).toEqual([suggestion?.proposalId as string]);
    expect(getLayout(w.app, w.layoutId).revision.id).toBe(head);
    expect(w.events.map((e) => e.aiStatus)).toEqual(["pending", "running", "done"]);
  });

  test("a revision's agent part runs once: asking again is cached, and only force runs it again", async () => {
    const w = await reviewWorld();
    const { review } = createReview(w.app, w.layoutId, "manual");
    const m = scriptedModel([submit([]), finished, submit([{ kind: "hint", code: "second-look", title: "Seen", body: "Seen." }]), finished]);
    await runReviewAi(w.app, review.id, m.deps);
    expect(m.requests).toHaveLength(2);

    const cached = await runReviewAi(w.app, review.id, m.deps);
    expect(m.requests).toHaveLength(2);
    expect(cached.items.map((i) => i.source)).toEqual(["check"]);

    const forced = await runReviewAi(w.app, review.id, m.deps, { force: true });
    expect(m.requests).toHaveLength(4);
    expect(forced.items.map((i) => i.code)).toEqual(["keys_do_nothing", "second-look"]);
  });

  test("what the model gets wrong is dropped, not shown", async () => {
    const w = await reviewWorld();
    const { review } = createReview(w.app, w.layoutId, "manual");
    const m = scriptedModel([
      submit([
        { kind: "suggestion", code: "no-proposal", title: "Do a thing", body: "Do a thing." },
        { kind: "suggestion", code: "made-up", title: "Do another", body: "Do another.", proposalId: "cs_01MADEUP" },
        { kind: "hint", code: "keys-do-nothing", title: "Echo", body: "Echo of a check.", layers: [] },
        { kind: "problem", code: "bad-refs", title: "{layer:ghost} is odd", body: "{key:ghost:3} and {key:layer-0:900}", keys: [{ layerId: "ghost", position: 1 }, { layerId: "layer-0", position: 900 }, { layerId: "layer-0", position: 5 }], layers: ["ghost", "layer-0"] },
      ]),
      finished,
    ]);
    const done = await runReviewAi(w.app, review.id, m.deps);
    expect(done.items.filter((i) => i.source === "agent").map((i) => i.code)).toEqual(["keys-do-nothing", "bad-refs"]);
    const problem = done.items.find((i) => i.code === "bad-refs");
    expect(problem).toMatchObject({ kind: "problem", severity: "warning", title: "ghost is odd", body: "ghost and key 901 on Layer 0", keys: [{ layerId: "layer-0", position: 5 }], layers: ["layer-0"] });
  });

  test("a suggestion whose change was refused by the validator never reaches the review", async () => {
    const w = await reviewWorld();
    const { review } = createReview(w.app, w.layoutId, "manual");
    const invalid = { blocks: [{ tool: "propose_changes", input: { alternatives: [{
      title: "Nope", ops: [{ op: "setBinding", at: { layerId: "layer-9", position: 1 }, binding: { kind: "key", code: "F17" } }], explanation: "x", tradeoffs: { gains: [], costs: [] },
      decisionDraft: { goal: "g", choice: "c", reason: "r", scope: { apps: [], habits: [] } },
    }] } }] };
    const m = scriptedModel([invalid, (seen) => {
      expect(seen.toolResults.join("\n")).toContain("INVALID");
      return submit([{ kind: "suggestion", code: "bad", title: "Bad", body: "Bad.", proposalId: savedId(seen.toolResults) }]);
    }, finished]);
    const done = await runReviewAi(w.app, review.id, m.deps);
    expect(done.ai.status).toBe("done");
    expect(done.items.map((i) => i.source)).toEqual(["check"]);
    expect(openProposalsOutsideChat(w.app, w.layoutId)).toEqual([]);
  });

  test("with no model provider the status says so in words and the checks still show", async () => {
    const w = await reviewWorld();
    const { review } = createReview(w.app, w.layoutId, "connect");
    const done = await runReviewAi(w.app, review.id, noModel, { emit: w.emit });
    expect(done.ai).toMatchObject({ status: "unavailable", model: null, reason: expect.stringContaining("No model provider is set up") });
    expect(done.items.map((i) => i.id)).toEqual([EMPTY_KEYS_ID]);
    // Unavailable is a status to retry from, not the end: a later run with a model fills it in.
    const m = scriptedModel([submit([]), finished]);
    expect((await runReviewAi(w.app, review.id, m.deps)).ai.status).toBe("done");
  });

  test("a model that fails is a failed status with the provider's words, and a refusal says it was refused", async () => {
    const w = await reviewWorld();
    const { review } = createReview(w.app, w.layoutId, "manual");
    const down = scriptedModel([{ blocks: [], error: { status: 401, message: "no auth" } }]);
    const failed = await runReviewAi(w.app, review.id, down.deps);
    expect(failed.ai).toMatchObject({ status: "failed", reason: expect.stringContaining("rejected the API key") });
    expect(failed.items).toHaveLength(1);

    const refuses = scriptedModel([{ blocks: [], stop: "refusal" }]);
    const refused = await runReviewAi(w.app, review.id, refuses.deps);
    expect(refused.ai).toMatchObject({ status: "failed", reason: "The model declined to review this layout." });
  });

  test("a model that never submits is failed, not left running", async () => {
    const w = await reviewWorld();
    const { review } = createReview(w.app, w.layoutId, "manual");
    const m = scriptedModel([{ blocks: [{ text: "Looks fine to me." }] }]);
    expect((await runReviewAi(w.app, review.id, m.deps)).ai).toMatchObject({ status: "failed", reason: "The model finished without giving a review." });
  });

  test("it stops at its budget of requests, and tool calls past the budget are told to submit", async () => {
    const w = await reviewWorld();
    const { review } = createReview(w.app, w.layoutId, "manual");
    // Fifteen calls to one tool in one reply: the fifteenth is past the budget of fourteen.
    const many = { blocks: Array.from({ length: 15 }, () => ({ tool: "get_typing_findings", input: {} })) };
    const m = scriptedModel([many, (seen) => {
      expect(seen.toolResults.at(-1)).toContain("out of tool calls");
      expect(seen.toolResults.at(-2)).not.toContain("out of tool calls");
      return submit([]);
    }, finished]);
    expect((await runReviewAi(w.app, review.id, m.deps)).ai.status).toBe("done");

    const w2 = await reviewWorld();
    const r2 = createReview(w2.app, w2.layoutId, "manual").review;
    const endless = scriptedModel(Array.from({ length: 12 }, () => getLayoutStep));
    const stopped = await runReviewAi(w2.app, r2.id, endless.deps);
    expect(endless.requests).toHaveLength(10);
    expect(stopped.ai).toMatchObject({ status: "failed", reason: "The model used all its steps without finishing the review." });
  });

  test("if the layout changes while the model works, the review fails and its proposals are withdrawn", async () => {
    const w = await reviewWorld();
    const { review } = createReview(w.app, w.layoutId, "apply");
    const m = scriptedModel([proposeStep, (seen) => {
      const id = savedId(seen.toolResults);
      touch(w.app, w.layoutId);
      return submit([{ kind: "suggestion", code: "empty-key-use", title: "Use it", body: "Use it.", proposalId: id }]);
    }, finished]);
    const done = await runReviewAi(w.app, review.id, m.deps);
    expect(done.ai).toMatchObject({ status: "failed", reason: expect.stringContaining("changed while keyloom was looking") });
    expect(done.items.every((i) => i.source === "check")).toBe(true);
    expect(openProposalsOutsideChat(w.app, w.layoutId)).toEqual([]);
  });

  test("the next review withdraws the earlier one's open suggestions and carries the agent's fixed findings", async () => {
    const w = await reviewWorld();
    const first = createReview(w.app, w.layoutId, "apply").review;
    const m1 = scriptedModel([proposeStep, (seen) => submit([
      { kind: "suggestion", code: "empty-key-use", title: "Use it", body: "Use it.", proposalId: savedId(seen.toolResults), keys: [{ layerId: "layer-0", position: 33 }] },
      { kind: "hint", code: "layer-order", title: "Alike", body: "Alike.", layers: ["layer-0"] },
    ]), finished]);
    const reviewed = await runReviewAi(w.app, first.id, m1.deps);
    const proposalId = reviewed.items.find((i) => i.kind === "suggestion")?.proposalId as string;

    touch(w.app, w.layoutId);
    const second = createReview(w.app, w.layoutId, "apply").review;
    expect(findChangeSet(w.app.db, proposalId)?.status).toBe("rejected");

    const m2 = scriptedModel([submit([]), finished]);
    const done = await runReviewAi(w.app, second.id, m2.deps);
    // The suggestion goes quietly with its revision; the hint the agent no longer makes is ticked off.
    expect(done.fixed.map((f) => [f.code, f.fixedSince])).toEqual([["layer-order", first.id]]);
  });

  test("a failed look is not a fix: findings are only ticked off by an agent that finished", async () => {
    const w = await reviewWorld();
    const first = createReview(w.app, w.layoutId, "apply").review;
    await runReviewAi(w.app, first.id, scriptedModel([submit([{ kind: "hint", code: "layer-order", title: "Alike", body: "Alike." }]), finished]).deps);
    touch(w.app, w.layoutId);
    const second = createReview(w.app, w.layoutId, "apply").review;
    const done = await runReviewAi(w.app, second.id, noModel);
    expect(done.fixed).toEqual([]);
  });
});

describe("the agent repeating the checks", () => {
  test("an item about the same kind, layers and keys as a check is dropped whatever code the model gave it", async () => {
    const w = await reviewWorld();
    const { review } = createReview(w.app, w.layoutId, "manual");
    const both = [{ layerId: "layer-0", position: 36 }, { layerId: "layer-0", position: 33 }];
    const m = scriptedModel([
      submit([
        { kind: "hint", code: "empty-function-row", title: "Empty keys", body: "Two keys are empty.", keys: both, layers: [] },
        { kind: "hint", code: "one-empty-key", title: "One empty key", body: "One is empty.", keys: [both[1] as (typeof both)[number]] },
        { kind: "problem", code: "empty-keys-problem", title: "Same keys, other kind", body: "Kept.", keys: both },
      ]),
      finished,
    ]);
    const done = await runReviewAi(w.app, review.id, m.deps);
    expect(done.items.filter((i) => i.source === "agent").map((i) => i.code)).toEqual(["one-empty-key", "empty-keys-problem"]);
  });

  test("the model is given the checks with their ids and codes and told not to restate them", async () => {
    const w = await reviewWorld();
    const { review } = createReview(w.app, w.layoutId, "manual");
    const m = scriptedModel([submit([]), finished]);
    await runReviewAi(w.app, review.id, m.deps);
    const body = m.requests[0]?.body as { system: string; messages: Array<{ content: unknown }> };
    const asked = JSON.stringify(body.messages[0]?.content);
    expect(asked).toContain(EMPTY_KEYS_ID);
    expect(asked).toContain("code keys_do_nothing");
    expect(asked).toContain("do not restate");
    expect(JSON.stringify(body.system)).toContain("Never restate a check");
  });
});

describe("every proposal a run saves is shown or withdrawn", () => {
  const openIds = (w: Awaited<ReturnType<typeof reviewWorld>>) => openProposalsOutsideChat(w.app, w.layoutId).map((p) => p.changeSetId);

  test("one the model never referenced becomes a suggestion with its own title and summary, tied to the check it touches", async () => {
    const w = await reviewWorld();
    const { review } = createReview(w.app, w.layoutId, "manual");
    const m = scriptedModel([proposeStep, submit([]), finished]);
    const done = await runReviewAi(w.app, review.id, m.deps);
    const suggestion = done.items.find((i) => i.kind === "suggestion");
    expect(suggestion).toMatchObject({
      source: "agent", code: "proposed-change", title: "Put F17 on the empty key", body: "That key does nothing now.", fixes: [EMPTY_KEYS_ID], keys: [{ layerId: "layer-0", position: 33 }],
    });
    expect(openIds(w)).toEqual([suggestion?.proposalId as string]);
  });

  test("one the model did reference is not attached twice", async () => {
    const w = await reviewWorld();
    const { review } = createReview(w.app, w.layoutId, "manual");
    const m = scriptedModel([proposeStep, (seen) => submit([{ kind: "suggestion", code: "empty-key-use", title: "Use it", body: "Use it.", proposalId: savedId(seen.toolResults), keys: [{ layerId: "layer-0", position: 33 }] }]), finished]);
    const done = await runReviewAi(w.app, review.id, m.deps);
    expect(done.items.filter((i) => i.kind === "suggestion")).toHaveLength(1);
    expect(done.items.find((i) => i.kind === "suggestion")?.code).toBe("empty-key-use");
  });

  test("one that cannot be shown, because the review is full, is withdrawn and not left open", async () => {
    const w = await reviewWorld();
    const { review } = createReview(w.app, w.layoutId, "manual");
    const hints = Array.from({ length: 6 }, (_, i) => ({ kind: "hint" as const, code: `note-${i}`, title: `Note ${i}`, body: "A note.", layers: ["layer-0"], keys: [{ layerId: "layer-0", position: i }] }));
    const m = scriptedModel([proposeStep, submit(hints), finished]);
    const done = await runReviewAi(w.app, review.id, m.deps);
    expect(done.items.filter((i) => i.kind === "suggestion")).toEqual([]);
    expect(openIds(w)).toEqual([]);
  });
});


describe("why there is no model", () => {
  test("a provider that was chosen but has no key is said so, and is not 'no provider'", async () => {
    const w = await reviewWorld();
    writeAgentConfig(w.dir, { provider: "openrouter" });
    const { review } = createReview(w.app, w.layoutId, "manual");
    const env = { KEYLOOM_CODEX_BIN: NO_CODEX };
    const done = await runReviewAi(w.app, review.id, { model: () => defaultAgentModel(w.dir, {}, env) });
    expect(done.ai).toMatchObject({ status: "unavailable", reason: "OpenRouter is chosen but has no key. Set OPENROUTER_API_KEY, or choose another provider." });
  });

  test("it does what chat does: a chosen provider is not swapped for a ready one, and with nothing chosen a ready one is used", async () => {
    const w = await reviewWorld();
    const env = { KEYLOOM_CODEX_BIN: fakeCodex({ loggedIn: true }).bin };
    // Chat keeps the chosen provider even though Codex is signed in, so the review reports it rather than quietly using another.
    expect(await chooseProvider({}, { provider: "openrouter" }, env)).toBe("openrouter");
    const { review } = createReview(w.app, w.layoutId, "manual");
    writeAgentConfig(w.dir, { provider: "openrouter" });
    expect((await runReviewAi(w.app, review.id, { model: () => defaultAgentModel(w.dir, {}, env) })).ai.status).toBe("unavailable");
    // With no choice made, chat falls back to the signed-in Codex, and the review asks for the same model.
    expect(await chooseProvider({}, {}, env)).toBe("codex");
  });

  test("with nothing chosen and nothing ready it is still no provider", async () => {
    const w = await reviewWorld();
    const { review } = createReview(w.app, w.layoutId, "manual");
    const done = await runReviewAi(w.app, review.id, { model: () => defaultAgentModel(w.dir, {}, { KEYLOOM_CODEX_BIN: NO_CODEX }) });
    expect(done.ai.reason).toContain("No model provider is set up");
  });
});

describe("one finding per problem", () => {
  const layerWorld = async () => {
    const w = await reviewWorld();
    // A layer nothing reaches: the checks' layer_unreachable problem.
    applyOps(w.app, w.layoutId, { baseRevisionId: getLayout(w.app, w.layoutId).revision.id, summary: "add a layer", ops: [{ op: "addLayer", layer: { id: "spare", name: "Spare" }, afterLayerId: "layer-0" }] });
    const { review } = createReview(w.app, w.layoutId, "manual");
    return { w, review, check: review.items.find((i) => i.code === "layer_unreachable") };
  };

  test("an agent problem that names more than a check's layer is still that check, and is dropped", async () => {
    const { w, review, check } = await layerWorld();
    expect(check?.layers).toEqual(["spare"]);
    const m = scriptedModel([
      submit([
        { kind: "problem", code: "spare-key-wrong", title: "A key opens the wrong layer", body: "It points at an old layer number.", keys: [{ layerId: "layer-0", position: 5 }], layers: ["spare", "layer-1"] },
        { kind: "hint", code: "other", title: "Unrelated", body: "A hint about another layer.", layers: ["layer-1"] },
      ]),
      finished,
    ]);
    const done = await runReviewAi(w.app, review.id, m.deps);
    expect(done.items.filter((i) => i.source === "agent").map((i) => i.code)).toEqual(["other"]);
  });

  test("of two suggestions for one problem the one with fewer warnings, then the smaller change, stays; the other's change set is withdrawn", async () => {
    const { w, review, check } = await layerWorld();
    const alt = (title: string, positions: number[]) => ({
      title, ops: positions.map((position) => ({ op: "setBinding", at: { layerId: "layer-0", position }, binding: { kind: "key", code: "F17" } })),
      explanation: `${title}.`, tradeoffs: { gains: [], costs: [] }, decisionDraft: draft(),
    });
    const both = { blocks: [{ tool: "propose_changes", input: alt("Big fix", [33, 36]) }, { tool: "propose_changes", input: alt("Small fix", [33]) }] };
    const m = scriptedModel([both, (seen) => {
      const ids = [...seen.toolResults.join("\n").matchAll(/"([^"]+)": saved as (cs_\w+)/g)].map((x) => [x[1], x[2]]);
      const id = (t: string) => ids.find((x) => x[0] === t)?.[1] as string;
      return submit([
        { kind: "suggestion", code: "big", title: "Big fix", body: "Big.", proposalId: id("Big fix"), fixes: [check?.id as string] },
        { kind: "suggestion", code: "small", title: "Small fix", body: "Small.", proposalId: id("Small fix"), fixes: [check?.id as string] },
        { kind: "suggestion", code: "elsewhere", title: "Fixes nothing in particular", body: "Kept.", proposalId: id("Big fix") },
      ]);
    }, finished]);
    const done = await runReviewAi(w.app, review.id, m.deps);
    expect(done.items.filter((i) => i.kind === "suggestion").map((i) => i.code)).toEqual(["small", "elsewhere"]);
    const open = openProposalsOutsideChat(w.app, w.layoutId).map((p) => p.title);
    // Big fix is still shown by the suggestion that fixes nothing in particular, so only a proposal no item shows is withdrawn.
    expect(open.sort()).toEqual(["Big fix", "Small fix"]);
  });

  test("the prompt asks for one fix per problem", async () => {
    const { w, review } = await layerWorld();
    const m = scriptedModel([submit([]), finished]);
    await runReviewAi(w.app, review.id, m.deps);
    expect(JSON.stringify((m.requests[0]?.body as { system: string }).system)).toContain("One fix per problem");
  });
});

describe("a withdrawn duplicate", () => {
  test("its change set is rejected when no kept item shows it", async () => {
    const w = await reviewWorld();
    applyOps(w.app, w.layoutId, { baseRevisionId: getLayout(w.app, w.layoutId).revision.id, summary: "add a layer", ops: [{ op: "addLayer", layer: { id: "spare", name: "Spare" }, afterLayerId: "layer-0" }] });
    const { review } = createReview(w.app, w.layoutId, "manual");
    const check = review.items.find((i) => i.code === "layer_unreachable")?.id as string;
    const alt = (title: string, positions: number[]) => ({
      title, ops: positions.map((position) => ({ op: "setBinding", at: { layerId: "layer-0", position }, binding: { kind: "key", code: "F17" } })),
      explanation: `${title}.`, tradeoffs: { gains: [], costs: [] }, decisionDraft: draft(),
    });
    const m = scriptedModel([{ blocks: [{ tool: "propose_changes", input: alt("Big fix", [33, 36]) }, { tool: "propose_changes", input: alt("Small fix", [33]) }] }, (seen) => {
      const ids = [...seen.toolResults.join("\n").matchAll(/"([^"]+)": saved as (cs_\w+)/g)].map((x) => [x[1], x[2]]);
      return submit([
        { kind: "suggestion", code: "big", title: "Big", body: "Big.", proposalId: ids.find((x) => x[0] === "Big fix")?.[1] as string, fixes: [check] },
        { kind: "suggestion", code: "small", title: "Small", body: "Small.", proposalId: ids.find((x) => x[0] === "Small fix")?.[1] as string, fixes: [check] },
      ]);
    }, finished]);
    await runReviewAi(w.app, review.id, m.deps);
    expect(openProposalsOutsideChat(w.app, w.layoutId).map((p) => p.title)).toEqual(["Small fix"]);
  });
});

describe("a suggestion the model left without fixes", () => {
  test("still fixes the checks its change touches", async () => {
    const w = await reviewWorld();
    const { review } = createReview(w.app, w.layoutId, "manual");
    const m = scriptedModel([proposeStep, (seen) => submit([{ kind: "suggestion", code: "use-it", title: "Use it", body: "Use it.", proposalId: savedId(seen.toolResults) }]), finished]);
    const done = await runReviewAi(w.app, review.id, m.deps);
    expect(done.items.find((i) => i.code === "use-it")?.fixes).toEqual([EMPTY_KEYS_ID]);
  });
});

describe("a run that stops at its limit", () => {
  test("after saving a valid proposal it is done, with that suggestion attached and the reason in words", async () => {
    const w = await reviewWorld();
    const { review } = createReview(w.app, w.layoutId, "manual");
    const m = scriptedModel([proposeStep, ...Array.from({ length: 12 }, () => getLayoutStep)]);
    const done = await runReviewAi(w.app, review.id, m.deps);
    expect(m.requests).toHaveLength(10);
    expect(done.ai).toMatchObject({ status: "done", reason: "Stopped at its step limit; showing what it found." });
    const suggestion = done.items.find((i) => i.kind === "suggestion");
    expect(suggestion).toMatchObject({ code: "proposed-change", title: "Put F17 on the empty key", fixes: [EMPTY_KEYS_ID] });
    expect(openProposalsOutsideChat(w.app, w.layoutId).map((p) => p.changeSetId)).toEqual([suggestion?.proposalId as string]);
  });

  test("it is failed, with nothing left open, when it saved nothing usable", async () => {
    const w = await reviewWorld();
    const { review } = createReview(w.app, w.layoutId, "manual");
    const m = scriptedModel(Array.from({ length: 12 }, () => getLayoutStep));
    const done = await runReviewAi(w.app, review.id, m.deps);
    expect(done.ai.status).toBe("failed");
    expect(openProposalsOutsideChat(w.app, w.layoutId)).toEqual([]);
  });

  test("two proposals for one problem leave one, as in a run that finished", async () => {
    const w = await reviewWorld();
    const { review } = createReview(w.app, w.layoutId, "manual");
    const alt = (title: string, positions: number[]) => ({
      title, ops: positions.map((position) => ({ op: "setBinding", at: { layerId: "layer-0", position }, binding: { kind: "key", code: "F17" } })),
      explanation: `${title}.`, tradeoffs: { gains: [], costs: [] }, decisionDraft: draft(),
    });
    const both = { blocks: [{ tool: "propose_changes", input: alt("Big fix", [33, 36]) }, { tool: "propose_changes", input: alt("Small fix", [33]) }] };
    const done = await runReviewAi(w.app, review.id, scriptedModel([both, ...Array.from({ length: 12 }, () => getLayoutStep)]).deps);
    expect(done.ai.status).toBe("done");
    expect(done.items.filter((i) => i.kind === "suggestion").map((i) => i.title)).toEqual(["Small fix"]);
    expect(openProposalsOutsideChat(w.app, w.layoutId).map((p) => p.title)).toEqual(["Small fix"]);
  });
});
