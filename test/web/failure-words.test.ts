import { describe, expect, test } from "bun:test";
import { failureView, preparedWords } from "../../src/web/chat/failure-words.ts";
import { lostFailure, refusedBeforeStart, refusedRetryFailure } from "../../src/web/chat/useChat.ts";
import { ApiError } from "../../src/web/api.ts";

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

  test("a reply stopped by a server exception says so in keyloom's words, with Try again and Restart keyloom (R7-01)", () => {
    const view = failureView({ code: "internal", message: "internal error" });
    expect(view.actions).toEqual(["retry", "restart"]);
    expect(view.message).toBe("keyloom hit a problem it didn't expect. The details are in keyloom's log.");
  });

  test("a chat frame the page can't read offers only Restart keyloom, since the next frame would be the same (R7-09)", () => {
    const view = failureView({ code: "unreadable", message: "keyloom sent a chat frame this page can't read." });
    expect(view.actions).toEqual(["restart"]);
    expect(view.message).not.toMatch(/Reload the page|update keyloom/);
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

describe("round 5: a used-up plan, a refused retry and an unconfirmed message (R5-04, R5-05, R5-07)", () => {
  test("a used-up plan offers another provider, or its setup, and Try again for after the reset", () => {
    const view = failureView({ code: "model_usage_limit", message: "Your ChatGPT plan has used up its Codex allowance until 3:45 PM." });
    expect(view.title).toBe("Your Codex usage limit is reached");
    expect(view.message).toContain("until 3:45 PM");
    expect(view.actions).toEqual(["switch", "set_up_other", "retry"]);
    expect(view.setUpLabel).toBe("Set up another model");
  });

  test("a Try again the server refused keeps its code, so a signed-out provider offers the setup", () => {
    const failure = refusedRetryFailure(new ApiError(503, "Codex is not signed in. Run `codex login`…", { code: "missing_api_key" }));
    expect(failure.code).toBe("missing_api_key");
    expect(failureView(failure).actions).toEqual(["set_up_model", "switch", "retry"]);
    expect(refusedRetryFailure(new ApiError(429, "Rate limit reached.", { code: "model_rate_limit" })).code).toBe("model_rate_limit");
    expect(refusedRetryFailure(new ApiError(400, "bad", {})).code).toBe("retry");
  });

  test("a request lost before keyloom confirmed it offers Open history and Ask again", () => {
    const failure = lostFailure(new ApiError(0, "keyloom stopped answering.", { code: "unreachable" }), false);
    expect(failure.code).toBe("unconfirmed");
    expect(failure.message).toContain("Open history");
    const view = failureView(failure);
    expect(view.actions).toEqual(["open_history", "retry"]);
    expect(view.retryLabel).toBe("Ask again");
    // Once the reply was seen starting, the failure keeps the server's code.
    expect(lostFailure(new ApiError(502, "x", { code: "model_connection" }), true)).toEqual({ code: "model_connection", message: "x" });
    expect(lostFailure(new Error("cut"), true)).toEqual({ code: "stream", message: "cut" });
  });

  test("a 5xx with the server's own code before the reply started is a refusal, not an unconfirmed message", () => {
    // The server sends `start` once it has stored the message, so these stored nothing: the message goes back to the composer.
    expect(refusedBeforeStart(new ApiError(503, "This keyloom can't save keys.", { code: "key_store_unavailable" }), false)).toBe(true);
    expect(refusedBeforeStart(new ApiError(502, "keyloom couldn't save the key.", { code: "key_store_failed" }), false)).toBe(true);
    expect(refusedBeforeStart(new ApiError(503, "Codex is not signed in.", { code: "missing_api_key" }), false)).toBe(true);
    expect(refusedBeforeStart(new ApiError(409, "busy", { code: "busy" }), false)).toBe(true);
    // An internal error or a lost connection may come after the message was kept.
    expect(refusedBeforeStart(new ApiError(500, "internal error", { code: "internal" }), false)).toBe(false);
    expect(refusedBeforeStart(new ApiError(502, "keyloom sent no reply."), false)).toBe(false);
    expect(refusedBeforeStart(new ApiError(0, "keyloom stopped answering.", { code: "unreachable" }), false)).toBe(false);
    expect(refusedBeforeStart(new Error("cut"), false)).toBe(false);
    // Once the reply started, nothing is a refusal.
    expect(refusedBeforeStart(new ApiError(400, "bad", { code: "usage" }), true)).toBe(false);
  });
});
