import { expect, test } from "bun:test";
import { openApp, importLayout, sendMessage, showConversation, getLayout, applyChange } from "../../src/app/index.ts";
import { fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { tempDir } from "../helpers/tmp.ts";
import { draft } from "../helpers/ops.ts";
import { normalizeFunction } from "../../src/agent/layout-facts.ts";
import { generateZmkSource } from "../../src/firmware/zmk/generate.ts";

test("the agent reads effective encoders, finds firmware aliases and prepares one checked mouse/media change", async () => {
  const app = openApp({ dataDir: tempDir("encoder-agent-") });
  try {
    const imported = await importLayout(app, { board: "keebart/corne-choc-pro-bt", source: "test/fixtures/zmk/encoder-layers.keymap", name: "Encoders" });
    const mouse = (direction: string) => ({ kind: "native", firmware: "zmk", source: `&mmv MOVE_${direction}`, label: `Mouse ${direction.toLowerCase()}` });
    const ops = [
      { op: "setSensorBindings", layerId: "base", sensorBindings: [
        ...Array.from({ length: 2 }, () => ({ kind: "rotation", clockwise: mouse("RIGHT"), counterclockwise: mouse("LEFT") })),
        ...Array.from({ length: 2 }, () => ({ kind: "rotation", clockwise: mouse("DOWN"), counterclockwise: mouse("UP") })),
      ] },
      { op: "setBinding", at: { layerId: "numbers", position: 6 }, binding: { kind: "key", code: "AUDIO_MUTE" } },
      { op: "setBinding", at: { layerId: "numbers", position: 7 }, binding: { kind: "key", code: "MEDIA_PLAY_PAUSE" } },
      { op: "setBinding", at: { layerId: "base", position: 6 }, binding: { kind: "native", firmware: "zmk", source: "&mkp LCLK", label: "Left click" } },
      { op: "setBinding", at: { layerId: "base", position: 7 }, binding: { kind: "native", firmware: "zmk", source: "&mkp RCLK", label: "Right click" } },
    ];
    const fake = fakeAnthropic([
      { blocks: [{ tool: "get_layout", input: {} }] },
      { blocks: [{ tool: "find_function", input: { function: "C_VOL_UP" } }] },
      { blocks: [{ tool: "analyse_change", input: { ops } }] },
      { blocks: [{ tool: "propose_changes", input: { alternatives: [{ title: "Mouse encoders", explanation: "Pointer on Base; media on Numbers.", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft(), ops }] } }] },
      { blocks: [{ text: "Prepared mouse controls; media stays on Numbers. Nothing applied yet." }] },
    ]);
    const out = await sendMessage(app, imported.layoutId, { message: "Use my encoders as a mouse; keep media on Numbers.", model: anthropicModel(fake.client) });
    expect(out.proposals).toHaveLength(1);
    expect(showConversation(app, out.conversationId).presentations[0]?.operations.map((o) => o.status)).toEqual(["succeeded", "succeeded", "succeeded", "succeeded"]);
    expect(getLayout(app, imported.layoutId).document.layers[0]?.sensorBindings).toBeUndefined();
    applyChange(app, out.proposals[0]!.changeSetId);
    const current = getLayout(app, imported.layoutId);
    const source = generateZmkSource({ layout: current.document, board: current.board.definition, revisionId: "test" });
    expect(source.files[0]!.content).toContain("&mkp LCLK");
    expect(source.files[1]!.content).toContain("CONFIG_ZMK_POINTING=y");
  } finally { app.db.close(); }
});

test.each(["C_VOL_UP", "KC_VOLU", "Volume up", "key:C_VOL_UP"])("find_function accepts %s", (input) => {
  expect(normalizeFunction(input)).toBe("key:AUDIO_VOL_UP");
});
