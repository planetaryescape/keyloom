import { expect, test } from "bun:test";
import type { AgentModel, ModelMessage, ModelRequest } from "../../src/agent/model.ts";
import { emptyUsage } from "../../src/agent/model.ts";
import { answerAgentRun, cancelAgentRun, drainAgentRuns, inspectAgentRun, savedRunOutcome, startAgentRun, waitForAgentRun } from "../../src/app/agent-runs.ts";
import { applyChange, getLayout, listLayouts, showDecision, proposeChange } from "../../src/app/index.ts";
import { newConfig } from "../../src/app/configs.ts";
import { recordPriority } from "../../src/app/decisions.ts";
import { findRun } from "../../src/persistence/agent-runs.ts";
import { getBoardConfig } from "../../src/persistence/configs.ts";
import { listConversationChangeSets } from "../../src/persistence/change-sets.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { optionOptionApp } from "../helpers/option-option.ts";
import { draft } from "../helpers/ops.ts";

const done = { messages: [] as ModelMessage[], stopReason: "end_turn", iterations: 1, usage: emptyUsage() };
const question = { question: "Keep layer access under the thumb?", considerations: ["The source prefers left-hand access; the target reserves its outer thumb."], options: [{ label: "Inner thumb", recommended: true }, { label: "Index finger" }], step: { n: 1, of: 1 } };

async function fixture() {
  const { app, layoutId } = await optionOptionApp();
  const target = newConfig(app, { name: "Existing Glove80", from: "blank", board: "moergo/glove80" });
  recordPriority(app, layoutId, { priorityKind: "frequent", statement: "Keep layer access in my left hand", subject: { functions: ["layer:layer-1"] }, sourceMessageIds: [] });
  recordPriority(app, target.id, { priorityKind: "pinned", statement: "Reserve the outer thumb for Space", subject: { functions: ["key:SPACE"] }, sourceMessageIds: [] });
  return { app, layoutId, target };
}

function scripted(sourceId: string, beforeAnswer?: (request: ModelRequest) => Promise<void>) {
  let first: string | undefined;
  let seed: ChangeOp[] = [];
  let calls = 0;
  const model: AgentModel = { provider: "anthropic", model: "synthetic-copy", effort: "high", classifyError: () => null, async run(request) {
    calls++;
    const tool = (name: string) => { const found = request.tools.find((value) => value.name === name); if (!found) throw new Error(name); return found; };
    if (calls === 1) {
      const input = { from: sourceId, board: "moergo/glove80", name: "Adapted copy" };
      const result = await tool("put_config").run(input);
      await expect(tool("propose_changes").run({})).rejects.toThrow(/Not run/);
      return { ...done, messages: [{ role: "assistant", content: [{ type: "tool_use", id: "copy", name: "put_config", input }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "copy", content: result }] }] };
    }
    expect(request.system).toContain("Keep layer access in my left hand");
    expect(request.system).toContain("Reserve the outer thumb for Space");
    expect(request.system).toContain("Existing target preference config");
    if (calls === 2) seed = JSON.parse(request.system.split("Translated seed (not applied or proposed): ")[1] ?? "{}").ops;
    else await beforeAnswer?.(request);
    const input = { title: "Adapted setup with reachable layers", ops: seed, explanation: "Preserve access with the target thumb constraints.", tradeoffs: { gains: ["Layer access stays reachable"], costs: ["Placement is a comfort hypothesis"] }, decisionDraft: draft({ reason: calls === 2 ? "Source access and target outer-thumb preference" : "BK chose Inner thumb; retain the source and target reasons" }), ...(first === undefined ? {} : { supersedes: first }) };
    const output = await tool("propose_changes").run(input);
    const id = output.match(/cs_[0-9A-HJKMNP-TV-Z]{26}/)?.[0];
    if (!id) throw new Error(output);
    first ??= id;
    const messages: ModelMessage[] = [{ role: "assistant", content: [{ type: "tool_use", id: `proposal-${calls}`, name: "propose_changes", input }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: `proposal-${calls}`, content: output }] }];
    if (calls === 2) { request.onPause?.(); return { ...done, stopReason: "awaiting_answer", pending: { id: "target-question", name: "ask_user", input: question }, messages: [...messages, { role: "assistant", content: [{ type: "tool_use", id: "target-question", name: "ask_user", input: question }] }] }; }
    return { ...done, messages };
  } };
  return model;
}

