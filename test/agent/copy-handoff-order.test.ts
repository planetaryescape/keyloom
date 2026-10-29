import { expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { codexModel } from "../../src/agent/codex-model.ts";
import { sendMessage, listLayouts, showConversation } from "../../src/app/index.ts";
import { drainAgentRuns, waitForAgentRun } from "../../src/app/agent-runs.ts";
import { optionOptionApp } from "../helpers/option-option.ts";
import { fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { fakeCodex } from "../helpers/fake-codex.ts";
import { tempDir } from "../helpers/tmp.ts";

const ask = { tool: "ask_user", input: { question: "Keep this placement?", considerations: ["It affects reach."], step: { n: 1, of: 1 }, options: [{ label: "Keep" }, { label: "Change" }] } };
for (const provider of ["anthropic", "openrouter"] as const) {
  test(`${provider}: successful copy completes before batched question, proposal or second copy`, async () => {
    const { app, layoutId } = await optionOptionApp();
    const put = { tool: "put_config", input: { from: layoutId, board: "moergo/glove80", name: "One copy" } };
    const { client } = fakeAnthropic([{ blocks: [put, ask, { tool: "propose_changes", input: {} }, { ...put, input: { ...put.input, name: "Must not exist" } }] }, { blocks: [{ text: "Target preparing." }] }]);
    try {
      const result = await sendMessage(app, layoutId, { message: "Copy", model: anthropicModel(client, { provider }) });
      expect(result.status).toBe("complete");
      expect(result.question).toBeUndefined();
      expect(result.handoff).toBeDefined();
      if (result.handoff) await waitForAgentRun(app, result.handoff.runId);
      expect(listLayouts(app).filter((value) => value.name === "One copy")).toHaveLength(1);
      expect(listLayouts(app).some((value) => value.name === "Must not exist")).toBe(false);
      expect(showConversation(app, result.conversationId).messages.some((message) => message.question !== undefined)).toBe(false);
    } finally { await drainAgentRuns(app); app.db.close(); }
  });
  test(`${provider}: an earlier question prevents copy; failed copy followed by valid question remains answerable`, async () => {
    for (const failedFirst of [false, true]) {
      const { app, layoutId } = await optionOptionApp();
      const put = { tool: "put_config", input: { from: layoutId, board: "moergo/glove80", name: failedFirst ? "bk" : "Must not exist" } };
      const { client } = fakeAnthropic([{ blocks: failedFirst ? [put, ask] : [ask, put] }]);
      try {
        const result = await sendMessage(app, layoutId, { message: "Copy", model: anthropicModel(client, { provider }) });
        expect(result.status).toBe("awaiting_answer");
        expect(result.handoff).toBeUndefined();
        expect(result.question?.answer).toBeNull();
        expect(listLayouts(app).some((value) => value.name === "Must not exist")).toBe(false);
      } finally { await drainAgentRuns(app); app.db.close(); }
    }
  });
}

test("Codex refuses calls following a successful copy even before its buffered completion arrives", async () => {
  const { app, layoutId } = await optionOptionApp();
  const fake = fakeCodex({ steps: [
    { call: "put_config", input: { from: layoutId, board: "moergo/glove80", name: "Codex copy" }, deferCompletion: true },
    { call: "ask_user", input: ask.input },
    { call: "put_config", input: { from: layoutId, board: "moergo/glove80", name: "Must not exist" } },
  ] });
  try {
    const result = await sendMessage(app, layoutId, { message: "Copy", model: codexModel({ env: { PATH: process.env.PATH, CODEX_HOME: tempDir("copy-codex-"), KEYLOOM_CODEX_BIN: fake.bin } }) });
    expect(result.status).toBe("complete");
    expect(result.question).toBeUndefined();
    if (result.handoff) await waitForAgentRun(app, result.handoff.runId);
    expect(listLayouts(app).filter((value) => value.name === "Codex copy")).toHaveLength(1);
    expect(listLayouts(app).some((value) => value.name === "Must not exist")).toBe(false);
  } finally { await drainAgentRuns(app); app.db.close(); }
});

test("a failed copy name can be corrected in the same source turn", async () => {
  const { app, layoutId } = await optionOptionApp();
  const { client } = fakeAnthropic([
    { blocks: [{ tool: "put_config", input: { from: layoutId, board: "moergo/glove80", name: "bk" } }] },
    { blocks: [{ tool: "put_config", input: { from: layoutId, board: "moergo/glove80", name: "Corrected copy" } }] },
    { blocks: [{ text: "Target continuation." }] },
  ]);
  try {
    const result = await sendMessage(app, layoutId, { message: "Copy", model: anthropicModel(client) });
    expect(result.status).toBe("complete");
    expect(result.handoff).toBeDefined();
    if (result.handoff) await waitForAgentRun(app, result.handoff.runId);
    expect(listLayouts(app).filter((layout) => layout.name === "Corrected copy")).toHaveLength(1);
  } finally { await drainAgentRuns(app); app.db.close(); }
});
