import { describe, expect, test } from "bun:test";
import { failureView } from "../../src/web/chat/failure-words.ts";

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
    for (const code of ["model_rate_limit", "model_overloaded", "model_connection", "model_server", "model_request", "agent_error", "stream"]) {
      expect(actions(code)).toEqual(["retry"]);
    }
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
