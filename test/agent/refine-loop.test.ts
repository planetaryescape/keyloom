// The refine loop (D-452): one best proposal first, questions that refine it, answers that revise it and set the old one aside, and the
// decision the last proposal writes. A scripted model behind the real SDK, the real app and database; nothing reaches a network.
import { describe, expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { codexModel } from "../../src/agent/codex-model.ts";
import { type ChatEvent, applyChange, getLayout, listChanges, listDecisions, sendMessage, showConversation } from "../../src/app/index.ts";
import { listMessages } from "../../src/persistence/conversations.ts";
import { commandShiftApp } from "../helpers/command-shift.ts";
import { fakeAnthropic, type ScriptStep } from "../helpers/fake-anthropic.ts";
import { fakeCodex } from "../helpers/fake-codex.ts";
import { draft } from "../helpers/ops.ts";
import { ANSWER_1, ANSWER_2, QUICK_REQUEST, REQUEST, lastSaved, quickScript, refineScript } from "../helpers/refine-journey.ts";
import { SKIPPED_ANSWER } from "../../src/app/question-skip.ts";
import { tempDir } from "../helpers/tmp.ts";

const status = (app: Parameters<typeof listChanges>[0], layoutId: string) =>
  Object.fromEntries(listChanges(app, layoutId, {}).map((cs) => [cs.title, cs.status]));

describe("the refine journey, through the app", () => {
  test("one proposal and question 1 of 2, a revision that supersedes it and question 2 of 2, then the final proposal whose decision carries both answers", async () => {
    const { app, layoutId } = await commandShiftApp();
    const { client, requests } = fakeAnthropic(refineScript());
    const model = anthropicModel(client);

    // Turn 1: the proposal is saved in an earlier reply than the question, so it is on the board when the question appears.
    const events: ChatEvent[] = [];
    const first = await sendMessage(app, layoutId, { message: REQUEST, model, onEvent: (e) => events.push(e) });
    expect(first.status).toBe("awaiting_answer");
    expect(first.proposals).toHaveLength(1);
    expect(first.proposals[0]).toMatchObject({ title: "Command–Shift where Tab is", status: "proposed", supersedes: null });
    expect(events.map((e) => e.type).indexOf("proposal")).toBeLessThan(events.map((e) => e.type).indexOf("done"));
    expect(first.question).toMatchObject({
      step: { n: 1, of: 2 }, question: "Can X, C and V move one place left?", answer: null,
      considerations: ["Cut, copy and paste sit under the same hand as the new key.", "Moving them is the cost of using Tab's place."],
    });
    // The model sent the recommended option second; BK sees it first and it is the only one marked.
    expect(first.question?.options.map((o) => [o.label, o.recommended])).toEqual([["Yes, they can move", true], ["No, keep them where they are", undefined]]);
    const p1 = first.proposals[0]?.changeSetId ?? "";

    // Turn 2: the answer revises the proposal. The old one is superseded in the same step and the new one says what it replaced.
    const events2: ChatEvent[] = [];
    const second = await sendMessage(app, layoutId, {
      conversationId: first.conversationId, answer: { toolUseId: first.question?.toolUseId ?? "", text: ANSWER_1 }, model, onEvent: (e) => events2.push(e),
    });
    expect(second.status).toBe("awaiting_answer");
    expect(second.proposals).toHaveLength(1);
    expect(second.proposals[0]).toMatchObject({ title: "Command–Shift on the F16 key", supersedes: p1, status: "proposed" });
    expect(events2.find((e) => e.type === "proposal")).toMatchObject({ proposal: { supersedes: p1 } });
    expect(second.question?.step).toEqual({ n: 2, of: 2 });
    expect(status(app, layoutId)).toEqual({ "Command–Shift where Tab is": "superseded", "Command–Shift on the F16 key": "proposed" });
    const p2 = second.proposals[0]?.changeSetId ?? "";

    // Turn 3: the last answer gives the final proposal; no more questions.
    const third = await sendMessage(app, layoutId, {
      conversationId: first.conversationId, answer: { toolUseId: second.question?.toolUseId ?? "", text: ANSWER_2 }, model,
    });
    expect(third.status).toBe("complete");
    expect(third.question).toBeUndefined();
    expect(third.proposals[0]).toMatchObject({ supersedes: p2 });
    expect(requests).toHaveLength(7);
    const open = listChanges(app, layoutId, { status: "proposed" });
    expect(open.map((cs) => cs.id)).toEqual([third.proposals[0]?.changeSetId ?? ""]);

    // A reload says the same: the chain, the statuses and the answered questions.
    const shown = showConversation(app, first.conversationId);
    expect(shown.proposals.map((p) => [p.status, p.supersedes === null ? null : p.supersedes === p1 ? "p1" : "p2"])).toEqual([["superseded", null], ["superseded", "p1"], ["proposed", "p2"]]);
    expect(shown.messages.flatMap((m) => (m.question === undefined ? [] : [m.question.answer]))).toEqual([ANSWER_1, ANSWER_2]);

    // Applying writes one decision, from the final draft, linked to BK's request and to both answers.
    const before = listDecisions(app, layoutId, { kind: "choice" }).length;
    const applied = applyChange(app, third.proposals[0]?.changeSetId ?? "");
    const decisions = listDecisions(app, layoutId, { kind: "choice" });
    expect(decisions).toHaveLength(before + 1);
    const decision = decisions.find((d) => d.id === applied.decisionId);
    expect(decision?.reason).toContain("X, C and V to stay where they are");
    expect(decision?.reason).toContain("you barely use F16");
    expect(decision?.conversationId).toBe(first.conversationId);
    // The message that started each turn: his request, then each answer. Not only the last one.
    expect(decision?.sourceMessageIds).toEqual([first, second, third].map((o) => o.messageIds[0] ?? ""));
    expect(getLayout(app, layoutId).document.layers[0]?.bindings[6]).toMatchObject({ kind: "modifier" });
  });

  test("a request with nothing to ask gets one proposal and no question", async () => {
    const { app, layoutId } = await commandShiftApp();
    const { client, requests } = fakeAnthropic(quickScript());
    const out = await sendMessage(app, layoutId, { message: QUICK_REQUEST, model: anthropicModel(client) });
    expect(requests).toHaveLength(3);
    expect(out.status).toBe("complete");
    expect(out.question).toBeUndefined();
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0]?.supersedes).toBeNull();
    expect(out.proposals[0]?.validation.diff.dropped).toEqual([{ function: "key:F16", reason: "you said you barely use it" }]);
  });
});

