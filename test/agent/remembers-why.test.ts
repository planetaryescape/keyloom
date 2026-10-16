// Rung 6 with a scripted model: an applied choice is remembered, shows in the next prompt with its
// status, comes back as a reminder on the proposal that touches it, and the outcome tool records
// how it went. Nothing here calls the network.
import { describe, expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { applyChange, listDecisions, sendMessage, showDecision } from "../../src/app/index.ts";
import { fakeAnthropic, type ScriptStep } from "../helpers/fake-anthropic.ts";
import { commandShiftApp } from "../helpers/command-shift.ts";
import { draft } from "../helpers/ops.ts";

const TAB = { layerId: "layer-0", position: 42 };
const REASON = "my left hand is free while the right one holds the mouse";

const cmdShiftAlt = {
  title: "Command-Shift where Tab is",
  ops: [{ op: "setBinding", at: TAB, binding: { kind: "modifier", mods: ["LGUI", "LSFT"] } }],
  explanation: "One key for Command-Shift on the left hand.",
  tradeoffs: { gains: ["One key"], costs: ["Tab is reached from the thumb only"] },
  decisionDraft: draft({ goal: "I press Command-Shift a lot", choice: "Command-Shift on the bottom-left pinky key", reason: REASON, scope: { apps: ["Figma"], habits: ["shortcuts with the left hand"] } }),
};
const capsAlt = {
  title: "Caps Lock where Command-Shift is",
  ops: [{ op: "dropFunction", function: "mod:LSFT+LGUI", reason: "BK no longer uses it" }, { op: "setBinding", at: TAB, binding: { kind: "key", code: "CAPS_LOCK" } }],
  explanation: "Caps Lock back on the bottom-left pinky key.",
  tradeoffs: { gains: ["Caps Lock"], costs: ["No Command-Shift key"] },
  decisionDraft: draft({ goal: "I want Caps Lock back", choice: "Caps Lock on the bottom-left pinky key", reason: "I stopped using Command-Shift" }),
};

describe("the agent remembers why", () => {
  test("a choice shows in the next prompt with its status, the reminder reaches the agent and the card, and outcomes are recorded", async () => {
    const { app, layoutId } = await commandShiftApp();
    let choiceId = "";
    const script: ScriptStep[] = [
      // Turn 1: BK asks for Command-Shift; the model proposes with a decision draft.
      { blocks: [{ tool: "propose_changes", input: { alternatives: [cmdShiftAlt] } }] },
      { blocks: [{ text: "Here is one option." }] },
      // Turn 2: BK wants it replaced. The prompt carries the stored reason with its status and the key by what it prints and where it sits (D-279).
      (seen) => {
        const system = String(seen.body.system);
        expect(system).toContain("# What was decided earlier, and why");
        expect(system).toMatch(/\[hypothesis: not tested yet, open to revision\] \S+ \(left pinky, bottom row, outer, Layer 0\)\./);
        expect(system).toContain(`Why: ${REASON}.`);
        expect(system).toContain("Applies to: app Figma; shortcuts with the left hand.");
        expect(system).toContain(choiceId);
        return { blocks: [{ text: `You put Command-Shift on the bottom-left pinky key because ${REASON}. Does that still hold?` }] };
      },
      // Turn 3: BK says go ahead. Analysing returns the reminder to the model.
      { blocks: [{ tool: "analyse_change", input: { ops: capsAlt.ops } }] },
      (seen) => {
        const result = JSON.parse(seen.toolResults[0] ?? "{}");
        expect(result.ok).toBe(true);
        expect(result.reminders).toMatchObject([{ decisionId: choiceId, reason: REASON, status: "hypothesis" }]);
        expect(result.warnings.map((w: { code: string }) => w.code)).toContain("contradicts_decision");
        return { blocks: [{ tool: "propose_changes", input: { alternatives: [capsAlt] } }] };
      },
      { blocks: [{ text: "Caps Lock goes back on the bottom-left pinky key." }] },
      // Turn 4: it was applied; BK reports how Command-Shift (now superseded) went, which cannot be recorded, then the new one.
      () => ({ blocks: [
        { tool: "update_decision_outcome", input: { decisionId: choiceId, status: "tried_unhelpful", note: "never used it" } },
        { tool: "update_decision_outcome", input: { decisionId: "dec_nope", status: "tried_helpful", note: "x" } },
      ] }),
      (seen) => {
        expect(seen.toolResults[0]).toContain("no longer applies");
        expect(seen.toolResults[1]).toContain("no decision");
        return { blocks: [{ text: "Noted." }] };
      },
    ];
    const { client, requests } = fakeAnthropic(script);
    const model = anthropicModel(client);

    const one = await sendMessage(app, layoutId, { message: "I press Command-Shift a lot; give me one key for it.", model });
    expect(one.proposals[0]?.decisionDraft).toMatchObject({ goal: "I press Command-Shift a lot", reason: REASON });
    const applied = applyChange(app, one.proposals[0]?.changeSetId as string);
    choiceId = applied.decisionId as string;
    const stored = showDecision(app, choiceId);
    // The link back is to BK's message in this conversation.
    expect(stored).toMatchObject({ conversationId: one.conversationId, sourceMessageIds: [one.messageIds[0] as string], scope: { apps: ["Figma"], habits: ["shortcuts with the left hand"] } });

    await sendMessage(app, layoutId, { message: "Replace the Command-Shift key with Caps Lock.", conversationId: one.conversationId, model });
    const three = await sendMessage(app, layoutId, { message: "It doesn't hold any more, do it.", conversationId: one.conversationId, model });
    const card = three.proposals[0];
    expect(card?.validation.diff.reminders).toMatchObject([{ decisionId: choiceId, reason: REASON, slots: [TAB] }]);

    // Applying anyway supersedes it, with the new decision as its successor.
    const second = applyChange(app, card?.changeSetId as string);
    expect(showDecision(app, choiceId)).toMatchObject({ status: "superseded", supersededBy: second.decisionId });
    expect(listDecisions(app, layoutId, { kind: "choice" }).filter((d) => d.status !== "superseded").map((d) => d.id)).toEqual([second.decisionId as string]);

    await sendMessage(app, layoutId, { message: "I never used the old one.", conversationId: one.conversationId, model });
    expect(requests).toHaveLength(script.length);
  });

  test("an outcome the agent records is kept with BK's words, and the next prompt shows it", async () => {
    const { app, layoutId } = await commandShiftApp();
    let choiceId = "";
    const script: ScriptStep[] = [
      { blocks: [{ tool: "propose_changes", input: { alternatives: [cmdShiftAlt] } }] },
      { blocks: [{ text: "One option." }] },
      () => ({ blocks: [{ tool: "update_decision_outcome", input: { decisionId: choiceId, status: "tried_helpful", note: "I use it every day" } }] }),
      (seen) => {
        expect(seen.toolResults[0]).toContain(`Recorded for ${choiceId}`);
        return { blocks: [{ text: "Good to know." }] };
      },
      (seen) => {
        expect(String(seen.body.system)).toContain("[tried and helped: needs a reason from BK before you undo it]");
        expect(String(seen.body.system)).toContain('BK said: "I use it every day".');
        return { blocks: [{ text: "Understood." }] };
      },
    ];
    const model = anthropicModel(fakeAnthropic(script).client);
    const one = await sendMessage(app, layoutId, { message: "Give me Command-Shift.", model });
    choiceId = applyChange(app, one.proposals[0]?.changeSetId as string).decisionId as string;
    const two = await sendMessage(app, layoutId, { message: "That fixed it, I use it every day.", conversationId: one.conversationId, model });
    expect(two.status).toBe("complete");
    expect(showDecision(app, choiceId)).toMatchObject({ status: "tried_helpful", outcomeNote: "I use it every day" });
    await sendMessage(app, layoutId, { message: "Thanks.", conversationId: one.conversationId, model });
  });
});
