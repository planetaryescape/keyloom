// "Put my Glove80 setup on my Corne" from chat (22, D-372): the agent's put_config tool runs the keyboard put as proposals on a new
// config. Nothing is applied, the conversation's layout is untouched, and the validator decides (D-014). The model is a fake.
import { describe, expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import type { ModelTool } from "../../src/agent/model.ts";
import { assembleSystemPrompt } from "../../src/agent/prompt.ts";
import { createTools } from "../../src/agent/tools/index.ts";
import { createAgentPorts } from "../../src/app/agent-ports.ts";
import { getLayout, importLayout, listChanges, listConfigs, openApp, sendMessage } from "../../src/app/index.ts";
import { getBoardConfig } from "../../src/persistence/configs.ts";
import { fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { STYLE_FIXTURE } from "../helpers/zmk.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { tempDir } from "../helpers/tmp.ts";

async function world() {
  const app = openApp({ dataDir: tempDir() });
  const glove = await importLayout(app, { board: "moergo/glove80", source: STYLE_FIXTURE, name: "my-glove80" });
  const moon = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "my-moonlander" });
  const tools = (layoutId: string) => {
    const proposals: unknown[] = [];
    const list = createTools(createAgentPorts(app, layoutId, "conv_test"), { validation() {} } as never, { onProposal: (p) => proposals.push(p), onPriority() {} });
    const run = async (name: string, input: unknown = {}) => String(await (list.find((t) => t.name === name) as ModelTool).run(input));
    return { run, proposals, names: list.map((t) => t.name) };
  };
  return { app, glove, moon, tools };
}

describe("put_config", () => {
  test("makes a new config on the other board with the mapping as proposals, and applies nothing", async () => {
    const { app, glove, moon, tools } = await world();
    const before = getLayout(app, moon.layoutId).revision.id;
    const t = tools(moon.layoutId);
    expect(t.names).toContain("put_config");
    const text = await t.run("put_config", { from: "my-glove80", board: "foostan/corne" });

    expect(text).toContain('Made the config "my-glove80 on Corne"');
    expect(text).toContain("Nothing was applied");
    expect(text).toContain("Put my-glove80 on the Corne");

    const made = listConfigs(app).find((c) => c.name === "my-glove80 on Corne");
    expect(made).toMatchObject({ boardId: "foostan/corne" });
    const stored = listChanges(app, made!.id);
    expect(stored.length).toBeGreaterThanOrEqual(1);
    expect(stored.every((c) => c.status === "proposed" && c.source === "agent" && c.validation.ok)).toBe(true);
    // The new config is still the blank it began as; the sources, the conversation's layout and the keyboard are as they were.
    expect(getLayout(app, made!.id).document.layers.every((l) => l.bindings.every((b) => b.kind === "none"))).toBe(true);
    expect(getLayout(app, moon.layoutId).revision.id).toBe(before);
    expect(getLayout(app, glove.layoutId).document.layers.length).toBeGreaterThan(1);
    expect(getBoardConfig(app.db, "foostan/corne")).toBe(made!.id);
    expect(listChanges(app, moon.layoutId)).toEqual([]);
    // It is not a proposal to this conversation's layout, so no card is raised in the chat.
    expect(t.proposals).toEqual([]);
  });

  test("errors the agent can read: an unknown layout or board, the same board, a taken name", async () => {
    const { glove, tools } = await world();
    const t = tools(glove.layoutId);
    await expect(t.run("put_config", { from: "my-glove80x", board: "foostan/corne" })).rejects.toThrow(/no layout/);
    await expect(t.run("put_config", { from: "my-glove80", board: "nope/nothing" })).rejects.toThrow();
    await expect(t.run("put_config", { from: "my-glove80", board: "moergo/glove80" })).rejects.toThrow(/already a Glove80 config/);
    await t.run("put_config", { from: "my-glove80", board: "foostan/corne" });
    await expect(t.run("put_config", { from: "my-glove80", board: "foostan/corne" })).rejects.toThrow(/already exists/);
    expect(await t.run("put_config", { from: "my-glove80", board: "foostan/corne", name: "Glove on Corne 2" })).toContain("Glove on Corne 2");
    await expect(t.run("put_config", { board: "foostan/corne" })).rejects.toThrow(/invalid input for put_config/);
  });

  test("the prompt tells the agent about it, and a chat turn on the fake model runs it", async () => {
    const { app, glove, moon } = await world();
    const view = getLayout(app, moon.layoutId);
    const prompt = assembleSystemPrompt(view.board, view.document);
    expect(prompt).toContain("`put_config`");
    expect(prompt).not.toContain("A chat tool that runs");

    const { client, requests } = fakeAnthropic([
      { blocks: [{ tool: "put_config", input: { from: "my-glove80", board: "foostan/corne" } }] },
      { blocks: [{ text: "I made a Glove80-on-Corne config with its proposals; nothing is on your keyboard." }] },
    ]);
    const result = await sendMessage(app, moon.layoutId, { message: "put my Glove80 setup on my Corne", model: anthropicModel(client) });
    expect(requests[1]?.toolResults.join("\n")).toContain("Nothing was applied");
    expect(result.proposals).toEqual([]);
    expect(listConfigs(app).some((c) => c.name === "my-glove80 on Corne")).toBe(true);
    expect(listChanges(app, moon.layoutId)).toEqual([]);
    expect(glove.layoutId).toBeTruthy();
  });
});
