import { describe, expect, test } from "bun:test";
import { AgentArtifactSchema, type AgentArtifact } from "../../src/api/artifacts.ts";

describe("AgentArtifactSchema (Rung 27)", () => {
  test("parses a comparison artifact", () => {
    const artifact: AgentArtifact = {
      kind: "comparison",
      title: "Option vs Command on Thumb",
      options: [
        { title: "Option key", changeSetId: "cs_1", gains: ["Fast modifier access"], costs: ["Takes up thumb key"] },
        { title: "Command key", changeSetId: "cs_2", gains: ["Closer to standard Mac"], costs: ["Changes existing habit"] },
      ],
    };
    const parsed = AgentArtifactSchema.parse(artifact);
    expect(parsed.kind).toBe("comparison");
  });

  test("parses a transfer artifact", () => {
    const artifact: AgentArtifact = {
      kind: "transfer",
      sourceBoard: "zsa/moonlander",
      destinationBoard: "moergo/glove80",
      mappedCount: 42,
      skipped: [
        { key: "LED_TOGGLE", reason: "Glove80 does not support per-key RGB control" },
      ],
    };
    const parsed = AgentArtifactSchema.parse(artifact);
    expect(parsed.kind).toBe("transfer");
    if (parsed.kind === "transfer") {
      expect(parsed.mappedCount).toBe(42);
      expect(parsed.skipped).toHaveLength(1);
    }
  });

  test("parses a keyboard_list artifact", () => {
    const artifact: AgentArtifact = {
      kind: "keyboard_list",
      keyboards: [
        { id: "moonlander", name: "ZSA Moonlander", configs: ["Daily", "Gaming"], connected: true },
        { id: "glove80", name: "MoErgo Glove80", configs: ["Daily"], connected: false },
      ],
    };
    const parsed = AgentArtifactSchema.parse(artifact);
    expect(parsed.kind).toBe("keyboard_list");
  });

  test("parses a key_locations artifact", () => {
    const artifact: AgentArtifact = {
      kind: "key_locations",
      functionName: "KC_ESC",
      locations: [
        { layerId: "lay_base", layerName: "Base", position: 0, label: "Esc" },
        { layerId: "lay_nav", layerName: "Nav", position: 12, label: "Esc" },
      ],
    };
    const parsed = AgentArtifactSchema.parse(artifact);
    expect(parsed.kind).toBe("key_locations");
    if (parsed.kind === "key_locations") {
      expect(parsed.locations).toHaveLength(2);
    }
  });
});