test("whole-config copy owns its proposal, question, answer lineage and applied decision; originals and selection survive", async () => {
  const { app, layoutId, target } = await fixture();
  const original = getLayout(app, layoutId);
  const targetHead = getLayout(app, target.id).revision.id;
  const model = scripted(layoutId);
  const request = { version: 1 as const, requestId: "copy-once", layoutRef: layoutId, input: { message: "Adapt my complete setup to the Glove80" } };
  try {
    const source = await startAgentRun(app, request, { model });
    const finished = await waitForAgentRun(app, source.id);
    expect(finished.status).toBe("completed");
    const handoff = finished.handoff;
    if (!handoff) throw new Error("missing handoff");
    const child = await waitForAgentRun(app, handoff.runId);
    expect(child.status).toBe("waiting_user");
    expect(child.conversationId).toBe(handoff.conversationId);
    expect(findRun(app.db, child.id)?.layout_id).toBe(handoff.layoutId);
    const proposed = savedRunOutcome(app, child.id);
    expect(proposed.proposals).toHaveLength(1);
    expect(proposed.question?.refines).toBe(proposed.proposals[0]?.changeSetId);
    expect(listConversationChangeSets(app.db, source.conversationId)).toHaveLength(0);
    expect((await startAgentRun(app, request, { model })).handoff).toEqual(handoff);
    const answered = await answerAgentRun(app, child.id, "copy-answer", { toolUseId: "target-question", text: "Inner thumb" }, { model });
    await waitForAgentRun(app, answered.id);
    expect((await answerAgentRun(app, child.id, "copy-answer", { toolUseId: "target-question", text: "Inner thumb" }, { model })).id).toBe(answered.id);
    const revision = savedRunOutcome(app, answered.id).proposals[0];
    if (!revision) throw new Error("missing revision");
    const applied = applyChange(app, revision.changeSetId);
    const remembered = showDecision(app, applied.decisionId ?? "missing");
    expect(remembered.layoutId).toBe(handoff.layoutId);
    expect(remembered.reason).toContain("Inner thumb");
    expect(remembered.sourceMessageIds).toContain(source.userMessageId);
    expect(remembered.sourceMessageIds).toContain(answered.userMessageId);
    expect(getLayout(app, layoutId).document).toEqual(original.document);
    expect(getLayout(app, layoutId).revision.id).toBe(original.revision.id);
    expect(getLayout(app, target.id).revision.id).toBe(targetHead);
    expect(getBoardConfig(app.db, target.boardId)).toBe(target.id);
    expect(listLayouts(app).filter((layout) => layout.name === "Adapted copy")).toHaveLength(1);
  } finally { await drainAgentRuns(app); app.db.close(); }
});

test("a first config on the target board stays unselected; receipt failure rolls back accepted child too", async () => {
  const { app, layoutId } = await optionOptionApp();
  let fail = true;
  const model: AgentModel = { provider: "anthropic", model: "synthetic", effort: "high", classifyError: () => null, async run(request) {
    const put = request.tools.find((tool) => tool.name === "put_config");
    if (fail) {
      app.db.exec("CREATE TRIGGER fail_copy_receipt BEFORE INSERT ON agent_effects BEGIN SELECT RAISE(ABORT, 'copy receipt failed'); END");
      await expect(put?.run({ from: layoutId, board: "moergo/glove80", name: "Atomic copy" })).rejects.toThrow("copy receipt failed");
      app.db.exec("DROP TRIGGER fail_copy_receipt");
      expect(listLayouts(app).some((layout) => layout.name === "Atomic copy")).toBe(false);
      expect(app.db.query("SELECT id FROM agent_runs").all()).toHaveLength(1);
      fail = false;
      await put?.run({ from: layoutId, board: "moergo/glove80", name: "Atomic copy" });
    }
    return done;
  } };
  try {
    const run = await startAgentRun(app, { version: 1, requestId: "atomic-copy", layoutRef: layoutId, input: { message: "Copy" } }, { model });
    const source = await waitForAgentRun(app, run.id);
    if (source.handoff) await waitForAgentRun(app, source.handoff.runId);
    expect(getBoardConfig(app.db, "moergo/glove80")).toBeUndefined();
    expect(listLayouts(app).filter((layout) => layout.name === "Atomic copy")).toHaveLength(1);
  } finally { await drainAgentRuns(app); app.db.close(); }
});