// What an answer leaves in the decision (D-022). The decision applying writes is the last proposal's draft, so every answer has to reach it:
// every answer is a revision (the same ops when it only confirms), and the messages accumulate along the chain.
describe("every answer reaches the decision", () => {
  const ops = [{ op: "dropFunction", function: "key:F16", reason: "you said so" }, { op: "setBinding", at: { layerId: "layer-0", position: 6 }, binding: { kind: "key", code: "F17" } }];
  const proposal = (reason: string, over: object = {}) => ({ title: "F17 on the F16 key", ops, explanation: "F17 goes where F16 is.", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft({ goal: "A key", choice: "F17 on the F16 key", reason }), ...over });
  const ask = (n: number, of: number) => ({ tool: "ask_user", input: { question: `Question ${n}?`, considerations: ["It matters."], step: { n, of }, options: [{ label: "Yes" }, { label: "No" }] } });

  test("a three-step chain whose answers leave the ops unchanged accumulates every message, once each, and the last reason carries the last answer", async () => {
    const { app, layoutId } = await commandShiftApp();
    const { client } = fakeAnthropic([
      { blocks: [{ tool: "propose_changes", input: proposal("You want F17 there.") }] },
      { blocks: [ask(1, 3)] },
      (seen) => ({ blocks: [{ tool: "propose_changes", input: proposal("You want F17 there, and said yes to one.", { supersedes: lastSaved(seen) }) }] }),
      { blocks: [ask(2, 3)] },
      (seen) => ({ blocks: [{ tool: "propose_changes", input: proposal("You want F17 there, said yes to one and no to two.", { supersedes: lastSaved(seen) }) }] }),
      { blocks: [ask(3, 3)] },
      (seen) => ({ blocks: [{ tool: "propose_changes", input: proposal("You want F17 there, said yes to one, no to two and yes to three.", { supersedes: lastSaved(seen) }) }] }),
      { blocks: [{ text: "Done." }] },
    ]);
    const model = anthropicModel(client);
    const outcomes = [await sendMessage(app, layoutId, { message: "put F17 on F16", model })];
    for (const text of ["Yes", "No", "Yes"]) {
      const waiting = outcomes.at(-1);
      outcomes.push(await sendMessage(app, layoutId, { conversationId: waiting?.conversationId ?? "", answer: { toolUseId: waiting?.question?.toolUseId ?? "", text }, model }));
    }
    const last = outcomes.at(-1);
    expect(last?.status).toBe("complete");
    // The ops never changed: each answer is a revision all the same, and only the newest is open.
    const sets = listChanges(app, layoutId, {});
    expect(sets).toHaveLength(4);
    expect(sets.filter((cs) => cs.status === "proposed")).toHaveLength(1);
    expect(new Set(sets.map((cs) => JSON.stringify(cs.ops))).size).toBe(1);
    const applied = applyChange(app, last?.proposals[0]?.changeSetId ?? "");
    const decision = listDecisions(app, layoutId, { kind: "choice" }).find((d) => d.id === applied.decisionId);
    expect(decision?.reason).toContain("yes to three");
    // The request and all three answers, each once, in the order they were said.
    expect(decision?.sourceMessageIds).toEqual(outcomes.map((o) => o.messageIds[0] ?? ""));
    expect(new Set(decision?.sourceMessageIds).size).toBe(4);
  });

  test("an answer the model did not revise for still links the decision to it", async () => {
    const { app, layoutId } = await commandShiftApp();
    const { client } = fakeAnthropic([
      { blocks: [{ tool: "propose_changes", input: proposal("You want F17 there.") }] },
      { blocks: [ask(1, 2)] },
      // Answer 1 is not revised for: the model asks again with no proposal.
      { blocks: [ask(2, 2)] },
      (seen) => ({ blocks: [{ tool: "propose_changes", input: proposal("You want F17 there, and said no to two.", { supersedes: lastSaved(seen) }) }] }),
      { blocks: [{ text: "Done." }] },
    ]);
    const model = anthropicModel(client);
    const first = await sendMessage(app, layoutId, { message: "put F17 on F16", model });
    const second = await sendMessage(app, layoutId, { conversationId: first.conversationId, answer: { toolUseId: first.question?.toolUseId ?? "", text: "Yes" }, model });
    expect(second.proposals).toEqual([]);
    const third = await sendMessage(app, layoutId, { conversationId: first.conversationId, answer: { toolUseId: second.question?.toolUseId ?? "", text: "No" }, model });
    const applied = applyChange(app, third.proposals[0]?.changeSetId ?? "");
    const decision = listDecisions(app, layoutId, { kind: "choice" }).find((d) => d.id === applied.decisionId);
    expect(decision?.sourceMessageIds).toEqual([first, second, third].map((o) => o.messageIds[0] ?? ""));
  });
});

