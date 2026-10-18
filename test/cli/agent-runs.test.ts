import { expect, test } from "bun:test";
import { runCli } from "../../src/cli/main.ts";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { optionOptionApp } from "../helpers/option-option.ts";

test("CLI starts, inspects, answers once and cancels the same persisted synthetic work", async () => {
  const { app, dir } = await optionOptionApp();
  app.db.close();
  const fake = fakeAnthropic([
    { blocks: [{ tool: "ask_user", input: { question: "Which?", options: [{ label: "Left" }, { label: "Right" }] } }] },
    { blocks: [{ text: "Saved CLI answer" }] },
  ]);
  const model = anthropicModel(fake.client);
  const cli = async (args: string[]) => {
    let output = "";
    let error = "";
    const code = await runCli(["--data-dir", dir, "--format", "json", "agent", ...args], { isTTY: false, out: (text) => { output += text; }, err: (text) => { error += text; } }, { model });
    expect({ code, error }).toEqual({ code: 0, error: "" });
    return JSON.parse(output);
  };
  const started = await cli(["start", "bk", "Ask once", "--request-id", "cli-start"]);
  expect(started.status).toBe("waiting_user");
  expect((await cli(["show", started.id])).id).toBe(started.id);
  const answered = await cli(["answer", started.id, started.presentation.questionToolUseId, "Left", "--request-id", "cli-answer"]);
  expect(answered.status).toBe("completed");
  expect((await cli(["answer", started.id, started.presentation.questionToolUseId, "Left", "--request-id", "cli-answer"])).id).toBe(answered.id);
  expect((await cli(["cancel", answered.id])).status).toBe("completed");
  expect(fake.requests).toHaveLength(2);
});

test("CLI explicitly records a pending request Stop without inventing a run", async () => {
  const { app, dir } = await optionOptionApp();
  app.db.close();
  let output = "";
  expect(await runCli(["--data-dir", dir, "--format", "json", "agent", "cancel", "not-accepted", "--request"], { isTTY: false, out: (text) => { output += text; }, err: () => {} })).toBe(0);
  expect(JSON.parse(output)).toEqual({ schema_version: 1, version: 1, status: "pending_acceptance", requestId: "not-accepted", cancelRequested: true });
});