test("Stop after receipt cancels deferred child without executing its provider", async () => {
  const { app, layoutId } = await optionOptionApp();
  let calls = 0;
  const model: AgentModel = { provider: "anthropic", model: "synthetic", effort: "high", classifyError: () => null, async run(request) {
    calls++;
    await request.tools.find((tool) => tool.name === "put_config")?.run({ from: layoutId, board: "moergo/glove80", name: "Stopped copy" });
    cancelAgentRun(app, "stop-copy");
    return done;
  } };
  try {
    const run = await startAgentRun(app, { version: 1, requestId: "stop-copy", layoutRef: layoutId, input: { message: "Copy" } }, { model });
    const source = await waitForAgentRun(app, run.id);
    expect(source.status).toBe("cancelled");
    if (!source.handoff) throw new Error("lost receipt");
    expect(inspectAgentRun(app, source.handoff.runId).status).toBe("cancelled");
    expect(calls).toBe(1);
    expect(listLayouts(app).some((layout) => layout.id === source.handoff?.layoutId)).toBe(true);
  } finally { await drainAgentRuns(app); app.db.close(); }
});

test("synthetic unmatched layer access adapts using both sets of preferences rather than copying the default placement", async () => {
  const { copyAdaptationApp } = await import("../helpers/copy-adaptation.ts");
  const { app, sourceId, targetId, preview } = copyAdaptationApp();
  expect(preview.placements.length).toBeGreaterThan(0);
  expect(preview.placements[0]?.candidates[0]?.target).toBe(39);
  let calls = 0;
  const model: AgentModel = { provider: "anthropic", model: "synthetic-preferences", effort: "high", classifyError: () => null, async run(request) {
    const tool = (name: string) => { const result = request.tools.find((value) => value.name === name); if (!result) throw new Error(name); return result; };
    if (++calls === 1) { await tool("put_config").run({ from: sourceId, board: "foostan/corne", name: "Smaller adapted setup" }); return done; }
    expect(request.system).toContain("my right hand uses the mouse");
    expect(request.system).toContain("Reserve the inner left thumb for Space");
    const seed = JSON.parse(request.system.split("Translated seed (not applied or proposed): ")[1] ?? "{}").ops as ChangeOp[];
    const ops: ChangeOp[] = seed.map((op) => op.op === "setBinding" && (op.binding.kind === "layer" || (op.binding.kind === "holdTap" && "layerId" in op.binding.hold)) ? { ...op, binding: { kind: "none" } } : op);
    ops.push({ op: "setBinding", at: { layerId: "base", position: 38 }, binding: { kind: "key", code: "SPACE" } }, { op: "setBinding", at: { layerId: "base", position: 37 }, binding: { kind: "layer", action: "momentary", layerId: "navigation" } });
    const result = await tool("propose_changes").run({ title: "Left middle thumb navigation, inner thumb Space", explanation: "The mouse hand stays free and Space retains the inner thumb.", ops, tradeoffs: { gains: ["Preserves both preferences"], costs: ["Thumb comfort remains a hypothesis"] }, decisionDraft: draft({ reason: "Left hand navigation while the right uses the mouse; reserve the inner thumb for Space" }) });
    expect(result).toContain("saved as cs_");
    return done;
  } };
  let failure: unknown;
  const execute = model.run;
  model.run = async (request) => { try { return await execute(request); } catch (error) { failure = error; throw error; } };
  try {
    const run = await startAgentRun(app, { version: 1, requestId: "preferences", layoutRef: targetId, input: { message: "Adapt the whole source setup" } }, { model });
    const source = await waitForAgentRun(app, run.id);
    if (!source.handoff) throw new Error("no handoff");
    await waitForAgentRun(app, source.handoff.runId);
    if (failure) throw failure;
    const proposal = listConversationChangeSets(app.db, source.handoff.conversationId)[0];
    if (!proposal) throw new Error("no proposal");
    applyChange(app, proposal.id);
    const final = getLayout(app, source.handoff.layoutId).document;
    expect(final.layers).toHaveLength(2);
    expect(final.layers[0]?.bindings[38]).toEqual({ kind: "key", code: "SPACE" });
    expect(final.layers[0]?.bindings[37]).toEqual({ kind: "layer", action: "momentary", layerId: "navigation" });
  } finally { await drainAgentRuns(app); app.db.close(); }
});