// Applying the proposal a question refines answers it by implication, and the server records that (D-452).
describe("applying while a question is open", () => {
  const ops = (code: string) => [{ op: "dropFunction", function: "key:F16", reason: "you said so" }, { op: "setBinding", at: { layerId: "layer-0", position: 6 }, binding: { kind: "key", code } }];
  const proposal = (title: string, code: string, over: object = {}) => ({ title, ops: ops(code), explanation: `${title}.`, tradeoffs: { gains: [], costs: [] }, decisionDraft: draft(), ...over });
  const ask = (n: number) => ({ tool: "ask_user", input: { question: `Question ${n}?`, considerations: ["It matters."], step: { n, of: 2 }, options: [{ label: "Yes" }, { label: "No" }] } });
  const questionOf = (app: Parameters<typeof showConversation>[0], id: string) => showConversation(app, id).messages.flatMap((m) => (m.question === undefined ? [] : [m.question]));

  test("a question asked in a later reply than its proposal is skipped when that proposal is applied, and stays skipped after the next message", async () => {
    const { app, layoutId } = await commandShiftApp();
    const { client, requests } = fakeAnthropic([
      { blocks: [{ tool: "propose_changes", input: proposal("One", "F17") }] },
      { blocks: [ask(1)] },
      // The answer is not revised for, so question 2 belongs to a reply with no proposal.
      { blocks: [ask(2)] },
      { blocks: [{ text: "Understood, it is applied." }] },
    ]);
    const model = anthropicModel(client);
    const first = await sendMessage(app, layoutId, { message: "go", model });
    const second = await sendMessage(app, layoutId, { conversationId: first.conversationId, answer: { toolUseId: first.question?.toolUseId ?? "", text: "Yes" }, model });
    expect(second.proposals).toEqual([]);
    expect(second.status).toBe("awaiting_answer");

    applyChange(app, first.proposals[0]?.changeSetId ?? "");
    const [q1, q2] = questionOf(app, first.conversationId);
    expect(q1).toMatchObject({ answer: "Yes" });
    expect(q2).toMatchObject({ answer: SKIPPED_ANSWER, skipped: true });

    // A message after the apply: the question is not "answered in his own words" and is still skipped, now and on reload.
    const next = await sendMessage(app, layoutId, { conversationId: first.conversationId, message: "thanks", model });
    expect(next.status).toBe("complete");
    expect(questionOf(app, first.conversationId)[1]).toMatchObject({ answer: SKIPPED_ANSWER, skipped: true });
    // The model was told, and the history has one result for the question, so the API accepts it.
    const last = requests.at(-1)?.body.messages.at(-1);
    expect(JSON.stringify(last)).toContain(SKIPPED_ANSWER);
    expect(JSON.stringify(last).match(/tool_result/g)).toHaveLength(1);
  });

  test("applying a proposal that is not the newest leaves the question open", async () => {
    const { app, layoutId } = await commandShiftApp();
    const { client } = fakeAnthropic([
      { blocks: [{ tool: "propose_changes", input: proposal("One", "F17") }] },
      { blocks: [{ tool: "propose_changes", input: proposal("Two", "F18", { supersedes: null }) }] },
      { blocks: [ask(1)] },
    ]);
    const first = await sendMessage(app, layoutId, { message: "go", model: anthropicModel(client) });
    const one = listChanges(app, layoutId, {}).find((cs) => cs.title === "One");
    applyChange(app, one?.id ?? "");
    expect(questionOf(app, first.conversationId)[0]).toMatchObject({ answer: null });
  });
});

