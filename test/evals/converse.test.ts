// The live scenarios' conversation loop (evals/converse.ts), driven by a scripted model so no paid call is made: a refining question
// is answered with the recommended option and the conversation goes on until the turn completes, where the old loops stopped on
// `awaiting_answer` (D-452).
import { describe, expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { commandShiftApp } from "../helpers/command-shift.ts";
import { fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { draft } from "../helpers/ops.ts";
import { converse } from "../../evals/converse.ts";

const proposal = (code: string) => ({
  title: `Option ${code}`, explanation: "One key.", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft(),
  ops: [{ op: "dropFunction", function: "key:F16", reason: "you said so" }, { op: "setBinding", at: { layerId: "layer-0", position: 6 }, binding: { kind: "key", code } }],
});
const ask = (question: string) => ({
  tool: "ask_user",
  input: { question, considerations: ["It matters."], step: { n: 1, of: 2 }, options: [{ label: "Not this", id: "no" }, { label: "This one", id: "yes", recommended: true }] },
});

describe("converse", () => {
  test("answers a question with its recommended option and continues to a completed turn with the final proposal", async () => {
    const world = await commandShiftApp();
    const { client, requests } = fakeAnthropic([
      { blocks: [{ tool: "propose_changes", input: proposal("F17") }] },
      { blocks: [ask("Which hand?")] },
      // The revision replaces the first proposal, whose ID the model was told when it was saved.
      () => ({ blocks: [{ tool: "propose_changes", input: { ...proposal("F18"), supersedes: /cs_\w+/.exec(requests[1]?.toolResults.join(" ") ?? "")?.[0] } }] }),
      { blocks: [{ text: "Done." }] },
    ]);
    const { outcomes, questions } = await converse(world.app, world.layoutId, { message: "give me a key" }, { nudges: ["go on"], maxTurns: 5, model: anthropicModel(client) });

    expect(outcomes.map((o) => o.status)).toEqual(["awaiting_answer", "complete"]);
    expect(questions.map((q) => q.question)).toEqual(["Which hand?"]);
    expect(outcomes.flatMap((o) => o.proposals).map((p) => [p.title, p.supersedes !== null])).toEqual([["Option F17", false], ["Option F18", true]]);
    expect(requests[2]?.toolResults).toEqual(["yes"]);
  });

  test("fails when the last turn is still waiting for an answer, even beside a valid proposal", async () => {
    const world = await commandShiftApp();
    const { client } = fakeAnthropic([
      { blocks: [{ tool: "propose_changes", input: proposal("F17") }] },
      { blocks: [ask("Which hand?")] },
    ]);
    await expect(converse(world.app, world.layoutId, { message: "give me a key" }, { nudges: [], maxTurns: 1, model: anthropicModel(client) }))
      .rejects.toThrow(/still awaiting_answer after 1 turns/);
  });

  test("nudges a completed turn that proposed nothing, and gives up at the turn limit", async () => {
    const world = await commandShiftApp();
    const { client, requests } = fakeAnthropic([{ blocks: [{ text: "Tell me more." }] }, { blocks: [{ text: "Still unsure." }] }]);
    const { outcomes } = await converse(world.app, world.layoutId, { message: "give me a key" }, { nudges: ["please decide"], maxTurns: 2, model: anthropicModel(client) });

    expect(outcomes.map((o) => o.status)).toEqual(["complete", "complete"]);
    expect(JSON.stringify(requests.at(-1)?.body.messages)).toContain("please decide");
  });
});