for (const moved of ["source", "target"] as const) test(`a ${moved} edit while the target question waits uses the correct head; invalid revision preserves its proposal`, async () => {
  const { app, layoutId } = await fixture();
  let expectedNote = false;
  let childConversation = "";
  const model = scripted(layoutId, async (request) => {
    expect(JSON.stringify(request.messages).includes("The layout changed after your last reply began")).toBe(expectedNote);
    const previous = listConversationChangeSets(app.db, childConversation).find((value) => value.status === "proposed");
    if (!previous) throw new Error("missing current target proposal");
    const tool = request.tools.find((value) => value.name === "propose_changes");
    const result = await tool?.run({ title: "Invalid revision", explanation: "Refused target revision", ops: [{ op: "setBinding", at: { layerId: "missing-layer", position: 0 }, binding: { kind: "key", code: "A" } }], tradeoffs: { gains: [], costs: [] }, decisionDraft: draft(), supersedes: previous.id });
    expect(result).toContain("INVALID");
    expect(listConversationChangeSets(app.db, childConversation).find((value) => value.id === previous.id)?.status).toBe("proposed");
  });
  try {
    const source = await startAgentRun(app, { version: 1, requestId: `moved-${moved}`, layoutRef: layoutId, input: { message: "Copy" } }, { model });
    const completed = await waitForAgentRun(app, source.id);
    if (!completed.handoff) throw new Error("missing handoff");
    const child = await waitForAgentRun(app, completed.handoff.runId);
    childConversation = child.conversationId;
    const ref = moved === "source" ? layoutId : completed.handoff.layoutId;
    const edit = proposeChange(app, ref, { source: "agent", ...(moved === "source" ? { conversationId: source.conversationId } : {}), explanation: "Edited style while waiting", ops: [{ op: "setLayerStyle", layerId: moved === "source" ? "layer-0" : "base", shortLabel: "B", color: 2 }] });
    applyChange(app, edit.id);
    expect(inspectAgentRun(app, child.id).status).toBe("waiting_user");
    expectedNote = moved === "target";
    const answer = await answerAgentRun(app, child.id, `answer-${moved}`, { toolUseId: "target-question", text: "Inner thumb" }, { model });
    await waitForAgentRun(app, answer.id);
    expect(savedRunOutcome(app, answer.id).proposals).toHaveLength(1);
    expect(listConversationChangeSets(app.db, child.conversationId).filter((value) => value.status === "superseded")).toHaveLength(1);
  } finally { await drainAgentRuns(app); app.db.close(); }
});

test("Stop during target work and an explicit retry continue the same copied config", async () => {
  const { app, layoutId } = await fixture();
  const started = Promise.withResolvers<void>();
  let calls = 0;
  const model: AgentModel = { provider: "anthropic", model: "synthetic-retry", effort: "high", classifyError: () => null, async run(request) {
    if (++calls === 1) { await request.tools.find((tool) => tool.name === "put_config")?.run({ from: layoutId, board: "moergo/glove80", name: "Retry existing copy" }); return done; }
    expect(request.system).toContain("Keep layer access in my left hand");
    if (calls === 2) {
      started.resolve();
      await new Promise<void>((_resolve, reject) => request.signal?.addEventListener("abort", () => reject(new Error("stopped target")), { once: true }));
    }
    return done;
  } };
  try {
    const source = await startAgentRun(app, { version: 1, requestId: "retry-source", layoutRef: layoutId, input: { message: "Copy" } }, { model });
    const completed = await waitForAgentRun(app, source.id);
    await started.promise;
    if (!completed.handoff) throw new Error("missing handoff");
    cancelAgentRun(app, source.id);
    expect((await waitForAgentRun(app, completed.handoff.runId)).status).toBe("cancelled");
    const continued = await startAgentRun(app, { version: 1, requestId: "retry-target", layoutRef: completed.handoff.layoutId, input: { conversationId: completed.handoff.conversationId, message: "Continue adapting the copied setup" } }, { model });
    expect((await waitForAgentRun(app, continued.id)).status).toBe("completed");
    expect(listLayouts(app).filter((layout) => layout.name === "Retry existing copy")).toHaveLength(1);
    expect(continued.conversationId).toBe(completed.handoff.conversationId);
  } finally { await drainAgentRuns(app); app.db.close(); }
});

