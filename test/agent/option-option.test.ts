import { describe, expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import {
  type ChatEvent, applyChange, getLayout, listChanges, sendMessage, showConversation,
} from "../../src/app/index.ts";
import { bindingFunctions } from "../../src/layout/functions.ts";
import { fakeAnthropic, type ScriptStep } from "../helpers/fake-anthropic.ts";
import { draft } from "../helpers/ops.ts";
import { S_POSITION, optionOptionApp } from "../helpers/option-option.ts";

const bad = { op: "setBinding", at: { layerId: "layer-2", position: 30 }, binding: { kind: "key", code: "OPTION" } };
const plainAlt = { op: "setBinding", at: { layerId: "layer-2", position: 30 }, binding: { kind: "modifier", mods: ["LALT"] } };

const alt = (title: string, ops: unknown[]) => ({
  title, ops, explanation: `${title}: holds the layer with the right hand so Option is a plain key`,
  tradeoffs: { gains: ["Option-Option works"], costs: ["Uses one transparent key on layer 2"] },
  decisionDraft: draft({ goal: "Option-Option shortcuts were impossible", choice: title, reason: "the right hand holds the layer, so the left hand taps S twice" }),
});

const question: ScriptStep = {
  blocks: [{ text: "Which app wants Option-Option, and which hand is free while you press it?" }],
};

const script: ScriptStep[] = [
  question,
  { blocks: [{ tool: "get_layout", input: { layers: ["layer-2"] } }, { tool: "find_function", input: { function: "mod:LALT" } }] },
  (seen) => {
    expect(seen.toolResults[0]).toContain("Layer 2");
    expect(seen.toolResults[1]).toContain("hold half of hold-tap");
    expect(seen.toolResults[1]).toContain(`layer-0 (Layer 0) position ${S_POSITION}`);
    expect(seen.toolResults[1]).toContain("No key produces it as a plain press");
    return { blocks: [{ tool: "propose_changes", input: { alternatives: [alt("Bad key", [bad])] } }] };
  },
  (seen) => {
    expect(seen.toolResults[0]).toContain("INVALID");
    expect(seen.toolResults[0]).toContain("firmware_unsupported");
    return { blocks: [{ tool: "propose_changes", input: alt("Plain Option on layer 2", [plainAlt]) }] };
  },
  (seen) => {
    expect(seen.toolResults[0]).toContain("saved as cs_");
    return { blocks: [{ text: "Hold layer 2 and tap S twice." }] };
  },
];

describe("the Option-Option conversation with a scripted model", () => {
  test("asks, reads, repairs an invalid proposal, and ends with one valid proposal BK can apply", async () => {
    const { app, layoutId } = await optionOptionApp();
    const { client, requests } = fakeAnthropic(script);
    const model = anthropicModel(client);

    const first = await sendMessage(app, layoutId, {
      message: "Some apps want Option-Option, and I can't do it because Option is my S home row mod.", model,
    });
    expect(first.proposals).toEqual([]);
    expect(first.text).toContain("Which app");
    expect(first.status).toBe("complete");

    const events: ChatEvent[] = [];
    const second = await sendMessage(app, layoutId, {
      message: "Raycast. My right hand is free.", conversationId: first.conversationId, model, onEvent: (e) => events.push(e),
    });

    // Streamed text, tool progress and proposal cards arrive as events, ending with done.
    expect(events.map((e) => e.type)).toEqual(["start", "tool", "tool", "tool", "tool", "proposal", "text", "text", "done"]);
    expect(second.status).toBe("complete");
    expect(second.iterations).toBe(4);
    expect(second.proposals).toHaveLength(1);

    // Only the valid proposal was stored, linked to the conversation.
    const stored = listChanges(app, layoutId, { status: "proposed" });
    expect(stored).toHaveLength(1);
    expect(stored.every((c) => c.source === "agent" && c.conversationId === second.conversationId && c.proposalGroup !== null)).toBe(true);
    expect(new Set(stored.map((c) => c.proposalGroup)).size).toBe(1);
    expect(stored.map((c) => c.title)).toEqual(["Plain Option on layer 2"]);
    expect(stored[0]?.tradeoffs.costs.length).toBeGreaterThan(0);

    // The proposal puts no multi-tap behaviour on S.
    for (const cs of stored) {
      for (const op of cs.ops) {
        if (op.op === "setBinding" && op.at.layerId === "layer-0" && op.at.position === S_POSITION) throw new Error("touched S");
      }
    }

    // Applying it makes Option a plain modifier.
    const plain = stored.find((c) => c.title === "Plain Option on layer 2");
    if (!plain) throw new Error("missing");
    applyChange(app, plain.id);
    const after = getLayout(app, layoutId).document;
    expect(after.layers.flatMap((l) => l.bindings).some((b) => b.kind === "modifier" && bindingFunctions(b).includes("mod:LALT"))).toBe(true);

    // The request used the settings the blueprint specifies.
    const body = requests[1]?.body ?? {};
    expect(requests[1]?.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(body).toMatchObject({
      model: "claude-opus-5-5", stream: true, thinking: { type: "adaptive" }, output_config: { effort: "medium" },
      tool_choice: { type: "auto" }, fallbacks: "default", cache_control: { type: "ephemeral" },
    });
    expect(body.tools.map((t: any) => t.name)).toEqual(["list_layouts", "get_layout", "find_function", "analyse_change", "record_priority", "update_decision_outcome", "propose_changes", "mirror_keys", "map_keys", "put_config", "get_typing_findings", "get_review", "ask_user", "create_config"]);
    expect(body.tools.map((t: any) => t.strict)).toEqual([true, true, true, false, true, true, false, true, true, false, true, true, true, true]);
    expect(body.tools.every((t: any) => t.eager_input_streaming === true)).toBe(true);
    expect(body.system).toContain("never apply");
    expect(body.system).toContain("zsa/moonlander");
    // The first question and its answer are in the history the second turn sent.
    expect(body.messages[0].content[0].text).toContain("Option is my S home row mod");
    expect(body.messages.length).toBe(3);

    // The conversation reads back for the chat panel without tool-result plumbing.
    const view = showConversation(app, first.conversationId);
    expect(view.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "assistant", "assistant", "assistant"]);
    expect(view.proposals).toHaveLength(1);
  });
});
