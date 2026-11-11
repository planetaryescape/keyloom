import { describe, expect, test } from "bun:test";
import { failureView, preparedWords } from "../../src/web/chat/failure-words.ts";

// D-517: every code a failed reply can carry has a way out, and none repeats a request that cannot succeed.
describe("a reply that stopped offers what fixes it", () => {
  const actions = (code: string) => failureView({ code, message: "m" }).actions;

  test("account failures open the setup and offer another provider", () => {
    for (const code of ["model_no_credits", "model_auth", "model_permission", "missing_api_key"]) {
      expect(actions(code)).toContain("set_up_model");
      expect(actions(code)).toContain("switch");
    }
    expect(actions("model_no_credits")[0]).toBe("credits");
    expect(failureView({ code: "model_no_credits", message: "m" }).setUpLabel).toBe("Use another key");
    expect(failureView({ code: "model_auth", message: "m" }).setUpLabel).toBe("Change the key");
  });

  test("busy, unreachable and server failures retry, and don't offer a switch the account doesn't need", () => {
    for (const code of ["model_rate_limit", "model_overloaded", "model_connection", "model_server", "agent_error", "stream"]) {
      expect(actions(code)).toEqual(["retry"]);
    }
  });

  test("a refused request can also start a new conversation, since it can be refused the same way again (#288 review)", () => {
    expect(actions("model_request")).toEqual(["retry", "new_conversation"]);
  });

  test("a full conversation starts a new one, and never retries the same request (R4-11)", () => {
    expect(actions("model_context_full")).toEqual(["new_conversation"]);
    expect(failureView({ code: "model_context_full", message: "m" }).title).toBe("This conversation is full");
  });

  test("a model that isn't set up any more shows the page's words, not a terminal command", () => {
    const view = failureView({ code: "missing_api_key", message: "Codex is not signed in. Run `codex login` and sign in." });
    expect(view.message).not.toContain("codex login");
    expect(view.title).toBe("The model isn't set up");
  });

  test("every other code keeps the server's sentence under a plain title", () => {
    expect(failureView({ code: "model_server", message: "OpenRouter server error (500)." })).toMatchObject({ title: "The model's service had a problem", message: "OpenRouter server error (500)." });
    expect(failureView({ code: "anything", message: "x" }).title).toBe("The reply stopped");
  });
});

// #288 review: Try again starts the request over, and the model doesn't see what the stopped reply prepared.
describe("a stopped reply is honest about what it prepared", () => {
  test("prepared proposals and priorities are counted, and the button says Ask again", () => {
    expect(preparedWords({ proposals: 2, priorities: 1, mayHave: true }, true)).toEqual({
      note: "Before it stopped, this reply prepared 2 proposals and a priority. They are above. Asking again starts over and can prepare the same again.",
      retryLabel: "Ask again",
    });
    expect(preparedWords({ proposals: 1, priorities: 0, mayHave: true }, true).note).toStartWith("Before it stopped, this reply prepared a proposal. It is above.");
  });
  test("a run that may have prepared something it didn't show asks for a check first", () => {
    expect(preparedWords({ proposals: 0, priorities: 0, mayHave: true }, true)).toEqual({ note: "Configs or proposals it prepared before it stopped may remain. Check them before you ask again.", retryLabel: "Ask again" });
  });
  test("a run that prepared nothing says nothing more and keeps Try again", () => {
    expect(preparedWords({ proposals: 0, priorities: 0, mayHave: false }, true)).toEqual({ note: null, retryLabel: "Try again" });
  });
  test("a reply with no record of its effects keeps the careful sentence", () => {
    expect(preparedWords({ proposals: 0, priorities: 0, mayHave: null }, true)).toEqual({ note: "Configs or proposals prepared before the reply stopped may remain. Check them before trying again.", retryLabel: "Try again" });
  });
  test("with no retry offered, the words don't mention asking again", () => {
    expect(preparedWords({ proposals: 1, priorities: 0, mayHave: true }, false).note).toBe("Before it stopped, this reply prepared a proposal. It is above.");
    expect(preparedWords({ proposals: 0, priorities: 0, mayHave: null }, false).note).toBe("Configs or proposals prepared before the reply stopped may remain.");
  });
});