describe("the supersede rules", () => {
  // Each proposal gives up F16 for a key code of its own, so any two are valid against the same head and differ.
  const ops = (code: string, position = 6) => [{ op: "dropFunction", function: "key:F16", reason: "you said so" }, { op: "setBinding", at: { layerId: "layer-0", position }, binding: { kind: "key", code } }];
  const proposal = (title: string, over: object = {}) => ({
    title, ops: ops("F17"), explanation: `${title}.`, tradeoffs: { gains: [], costs: [] }, decisionDraft: draft(), ...over,
  });
  const run = async (steps: ScriptStep[], conversation?: { app: Awaited<ReturnType<typeof commandShiftApp>>; id?: string }) => {
    const world = conversation?.app ?? (await commandShiftApp());
    const { client, requests } = fakeAnthropic(steps);
    const out = await sendMessage(world.app, world.layoutId, { message: "go", model: anthropicModel(client), ...(conversation?.id ? { conversationId: conversation.id } : {}) });
    return { world, out, requests };
  };

  test("a proposal made while another is open must say whether it replaces it, and nothing is saved until it does", async () => {
    const world = await commandShiftApp();
    const { out } = await run([
      { blocks: [{ tool: "propose_changes", input: proposal("First") }] },
      { blocks: [{ tool: "propose_changes", input: proposal("Second", { ops: ops("F18") }) }] },
      (seen) => {
        expect(seen.toolResults[0]).toContain("Nothing was saved");
        expect(seen.toolResults[0]).toContain("supersedes: <id>");
        expect(seen.toolResults[0]).toContain("Open: cs_");
        return { blocks: [{ tool: "propose_changes", input: proposal("Second", { ops: ops("F18"), supersedes: null }) }] };
      },
      { blocks: [{ text: "Two proposals, side by side." }] },
    ], { app: world });
    expect(out.proposals.map((p) => p.title)).toEqual(["First", "Second"]);
    // null: separate, so both stay open and applicable.
    expect(status(world.app, world.layoutId)).toEqual({ First: "proposed", Second: "proposed" });
  });

  test("a stale or unknown id, another conversation's proposal and an applied one are refused with a message the model can read", async () => {
    const world = await commandShiftApp();
    const other = await run([{ blocks: [{ tool: "propose_changes", input: proposal("Elsewhere") }] }, { blocks: [{ text: "ok" }] }], { app: world });
    const elsewhere = other.out.proposals[0]?.changeSetId ?? "";
    // A second conversation: its own proposal is open there, so the declaration is needed and the id belongs to the first conversation.
    const seenResults: string[] = [];
    const steps: ScriptStep[] = [
      { blocks: [{ tool: "propose_changes", input: proposal("Mine", { ops: ops("F18") }) }] },
      { blocks: [{ tool: "propose_changes", input: proposal("Mine too", { ops: ops("F19"), supersedes: elsewhere }) }] },
      (seen) => {
        seenResults.push(seen.toolResults[0] ?? "");
        return { blocks: [{ tool: "propose_changes", input: proposal("Mine too", { ops: ops("F19"), supersedes: "cs_missing" }) }] };
      },
      (seen) => {
        seenResults.push(seen.toolResults[0] ?? "");
        return { blocks: [{ text: "stopping" }] };
      },
    ];
    const { out } = await run(steps, { app: world });
    expect(seenResults[0]).toContain(`no proposal "${elsewhere}" in this conversation`);
    expect(seenResults[1]).toContain('no proposal "cs_missing" in this conversation');
    expect(out.proposals.map((p) => p.title)).toEqual(["Mine"]);
    expect(status(world.app, world.layoutId)).toEqual({ Elsewhere: "proposed", Mine: "proposed" });

    // BK applies it while the model works: the next revision is refused and told to propose against the layout as it is.
    const applied = out.proposals[0]?.changeSetId ?? "";
    applyChange(world.app, applied);
    const again = fakeAnthropic([
      { blocks: [{ tool: "propose_changes", input: proposal("Late", { ops: ops("F20"), supersedes: applied }) }] },
      (seen) => {
        expect(seen.toolResults[0]).toContain(`${applied} is applied`);
        expect(seen.toolResults[0]).toContain("supersedes: null");
        return { blocks: [{ text: "ok" }] };
      },
    ]);
    const late = await sendMessage(world.app, world.layoutId, { message: "and?", conversationId: out.conversationId, model: anthropicModel(again.client) });
    expect(late.proposals).toEqual([]);
    expect(again.requests).toHaveLength(2);
  });

  test("an invalid revision is refused and the previous proposal stays current", async () => {
    const world = await commandShiftApp();
    const first = await run([
      { blocks: [{ tool: "propose_changes", input: proposal("Good") }] },
      { blocks: [{ tool: "ask_user", input: { question: "Which?", considerations: ["It matters."], step: { n: 1, of: 2 }, options: [{ label: "A" }, { label: "B" }] } }] },
    ], { app: world });
    const good = first.out.proposals[0]?.changeSetId ?? "";
    const { client } = fakeAnthropic([
      // Position 9999 is not on the board, so the validator refuses it.
      { blocks: [{ tool: "propose_changes", input: proposal("Bad", { ops: ops("F17", 9999), supersedes: good }) }] },
      (seen) => {
        expect(seen.toolResults[0]).toContain("INVALID, not saved");
        expect(seen.toolResults[0]).toContain(`${good} is still the current proposal`);
        return { blocks: [{ text: "I could not make that work; the first proposal stands." }] };
      },
    ]);
    const out = await sendMessage(world.app, world.layoutId, {
      conversationId: first.out.conversationId, answer: { toolUseId: first.out.question?.toolUseId ?? "", text: "A" }, model: anthropicModel(client),
    });
    expect(out.proposals).toEqual([]);
    expect(status(world.app, world.layoutId)).toEqual({ Good: "proposed" });
  });

  test("a superseded proposal can't be applied", async () => {
    const world = await commandShiftApp();
    const first = await run([{ blocks: [{ tool: "propose_changes", input: proposal("One") }] }, { blocks: [{ text: "ok" }] }], { app: world });
    const one = first.out.proposals[0]?.changeSetId ?? "";
    const { client } = fakeAnthropic([
      { blocks: [{ tool: "propose_changes", input: proposal("Two", { ops: ops("F18"), supersedes: one }) }] },
      { blocks: [{ text: "revised" }] },
    ]);
    await sendMessage(world.app, world.layoutId, { message: "revise", conversationId: first.out.conversationId, model: anthropicModel(client) });
    expect(() => applyChange(world.app, one)).toThrow(/superseded, not proposed/);
  });

  test("a call in the old shape with one alternative is a proposal; with two it is refused and says why", async () => {
    const world = await commandShiftApp();
    const { out } = await run([
      { blocks: [{ tool: "propose_changes", input: { alternatives: [proposal("A"), proposal("B", { ops: ops("F18") })] } }] },
      (seen) => {
        expect(seen.toolResults[0]).toContain("one proposal per call");
        return { blocks: [{ tool: "propose_changes", input: { alternatives: [proposal("A")] } }] };
      },
      (seen) => {
        expect(seen.toolResults[0]).toContain("saved as cs_");
        return { blocks: [{ text: "one" }] };
      },
    ], { app: world });
    expect(out.proposals.map((p) => p.title)).toEqual(["A"]);
  });
});

