// The agent knows configs exist (25): list_layouts says which one is on each keyboard, and the prompt tells it that "a Colemak config"
// is a new config, not a layer.
import { describe, expect, test } from "bun:test";
import { assembleSystemPrompt } from "../../src/agent/prompt.ts";
import type { ModelTool } from "../../src/agent/model.ts";
import { createTools } from "../../src/agent/tools/index.ts";
import { createAgentPorts } from "../../src/app/agent-ports.ts";
import { archiveConfig, getLayout, importLayout, newConfig, openApp } from "../../src/app/index.ts";
import { setBoardConfig } from "../../src/persistence/configs.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { tempDir } from "../helpers/tmp.ts";

async function setup() {
  const app = openApp({ dataDir: tempDir() });
  const qwerty = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "QWERTY" });
  const colemak = newConfig(app, { name: "Colemak", from: "config", config: qwerty.layoutId });
  const list = (layoutId: string) => async () => {
    const tools = createTools(createAgentPorts(app, layoutId, "conv_test"), { validation() {} } as never, { onProposal() {}, onPriority() {} });
    return String(await (tools.find((t) => t.name === "list_layouts") as ModelTool).run({}));
  };
  return { app, qwerty, colemak, list };
}

describe("list_layouts and configs", () => {
  test("marks the config on the keyboard, whichever one the conversation is about", async () => {
    const { qwerty, colemak, list } = await setup();
    const text = await list(colemak.id)();
    const lineOf = (name: string) => text.split("\n").find((l) => l.includes(`"${name}"`)) ?? "";
    expect(lineOf("QWERTY")).toContain("the config on BK's Moonlander");
    expect(lineOf("Colemak")).toContain("THIS conversation's layout");
    expect(lineOf("Colemak")).toContain("not on the keyboard");
    expect(lineOf("Colemak")).not.toContain("the config on BK's");
    expect(qwerty.layoutId).toBeTruthy();
  });

  test("follows a switch, and says when a config is archived", async () => {
    const { app, qwerty, colemak, list } = await setup();
    setBoardConfig(app.db, "zsa/moonlander", colemak.id);
    archiveConfig(app, qwerty.layoutId);
    const text = await list(colemak.id)();
    expect(text.split("\n").find((l) => l.includes('"Colemak"'))).toContain("the config on BK's Moonlander");
    expect(text.split("\n").find((l) => l.includes('"QWERTY"'))).toContain("archived config");
  });
});

describe("the prompt", () => {
  test("says a Colemak config is a new config and not a layer, and that the agent can't make one", async () => {
    const { app, qwerty } = await setup();
    const view = getLayout(app, qwerty.layoutId);
    const prompt = assembleSystemPrompt(view.board, view.document);
    expect(prompt).toContain("# Configs");
    expect(prompt).toMatch(/"Make me a Colemak config".*new config, never a layer/);
    expect(prompt).toContain("keyloom config new");
    expect(prompt).toContain("`list_layouts`: every layout (config)");
  });
});
