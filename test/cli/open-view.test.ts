import { expect, test } from "bun:test";
import { runCli } from "../../src/cli/main.ts";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { optionOptionApp } from "../helpers/option-option.ts";

for (const command of ["chat", "agent"] as const) test(`${command}: real SDK loop receives unavailable before final reply and inspection preserves it`, async () => {
  const { app, dir } = await optionOptionApp();
  app.db.close();
  const fake = fakeAnthropic([
    { blocks: [{ tool: "open_view", input: { view: "history" } }] },
    (seen) => {
      expect(seen.toolResults.map((value) => JSON.parse(value))).toEqual([{ version: 1, status: "unavailable", reason: "unsupported" }]);
      return { blocks: [{ text: "History is unavailable in this terminal; no browser was opened." }] };
    },
  ]);
  const cli = async (args: string[]) => {
    let output = "";
    let error = "";
    const code = await runCli(["--data-dir", dir, "--format", "json", ...args], { isTTY: false, out: (text) => { output += text; }, err: (text) => { error += text; } }, { model: anthropicModel(fake.client) });
    expect({ code, error }).toEqual({ code: 0, error: "" });
    return JSON.parse(output);
  };
  const sent = await cli(command === "chat" ? ["chat", "bk", "--message", "Open History"] : ["agent", "start", "bk", "Open History", "--request-id", "terminal-view"]);
  const conversation = command === "chat" ? sent.conversation_id : sent.conversationId;
  const detail = await cli(["conversations", "show", conversation]);
  expect(detail.presentations[0].viewIntents).toBeUndefined();
  expect(detail.presentations[0].operations[0]).toMatchObject({ tool: "open_view", status: "declined" });
  expect(fake.requests).toHaveLength(2);
  expect(JSON.stringify(detail)).toContain("History is unavailable in this terminal");
});