describe("a question beside a proposal in one reply (Anthropic and OpenRouter)", () => {
  test("the proposal is run before the question stops the turn, so it reaches the board", async () => {
    const { app, layoutId } = await commandShiftApp();
    const question = { question: "Which?", considerations: ["It matters."], step: { n: 1, of: 2 }, options: [{ label: "A" }, { label: "B" }] };
    const batched = [{ op: "dropFunction", function: "key:F16", reason: "you said so" }, { op: "setBinding", at: { layerId: "layer-0", position: 6 }, binding: { kind: "key", code: "F17" } }];
    const { client, requests } = fakeAnthropic([
      { blocks: [
        { tool: "propose_changes", input: { title: "Batched", ops: batched, explanation: "Batched.", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft() } },
        { tool: "ask_user", input: question },
        // A second question in the reply still doesn't run.
        { tool: "ask_user", input: question },
      ] },
      { blocks: [{ text: "done" }] },
    ]);
    const model = anthropicModel(client);
    const out = await sendMessage(app, layoutId, { message: "go", model });
    expect(out.status).toBe("awaiting_answer");
    expect(out.proposals.map((p) => p.title)).toEqual(["Batched"]);
    const stored = listMessages(app.db, out.conversationId).flatMap((m) => m.content);
    const results = stored.filter((b) => b.type === "tool_result");
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ content: expect.stringContaining("saved as cs_") });
    expect(results[0]).not.toMatchObject({ is_error: true });
    expect(results[1]).toMatchObject({ is_error: true, content: expect.stringContaining("Not run") });
    // The answer still resumes it: the API sees a result for every call.
    const done = await sendMessage(app, layoutId, { conversationId: out.conversationId, answer: { toolUseId: out.question?.toolUseId ?? "", text: "A" }, model });
    expect(done.status).toBe("complete");
    expect(requests).toHaveLength(2);
  });
});

