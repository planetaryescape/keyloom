// The agent proposes a conditional layer with the same propose_changes tool as everything else (D-389), reads it back in get_layout,
// and is told in its tool result when the validator refuses one.
import { describe, expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { applyChange, getLayout, listChanges, sendMessage } from "../../src/app/index.ts";
import { fakeAnthropic, type ScriptStep } from "../helpers/fake-anthropic.ts";
import { draft } from "../helpers/ops.ts";
import { optionOptionApp } from "../helpers/option-option.ts";

const alt = (title: string, ops: unknown[]) => ({
  title, ops, explanation: `${title}: holding two layers together also turns on a third`,
  tradeoffs: { gains: ["One less key to reach the third layer"], costs: ["Both layers must be held together"] },
  decisionDraft: draft({ goal: "Reach the third layer without a key", choice: title, reason: "holding the two layers you already use is enough" }),
});
const condition = (extra: object = {}) => ({ op: "upsertConditionalLayer" as const, conditionalLayer: { id: "cond-layer-3", ifLayerIds: ["layer-1", "layer-2"], thenLayerId: "layer-3", ...extra } });

const script: ScriptStep[] = [
  { blocks: [{ tool: "get_layout", input: { layers: ["layer-3"] } }] },
  (seen) => {
    expect(seen.toolResults[0]).toContain("Conditional layers: none.");
    return { blocks: [{ tool: "propose_changes", input: { alternatives: [alt("Same layer twice", [condition({ ifLayerIds: ["layer-1", "layer-1"] })])] } }] };
  },
  (seen) => {
    expect(seen.toolResults[0]).toContain("INVALID");
    expect(seen.toolResults[0]).toContain("conditional_layer_invalid");
    return { blocks: [{ tool: "propose_changes", input: { alternatives: [alt("Tri-layer", [condition()])] } }] };
  },
  (seen) => {
    expect(seen.toolResults[0]).toContain("saved as cs_");
    return { blocks: [{ text: "Hold layers 1 and 2 together and layer 3 turns on." }] };
  },
  { blocks: [{ tool: "get_layout", input: { layers: ["layer-3"] } }] },
  (seen) => {
    expect(seen.toolResults[0]).toContain("cond-layer-3");
    expect(seen.toolResults[0]).toContain("layer ids layer-1 + layer-2 gives layer-3");
    return { blocks: [{ text: "It is in the layout now." }] };
  },
];

describe("the agent and conditional layers", () => {
  test("proposes one, repairs a refused one from the validator's error, and reads an applied one back", async () => {
    const { app, layoutId } = await optionOptionApp();
    const { client } = fakeAnthropic(script.slice(0, 4));
    const first = await sendMessage(app, layoutId, { message: "Holding Lower and Raise together should open the third layer.", model: anthropicModel(client) });
    expect(first.proposals).toHaveLength(1);
    const [stored] = listChanges(app, layoutId, { status: "proposed" });
    expect(stored?.ops).toEqual([condition()]);

    applyChange(app, stored?.id ?? "");
    expect(getLayout(app, layoutId).document.conditionalLayers).toEqual([{ id: "cond-layer-3", ifLayerIds: ["layer-1", "layer-2"], thenLayerId: "layer-3" }]);

    const again = fakeAnthropic(script.slice(4));
    const second = await sendMessage(app, layoutId, { message: "Is it there?", conversationId: first.conversationId, model: anthropicModel(again.client) });
    expect(second.text).toContain("in the layout now");
  });
});