test("a process interrupted after copy receipt leaves source and target inspectable without automatic replay", async () => {
  const { app, layoutId, dir } = await optionOptionApp();
  const root = new URL("../../", import.meta.url).pathname;
  const script = `import {openApp} from ${JSON.stringify(root + "src/app/index.ts")};
    import {startAgentRun} from ${JSON.stringify(root + "src/app/agent-runs.ts")};
    const app=openApp({dataDir:${JSON.stringify(dir)}});
    const model={provider:'anthropic',model:'synthetic',effort:'high',classifyError:()=>null,run:async(r)=>{await r.tools.find(t=>t.name==='put_config').run({from:${JSON.stringify(layoutId)},board:'moergo/glove80',name:'Interrupted copied config'});process.exit(0);}};
    await startAgentRun(app,{version:1,requestId:'interrupted-copy',layoutRef:${JSON.stringify(layoutId)},input:{message:'Copy then interrupt'}},{model});`;
  try {
    const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    const source = inspectAgentRun(app, "interrupted-copy");
    expect(source.status).toBe("interrupted");
    if (!source.handoff) throw new Error("lost copy receipt");
    expect(inspectAgentRun(app, source.handoff.runId).status).toBe("interrupted");
    const prior = listLayouts(app).length;
    const noExecute: AgentModel = { provider: "anthropic", model: "synthetic", effort: "high", classifyError: () => null, run: async () => { throw new Error("must not execute inspection"); } };
    expect((await startAgentRun(app, { version: 1, requestId: "interrupted-copy", layoutRef: layoutId, input: { message: "Copy then interrupt" } }, { model: noExecute })).handoff).toEqual(source.handoff);
    expect(listLayouts(app)).toHaveLength(prior);
  } finally { app.db.close(); }
});

for (const route of ["durable", "legacy"] as const) test(`an applied copy permits an explicit new copy request in the same conversation (${route})`, async () => {
  const { sendMessage } = await import("../../src/app/index.ts");
  const { app, layoutId } = await fixture();
  try {
    const source = await startAgentRun(app, { version: 1, requestId: `decided-copy-${route}`, layoutRef: layoutId, input: { message: "Copy" } }, { model: scripted(layoutId) });
    const finished = await waitForAgentRun(app, source.id);
    if (!finished.handoff) throw new Error("missing first handoff");
    const handoff = finished.handoff;
    await waitForAgentRun(app, handoff.runId);
    const original = savedRunOutcome(app, handoff.runId).proposals[0];
    if (!original) throw new Error("missing original proposal");
    applyChange(app, original.changeSetId);
    if (route === "durable") app.db.query("UPDATE agent_runs SET request_json = json_remove(request_json, '$.copyContext.provenance') WHERE id = ?").run(handoff.runId);
    let calls = 0;
    let failure: unknown;
    const model: AgentModel = { provider: "anthropic", model: "synthetic-new-task", effort: "high", classifyError: () => null, async run(request) {
      try {
        if (++calls === 1) {
          expect(request.system).toContain("# Earlier copy provenance (read-only)");
          expect(request.system).toContain("Keep layer access in my left hand");
          expect(request.system).not.toContain("Do not make another config or call put_config");
          expect(request.system).not.toContain("Translated seed (not applied or proposed)");
          await request.tools.find((tool) => tool.name === "put_config")?.run({ from: layoutId, board: "foostan/corne", name: `Second requested copy ${route}` });
        } else {
          const text = request.messages[0]?.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
          expect(text?.startsWith("Now put my source on the Corne as a separate new config")).toBe(true);
        }
        return done;
      } catch (error) { failure = error; throw error; }
    } };
    const next = route === "legacy"
      ? await sendMessage(app, handoff.layoutId, { conversationId: handoff.conversationId, message: "Now put my source on the Corne as a separate new config", model })
      : await (async () => {
        const run = await startAgentRun(app, { version: 1, requestId: `new-copy-${route}`, layoutRef: handoff.layoutId, input: { conversationId: handoff.conversationId, message: "Now put my source on the Corne as a separate new config" } }, { model });
        await waitForAgentRun(app, run.id);
        if (failure) throw failure;
        return savedRunOutcome(app, run.id);
      })();
    if (failure) throw failure;
    expect(next.handoff).toBeDefined();
    if (!next.handoff) throw new Error("new user task did not hand off");
    await waitForAgentRun(app, next.handoff.runId);
    expect(listLayouts(app).filter((layout) => layout.name === `Second requested copy ${route}`)).toHaveLength(1);
    expect(next.conversationId).toBe(handoff.conversationId);
  } finally { await drainAgentRuns(app); app.db.close(); }
});