describe("a refining question with too many options", () => {
  test("is refused with a message the model can read, does not pause the turn, and the repeat with three options does", async () => {
    const { app, layoutId } = await commandShiftApp();
    const q = (options: string[]) => ({ question: "Which?", considerations: ["It matters."], step: { n: 1, of: 2 }, options: options.map((label) => ({ label })) });
    const { client } = fakeAnthropic([
      { blocks: [{ tool: "ask_user", input: q(["A", "B", "C", "D"]) }] },
      (seen) => {
        expect(seen.toolResults[0]).toContain("invalid input for ask_user");
        expect(seen.toolResults[0]).toContain("2 to 3 options");
        return { blocks: [{ tool: "ask_user", input: q(["A", "B", "C"]) }] };
      },
    ]);
    const out = await sendMessage(app, layoutId, { message: "go", model: anthropicModel(client) });
    expect(out.status).toBe("awaiting_answer");
    expect(out.question?.options.map((o) => o.label)).toEqual(["A", "B", "C"]);
  });
});

describe("a ask_user from before the loop", () => {
  test("a stored question without considerations or a step still loads, shows open, and takes an answer", async () => {
    const { app, layoutId } = await commandShiftApp();
    // The model is held to the new shape, so a call in the old shape never gets this far; it is stored the way an older keyloom stored it.
    const stored = fakeAnthropic([{ blocks: [{ tool: "ask_user", input: { question: "Left or right?", considerations: ["x"], step: { n: 1, of: 1 }, options: [{ label: "Left" }, { label: "Right" }] } }] }, { blocks: [{ text: "ok" }] }]);
    const first = await sendMessage(app, layoutId, { message: "go", model: anthropicModel(stored.client) });
    const row = listMessages(app.db, first.conversationId).at(-1);
    if (row === undefined) throw new Error("no message stored");
    app.db.query("UPDATE messages SET content = ? WHERE id = ?").run(JSON.stringify(row.content.map((b) => (b.type === "tool_use" ? { ...b, input: { question: "Left or right?", options: [{ label: "Left" }, { label: "Right", recommended: true }, { label: "Both", recommended: true }] } } : b))), row.id);
    const shown = showConversation(app, first.conversationId).messages.find((m) => m.question !== undefined)?.question;
    expect(shown).toMatchObject({ question: "Left or right?", answer: null });
    expect(shown?.considerations).toBeUndefined();
    expect(shown?.step).toBeUndefined();
    // Two options marked: the first marked one leads and is the only one marked.
    expect(shown?.options.map((o) => [o.label, o.recommended])).toEqual([["Right", true], ["Left", undefined], ["Both", undefined]]);
    const answered = await sendMessage(app, layoutId, { conversationId: first.conversationId, answer: { toolUseId: first.question?.toolUseId ?? "", text: "Left" }, model: anthropicModel(fakeAnthropic([{ blocks: [{ text: "Left it is." }] }]).client) });
    expect(answered.status).toBe("complete");
  });
});

