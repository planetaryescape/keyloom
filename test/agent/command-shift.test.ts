import { describe, expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import {
  type ChatEvent, applyChange, getLayout, listChanges, listDecisions, sendMessage, showConversation, undo,
} from "../../src/app/index.ts";
import { deepEqual } from "../../src/layout/equal.ts";
import { fakeAnthropic, type ScriptStep } from "../helpers/fake-anthropic.ts";
import { draft } from "../helpers/ops.ts";
import { BACKSPACE_POSITION, F16_POSITION, TAB_POSITION, commandShiftApp } from "../helpers/command-shift.ts";

const base = (position: number) => ({ layerId: "layer-0", position });
const cmdShift = { kind: "modifier", mods: ["LGUI", "LSFT"] };

const alt = (title: string, ops: unknown[], costs: string[]) => ({
  title, ops, explanation: `${title}: one key for Command-Shift on the left hand`, tradeoffs: { gains: ["One key for Command-Shift"], costs },
  decisionDraft: draft({ goal: "I press Command-Shift a lot", choice: title, reason: "the left hand stays free for the shortcut" }),
});
// Replaces Tab, which is still on the left thumb (Tab/L1): it only changes place.
const onTab = alt("Command-Shift where Tab is", [{ op: "setBinding", at: base(TAB_POSITION), binding: cmdShift }], ["Tab is reached from the thumb only"]);
// F16 is nowhere else, so it is dropped, with BK's reason.
const onF16 = alt("Command-Shift on the F16 key", [
  { op: "dropFunction", function: "key:F16", reason: "BK barely uses it" },
  { op: "setBinding", at: base(F16_POSITION), binding: cmdShift },
], ["F16 is gone"]);
// Replaces Backspace, which BK pinned: valid, but the validator says so.
const onBackspace = alt("Command-Shift where Backspace is", [{ op: "setBinding", at: base(BACKSPACE_POSITION), binding: cmdShift }], ["Backspace leaves the home position"]);

const script: ScriptStep[] = [
  // Turn 1: look, then ask.
  { blocks: [{ tool: "get_layout", input: { layers: ["layer-0"] } }, { tool: "find_function", input: { function: "mod:LGUI+LSFT" } }] },
  (seen) => {
    expect(seen.toolResults[1]).toContain("mod:LGUI+LSFT is produced by no key");
    expect(seen.body.system).toContain("Nothing recorded yet");
    return { blocks: [{ text: "Which shortcuts, which hand stays free, and what do you barely use or need to keep?" }] };
  },
  // Turn 2: BK answers. Record what he said, then propose.
  { blocks: [
    { tool: "record_priority", input: { priorityKind: "pinned", statement: "keep Backspace where it is", subject: { functions: ["BACKSPACE"] } } },
    { tool: "record_priority", input: { priorityKind: "rarely_used", statement: "I barely use F16", subject: { functions: ["key:F16"] }, reason: "never touched it" } },
    { tool: "record_priority", input: { priorityKind: "pinned", statement: "keep Backspace where it is", subject: { functions: ["key:BACKSPACE"] } } },
  ] },
  (seen) => {
    expect(seen.toolResults[0]).toContain("Remembered (dec_");
    expect(seen.toolResults[1]).toContain("Remembered (dec_");
    // Said twice, remembered once.
    expect(seen.toolResults[2]).toContain("Already remembered");
    return { blocks: [{ tool: "propose_changes", input: onTab }] };
  },
  // One proposal per call (D-452). These stand beside each other, so each later one declares that it replaces none.
  (seen) => {
    expect(seen.toolResults[0]).toContain("saved as cs_");
    expect(seen.toolResults[0]).not.toContain("moved_pinned");
    return { blocks: [{ tool: "propose_changes", input: onF16 }] };
  },
  (seen) => {
    expect(seen.toolResults[0]).toContain("Nothing was saved");
    return { blocks: [{ tool: "propose_changes", input: { ...onF16, supersedes: null } }] };
  },
  (seen) => {
    expect(seen.toolResults[0]).toContain("saved as cs_");
    return { blocks: [{ tool: "propose_changes", input: { ...onBackspace, supersedes: null } }] };
  },
  (seen) => {
    expect(seen.toolResults[0]).toContain("moved_pinned");
    return { blocks: [{ text: "Three proposals. The third moves Backspace, which you asked me to keep, so I would not pick it." }] };
  },
  // Turn 3: BK applies one and comes back; the prompt now carries what he said.
  (seen) => {
    expect(seen.body.system).toContain("# What BK has told you matters");
    expect(seen.body.system).toContain('He said: "keep Backspace where it is"');
    expect(seen.body.system).toContain("[pinned: must not move] key:BACKSPACE");
    expect(seen.body.system).toContain("[rarely used: can give up its place] key:F16");
    return { blocks: [{ text: "Applied options stay applied until you undo them." }] };
  },
];

describe("the Command-Shift conversation with a scripted model", () => {
  test("asks, records what BK says, offers alternatives with displaced functions, warns about the pinned one, and undoes in one step", async () => {
    const { app, layoutId } = await commandShiftApp();
    const original = getLayout(app, layoutId).document;
    const { client, requests } = fakeAnthropic(script);
    const model = anthropicModel(client);

    const first = await sendMessage(app, layoutId, { message: "I press Command-Shift a lot; give me one key for it.", model });
    expect(first.proposals).toEqual([]);
    expect(first.priorities).toEqual([]);

    const events: ChatEvent[] = [];
    const second = await sendMessage(app, layoutId, {
      message: "Left hand has to stay free. I barely use F16. Keep Backspace where it is.", conversationId: first.conversationId, model, onEvent: (e) => events.push(e),
    });

    // Chips arrive live, before the proposals, and only for what was newly stored.
    const kinds = events.map((e) => e.type);
    expect(kinds.filter((k) => k === "priority")).toHaveLength(2);
    expect(kinds.indexOf("priority")).toBeLessThan(kinds.indexOf("proposal"));
    expect(second.priorities.map((p) => p.priorityKind)).toEqual(["pinned", "rarely_used"]);
    expect(second.priorities[0]).toMatchObject({ statement: "keep Backspace where it is", subject: { functions: ["key:BACKSPACE"] }, reason: "stated by BK" });
    expect(second.priorities[1]).toMatchObject({ reason: "never touched it" });
    // The link back: each priority names BK's message it came from.
    const user = showConversation(app, first.conversationId).messages.filter((m) => m.role === "user")[1];
    expect(second.priorities.every((p) => p.sourceMessageIds[0] === user?.id)).toBe(true);

    // They are decisions of kind priority, tied to the conversation.
    const stored = listDecisions(app, layoutId, { kind: "priority" });
    expect(stored).toHaveLength(2);
    expect(stored.every((d) => d.conversationId === first.conversationId)).toBe(true);
    expect(showConversation(app, first.conversationId).priorities.map((p) => p.id).sort()).toEqual(stored.map((d) => d.id).sort());

    // Three proposals, each its own group; each says what it displaces and where that goes.
    expect(second.proposals).toHaveLength(3);
    expect(new Set(second.proposals.map((p) => p.proposalGroup)).size).toBe(3);
    const byTitle = (title: string) => second.proposals.find((p) => p.title === title)?.validation;
    expect(byTitle(onTab.title)?.diff.displaced).toEqual([
      { function: "key:TAB", from: base(TAB_POSITION), to: { layerId: "layer-0", position: 67 } },
    ]);
    expect(byTitle(onF16.title)?.diff.dropped).toEqual([{ function: "key:F16", reason: "BK barely uses it" }]);
    expect(byTitle(onTab.title)?.warnings).toEqual([]);
    expect(byTitle(onBackspace.title)?.warnings.map((w) => w.code)).toEqual(["moved_pinned"]);

    // Apply the one that respects what he said, then undo: every key is back in one step.
    const chosen = second.proposals.find((p) => p.title === onTab.title);
    if (!chosen) throw new Error("missing");
    const applied = applyChange(app, chosen.changeSetId);
    // They were proposed beside each other, so applying one sets none of the others aside.
    expect(listChanges(app, layoutId, { status: "superseded" })).toHaveLength(0);
    undo(app, layoutId, { revisionId: applied.revisionId });
    expect(deepEqual(getLayout(app, layoutId).document, original)).toBe(true);

    await sendMessage(app, layoutId, { message: "Thanks.", conversationId: first.conversationId, model });
    expect(requests).toHaveLength(script.length);
    expect(requests[2]?.body.tools.map((t: { name: string }) => t.name)).toContain("record_priority");
  });
});