for (const route of ["durable", "legacy"] as const) test(`an answer cannot make another copy even when Apply occurs during that answer (${route})`, async () => {
  const { sendMessage } = await import("../../src/app/index.ts");
  const { app, layoutId } = await fixture();
  try {
    const source = await startAgentRun(app, { version: 1, requestId: `answer-boundary-${route}`, layoutRef: layoutId, input: { message: "Copy" } }, { model: scripted(layoutId) });
    const finished = await waitForAgentRun(app, source.id);
    if (!finished.handoff) throw new Error("missing handoff");
    await waitForAgentRun(app, finished.handoff.runId);
    const original = savedRunOutcome(app, finished.handoff.runId).proposals[0];
    if (!original) throw new Error("no original proposal");
    let blocked = false;
    let createBlocked = 0;
    const model: AgentModel = { provider: "anthropic", model: "synthetic-answer", effort: "high", classifyError: () => null, async run(request) {
      applyChange(app, original.changeSetId);
      try { await request.tools.find((tool) => tool.name === "put_config")?.run({ from: layoutId, board: "foostan/corne", name: "Unrequested recursive copy" }); }
      catch (error) { blocked = error instanceof Error && error.message.includes("Continue adapting this config"); }
      for (const from of ["this", "blank"]) {
        try { await request.tools.find((tool) => tool.name === "create_config")?.run({ name: "Unrequested created config", from }); }
        catch (error) { if (error instanceof Error && error.message.includes("Continue adapting this config")) createBlocked++; }
      }
      return done;
    } };
    if (route === "legacy") await sendMessage(app, finished.handoff.layoutId, { conversationId: finished.handoff.conversationId, answer: { toolUseId: "target-question", text: "Inner thumb" }, model });
    else {
      const answered = await answerAgentRun(app, finished.handoff.runId, `answer-copy-${route}`, { toolUseId: "target-question", text: "Inner thumb" }, { model });
      await waitForAgentRun(app, answered.id);
    }
    expect(blocked).toBe(true);
    expect(createBlocked).toBe(2);
    expect(listLayouts(app).some((layout) => layout.name === "Unrequested recursive copy" || layout.name === "Unrequested created config")).toBe(false);
  } finally { await drainAgentRuns(app); app.db.close(); }
});


test("an applied copy keeps ordinary config creation available for a later request", async () => {
  const { sendMessage } = await import("../../src/app/index.ts");
  const { app, layoutId } = await fixture();
  try {
    const source = await startAgentRun(app, { version: 1, requestId: "later-create", layoutRef: layoutId, input: { message: "Copy" } }, { model: scripted(layoutId) });
    const completed = await waitForAgentRun(app, source.id);
    if (!completed.handoff) throw new Error("missing handoff");
    await waitForAgentRun(app, completed.handoff.runId);
    const proposal = savedRunOutcome(app, completed.handoff.runId).proposals[0];
    if (!proposal) throw new Error("missing proposal");
    applyChange(app, proposal.changeSetId);
    const model: AgentModel = { provider: "anthropic", model: "synthetic-create", effort: "high", classifyError: () => null, async run(request) {
      await request.tools.find((tool) => tool.name === "create_config")?.run({ name: "Later ordinary config", from: "this" });
      return done;
    } };
    const outcome = await sendMessage(app, completed.handoff.layoutId, { conversationId: completed.handoff.conversationId, message: "Make a separate config from this setup", model });
    expect(outcome.status).toBe("complete");
    expect(listLayouts(app).filter((layout) => layout.name === "Later ordinary config")).toHaveLength(1);
  } finally { await drainAgentRuns(app); app.db.close(); }
});