describe("the Codex path", () => {
  const ask = { question: "Can X, C and V move?", considerations: ["Same hand."], step: { n: 1, of: 2 }, options: [{ label: "No" }, { label: "Yes", recommended: true }] };
  const first = { title: "First", ops: [{ op: "dropFunction", function: "key:F16", reason: "you said so" }, { op: "setBinding", at: { layerId: "layer-0", position: 6 }, binding: { kind: "key", code: "F17" } }], explanation: "First.", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft() };
  const env = (fake: { bin: string }) => ({ PATH: process.env.PATH, CODEX_HOME: tempDir("codex-refine-"), KEYLOOM_CODEX_BIN: fake.bin });

  test("proposes, asks, pauses, and a revision with supersedes after the answer sets the first one aside", async () => {
    const { app, layoutId } = await commandShiftApp();
    const turn1 = fakeCodex({ steps: [{ call: "propose_changes", input: first }, { call: "ask_user", input: ask }, { say: "never shown" }] });
    const one = await sendMessage(app, layoutId, { message: "go", model: codexModel({ env: env(turn1) }) });
    expect(one.status).toBe("awaiting_answer");
    expect(one.proposals.map((p) => p.title)).toEqual(["First"]);
    expect(one.question).toMatchObject({ step: { n: 1, of: 2 }, answer: null });
    expect(one.question?.options[0]).toMatchObject({ label: "Yes", recommended: true });

    const p1 = one.proposals[0]?.changeSetId ?? "";
    const turn2 = fakeCodex({ steps: [
      { call: "propose_changes", input: { ...first, title: "Second", ops: [{ op: "dropFunction", function: "key:F16", reason: "you said so" }, { op: "setBinding", at: { layerId: "layer-0", position: 6 }, binding: { kind: "key", code: "F18" } }], supersedes: p1 } },
      { say: "Revised." },
    ] });
    const two = await sendMessage(app, layoutId, { conversationId: one.conversationId, answer: { toolUseId: one.question?.toolUseId ?? "", text: "No" }, model: codexModel({ env: env(turn2) }) });
    expect(two.status).toBe("complete");
    expect(two.proposals[0]).toMatchObject({ title: "Second", supersedes: p1 });
    expect(status(app, layoutId)).toEqual({ First: "superseded", Second: "proposed" });
    // Codex was shown the answer as a result in the replayed transcript.
    expect(turn2.record()?.prompt).toContain("No");
    expect(turn2.record()?.results.map((r) => r.text).join("\n")).toContain(`${p1} is now superseded`);
  });
});

describe("the helper", () => {
  test("lastSaved reads the newest id out of the history", () => {
    const body = { messages: [{ content: [{ type: "tool_result", content: '- "A": saved as cs_one. Validation: ok' }] }, { content: [{ type: "tool_result", content: '- "B": saved as cs_two. Validation: ok' }] }] };
    expect(lastSaved({ body, toolResults: [], url: "", headers: new Headers() } as never)).toBe("cs_two");
  });
});
