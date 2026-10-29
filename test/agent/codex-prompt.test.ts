// How a stored conversation is replayed to Codex as text: a tool result is cut at 2,000 characters when the model can fetch it again, and what BK
// answered to a question is never cut, because nothing can fetch that again.
import { describe, expect, test } from "bun:test";
import { transcriptPrompt } from "../../src/agent/codex/prompt.ts";
import type { ModelMessage } from "../../src/agent/model.ts";

const text = (role: "user" | "assistant", words: string): ModelMessage => ({ role, content: [{ type: "text", text: words }] });
const call = (id: string, name: string): ModelMessage => ({ role: "assistant", content: [{ type: "tool_use", id, name, input: {} }] });
const result = (id: string, content: string): ModelMessage => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] });

describe("the transcript replayed to Codex", () => {
  const read = "R".repeat(3_000);
  const answer = `${"I keep my left hand on the home row. ".repeat(80)}So keep Backspace on the left.`;

  test("the answer to ask_user is whole, and a result of a tool Codex can call again is still cut", () => {
    const prompt = transcriptPrompt([text("user", "go"), call("read-1", "get_layout"), result("read-1", read), call("ask-1", "ask_user"), result("ask-1", answer)]);
    expect(prompt).toContain(`[result: ${answer}]`);
    expect(prompt).toContain(`[result: ${"R".repeat(2_000)}... (cut; call the tool again for the rest)]`);
    expect(prompt).not.toContain("R".repeat(2_001));
  });

  test("an answer that is not the last message is kept whole too", () => {
    const prompt = transcriptPrompt([text("user", "go"), call("ask-1", "ask_user"), result("ask-1", answer), text("assistant", "Left it is."), text("user", "thanks")]);
    expect(prompt).toContain(`[result: ${answer}]`);
    expect(prompt).toEndWith("BK's new message, which you are answering now:\nthanks");
  });
});
