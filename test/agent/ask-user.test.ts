// The agent's ask_user (D-380..D-382): the turn stops at the question, the transcript keeps it open across a reload, and the answer is
// the tool call's result. Scripted Anthropic behind the real SDK; nothing reaches a network.
import { describe, expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { assembleSystemPrompt } from "../../src/agent/prompt.ts";
import { createTools } from "../../src/agent/tools/index.ts";
import { createAgentPorts } from "../../src/app/agent-ports.ts";
import { getLayout, importLayout, listConfigs, openApp, sendMessage, showConversation } from "../../src/app/index.ts";
import { identityLayout } from "../../src/firmware/kanata/identity.ts";
import { createLayout } from "../../src/persistence/layouts.ts";
import { listMessages } from "../../src/persistence/conversations.ts";
import { fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { macbook } from "../helpers/macbook.ts";
import { STYLE_FIXTURE } from "../helpers/zmk.ts";
import { tempDir } from "../helpers/tmp.ts";

const QUESTION = {
  question: "Replace the config on your keyboard, or add this one beside it?",
  options: [{ label: "Add it as a new config", description: "The current one stays on the keyboard." }, { label: "Replace the current config" }],
  allowOther: true,
  considerations: ["Replacing leaves the old config in History."],
  step: { n: 1, of: 1 },
};

async function world() {
  const app = openApp({ dataDir: tempDir() });
  const glove = await importLayout(app, { board: "moergo/glove80", source: STYLE_FIXTURE, name: "my-glove80" });
  const mac = createLayout(app.db, { name: "my-macbook", layout: identityLayout(macbook()), summary: "identity", origin: "import" });
  return { app, glove, mac };
}

describe("ask_user", () => {
  test("the turn stops at the question, a reload shows it open, and the answer is the call's result", async () => {
    const { app, mac } = await world();
    const { client, requests } = fakeAnthropic([
      { blocks: [{ text: "One thing only you can decide." }, { tool: "ask_user", input: QUESTION }] },
      { blocks: [{ text: "Added it as a new config." }] },
    ]);
    const model = anthropicModel(client);
    const first = await sendMessage(app, mac.layout.id, { message: "move my setup over", model });

    expect(first.status).toBe("awaiting_answer");
    expect(requests).toHaveLength(1);
    expect(first.question).toMatchObject({ question: QUESTION.question, allowOther: true, answer: null });
    // Stored as the model sent it: the call has no result yet, so a reload shows the question open.
    const stored = listMessages(app.db, first.conversationId);
    expect(stored.at(-1)).toMatchObject({ role: "assistant" });
    expect(JSON.stringify(stored.at(-1)?.content)).toContain("ask_user");
    expect(JSON.stringify(stored.map((m) => m.content))).not.toContain("tool_result");
    const reloaded = showConversation(app, first.conversationId).messages.find((m) => m.question !== undefined);
    expect(reloaded?.question).toMatchObject({ toolUseId: first.question?.toolUseId, answer: null });

    const second = await sendMessage(app, mac.layout.id, { conversationId: first.conversationId, answer: { toolUseId: first.question?.toolUseId ?? "", text: "Add it as a new config" }, model });
    expect(second.status).toBe("complete");
    expect(requests).toHaveLength(2);
    expect(requests[1]?.toolResults).toEqual(["Add it as a new config"]);
    expect(second.text).toBe("Added it as a new config.");
    expect(showConversation(app, first.conversationId).messages.find((m) => m.question !== undefined)?.question?.answer).toBe("Add it as a new config");
  });

  test("an answer to a question that is not open is refused, and so is one for a question that was answered", async () => {
    const { app, mac } = await world();
    const { client } = fakeAnthropic([{ blocks: [{ tool: "ask_user", input: QUESTION }] }, { blocks: [{ text: "ok" }] }]);
    const model = anthropicModel(client);
    const first = await sendMessage(app, mac.layout.id, { message: "x", model });
    await expect(sendMessage(app, mac.layout.id, { conversationId: first.conversationId, answer: { toolUseId: "toolu_nope", text: "a" }, model })).rejects.toThrow(/not open/);
    await sendMessage(app, mac.layout.id, { conversationId: first.conversationId, answer: { toolUseId: first.question?.toolUseId ?? "", text: "a" }, model });
    await expect(sendMessage(app, mac.layout.id, { conversationId: first.conversationId, answer: { toolUseId: first.question?.toolUseId ?? "", text: "b" }, model })).rejects.toThrow(/not open/);
  });

  test("typing instead of pressing an option still answers it, so the next request is valid", async () => {
    const { app, mac } = await world();
    const { client, requests } = fakeAnthropic([{ blocks: [{ tool: "ask_user", input: QUESTION }] }, { blocks: [{ text: "Understood." }] }]);
    const model = anthropicModel(client);
    const first = await sendMessage(app, mac.layout.id, { message: "x", model });
    await sendMessage(app, mac.layout.id, { conversationId: first.conversationId, message: "just keep what I have", model });
    const last = requests[1]?.body.messages.at(-1);
    expect(last.content[0]).toMatchObject({ type: "tool_result", tool_use_id: first.question?.toolUseId });
    expect(last.content[1]).toMatchObject({ type: "text" });
  });

  test("a tool called beside the question runs first (D-452), and a second question beside it does not run and is told so", async () => {
    const { app, mac } = await world();
    const { client, requests } = fakeAnthropic([
      { blocks: [{ tool: "list_layouts", input: {} }, { tool: "ask_user", input: QUESTION }, { tool: "ask_user", input: QUESTION }] },
      { blocks: [{ text: "ok" }] },
    ]);
    const model = anthropicModel(client);
    const first = await sendMessage(app, mac.layout.id, { message: "x", model });
    expect(first.status).toBe("awaiting_answer");
    await sendMessage(app, mac.layout.id, { conversationId: first.conversationId, answer: { toolUseId: first.question?.toolUseId ?? "", text: "Add it as a new config" }, model });
    const results = requests[1]?.body.messages.at(-1).content.filter((b: { type: string }) => b.type === "tool_result");
    // The first question is the one answered; list_layouts ran, and the second question was not run.
    expect(results).toHaveLength(3);
    expect(results[0].content).toContain("2 layouts");
    expect(results[0].is_error).toBeUndefined();
    expect(results[1].content).toContain("Not run");
    expect(results[1].is_error).toBe(true);
    expect(results[2].content).toBe("Add it as a new config");
  });

  test("a message needs either words or an answer, never both", async () => {
    const { app, mac } = await world();
    const { client } = fakeAnthropic([]);
    const model = anthropicModel(client);
    await expect(sendMessage(app, mac.layout.id, { model })).rejects.toThrow(/either a message or an answer/);
    await expect(sendMessage(app, mac.layout.id, { message: "x", answer: { toolUseId: "t", text: "a" }, model })).rejects.toThrow(/either a message or an answer/);
  });

  test("the prompt tells the agent when to ask, and the tool is offered", async () => {
    const { app, mac } = await world();
    const view = getLayout(app, mac.layout.id);
    const prompt = assembleSystemPrompt(view.board, view.document);
    expect(prompt).toContain("`ask_user`");
    expect(prompt).toContain("Never ask in prose");
    const tools = createTools(createAgentPorts(app, mac.layout.id, "conv_test"), { validation() {} } as never, { onProposal() {}, onPriority() {} });
    const ask = tools.find((t) => t.name === "ask_user");
    expect(ask?.pauses).toBe(true);
    expect(ask?.description).toContain("Never for anything you can decide or default");
  });
});

describe("an explicit instruction is not asked again (D-380)", () => {
  test("the prompt says so, and a turn for \"replace\" goes straight to the work with no ask_user", async () => {
    const { app, mac } = await world();
    const view = getLayout(app, mac.layout.id);
    expect(assembleSystemPrompt(view.board, view.document)).toContain('"replace my config with the Glove80 one" means replace, so do it');
    const { client, requests } = fakeAnthropic([
      { blocks: [{ tool: "create_config", input: { name: "Glove80 setup", from: "this" } }] },
      { blocks: [{ text: "Done. Your old config stays in History and can be restored." }] },
    ]);
    const out = await sendMessage(app, mac.layout.id, { message: "Please replace my config with the Glove80 one", model: anthropicModel(client) });
    expect(out.status).toBe("complete");
    expect(out.question).toBeUndefined();
    expect(requests[0]?.body.tools.find((t: { name: string }) => t.name === "ask_user").description).toContain("never asked again");
    expect(JSON.stringify(listMessages(app.db, out.conversationId).map((m) => m.content))).not.toContain('"ask_user"');
  });
});

describe("a request to make a new config", () => {
  test("create_config makes it from this config at once, leaves this one untouched, and the prompt names no command", async () => {
    const { app, mac } = await world();
    const before = getLayout(app, mac.layout.id).revision.id;
    const { client, requests } = fakeAnthropic([
      { blocks: [{ tool: "create_config", input: { name: "Colemak", from: "this" } }] },
      { blocks: [{ text: "Made a Colemak config. Want me to start changing it?" }] },
    ]);
    const out = await sendMessage(app, mac.layout.id, { message: "make me a Colemak config", model: anthropicModel(client) });
    expect(out.status).toBe("complete");
    expect(requests[1]?.toolResults.join("\n")).toContain('Made the config "Colemak"');
    expect(listConfigs(app).some((c) => c.name === "Colemak")).toBe(true);
    expect(getLayout(app, mac.layout.id).revision.id).toBe(before);
    expect(requests[0]?.body.system).not.toMatch(/`keyloom [a-z]/);
    // keyloom opens the config and shows its card, so neither the prompt nor the tool result sends BK to the config menu.
    expect(requests[0]?.body.system).not.toMatch(/switch(es)? to it from the config menu/i);
    expect(requests[1]?.toolResults.join("\n")).not.toMatch(/config menu/i);
  });
});

describe("a request to copy a setup onto the keyboard", () => {
  test("goes ahead on the first turn: put_config is called, no ask_user, and no question comes back", async () => {
    const { app, mac } = await world();
    const { client, requests } = fakeAnthropic([
      { blocks: [{ tool: "put_config", input: { from: "my-glove80", board: "apple/macbook-ansi" } }] },
      { blocks: [{ text: "I copied your Glove80 setup onto this keyboard as a new config. I matched keys by what they type; say if you'd rather keep positions." }] },
    ]);
    const out = await sendMessage(app, mac.layout.id, { message: "Please put my config from the glove80 on this keyboard.", model: anthropicModel(client) });

    expect(out.status).toBe("complete");
    expect(out.question).toBeUndefined();
    // The first model reply already acted: the second request carries the put's result, and nothing was asked in between.
    expect(requests).toHaveLength(2);
    expect(requests[1]?.toolResults.join("\n")).toContain("Nothing was applied");
    expect(requests[0]?.body.system).toContain("Call it at once");
    expect(requests[0]?.body.tools.map((t: { name: string }) => t.name)).toContain("ask_user");
    expect(listConfigs(app).some((c) => c.name === "my-glove80 on MacBook keyboard (ANSI)")).toBe(true);
    expect(JSON.stringify(listMessages(app.db, out.conversationId).map((m) => m.content))).not.toContain("ask_user");
  });
});

describe("interactive question kinds (Rung 27)", () => {
  test("ask_user with kind key preserves key targets and answers correctly", async () => {
    const { app, mac } = await world();
    const keyQuestion = {
      kind: "key" as const,
      question: "Where should the Nav momentary key go?",
      options: [{ id: "24", label: "Key 24 (Thumb)" }, { id: "25", label: "Key 25" }],
      targetBoard: "apple/macbook-ansi",
      targetLayer: "lay_base",
      allowedPositions: [24, 25],
      considerations: ["It changes the proposal."], step: { n: 1, of: 1 },
    };
    const { client } = fakeAnthropic([
      { blocks: [{ tool: "ask_user", input: keyQuestion }] },
      { blocks: [{ text: "Placed Nav momentary on key 24." }] },
    ]);
    const model = anthropicModel(client);
    const first = await sendMessage(app, mac.layout.id, { message: "add nav key", model });
    expect(first.status).toBe("awaiting_answer");
    expect(first.question?.kind).toBe("key");
    expect(first.question?.allowedPositions).toEqual([24, 25]);
    expect(first.question?.options[0]?.id).toBe("24");

    const second = await sendMessage(app, mac.layout.id, {
      conversationId: first.conversationId,
      answer: { toolUseId: first.question?.toolUseId ?? "", text: "24" },
      model,
    });
    expect(second.status).toBe("complete");
    expect(second.text).toBe("Placed Nav momentary on key 24.");
  });

  test("ask_user with kind multiple_choice and short_text returns the typed answer", async () => {
    const { app, mac } = await world();
    const shortTextQ = {
      kind: "short_text" as const,
      question: "What should this config be called?",
      placeholder: "e.g. Work QWERTY",
      considerations: ["It changes the proposal."], step: { n: 1, of: 1 },
    };
    const { client } = fakeAnthropic([
      { blocks: [{ tool: "ask_user", input: shortTextQ }] },
      { blocks: [{ text: "Created config named Work QWERTY." }] },
    ]);
    const model = anthropicModel(client);
    const first = await sendMessage(app, mac.layout.id, { message: "new config", model });
    expect(first.status).toBe("awaiting_answer");
    expect(first.question?.kind).toBe("short_text");
    expect(first.question?.placeholder).toBe("e.g. Work QWERTY");

    const second = await sendMessage(app, mac.layout.id, {
      conversationId: first.conversationId,
      answer: { toolUseId: first.question?.toolUseId ?? "", text: "Work QWERTY" },
      model,
    });
    expect(second.status).toBe("complete");
    expect(second.text).toBe("Created config named Work QWERTY.");
  });
});
