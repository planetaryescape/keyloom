import { describe, expect, test } from "bun:test";
import type { AgentModel } from "../../src/agent/model.ts";
import { drainAgentRuns, inspectAgentRun, startAgentRun, waitForAgentRun } from "../../src/app/agent-runs.ts";
import { runFailure } from "../../src/app/conversations.ts";
import { showConversation } from "../../src/app/index.ts";
import { classifiedFailure, failingModel, MODEL_FAILURES, type FailureKind } from "../helpers/model-failures.ts";
import { optionOptionApp } from "../helpers/option-option.ts";

const KINDS = Object.keys(MODEL_FAILURES) as FailureKind[];

// R4-02: a run the provider fails after keyloom accepted it kept no reason, so the page showed no reason and no button.
describe("a run that fails after acceptance keeps why", () => {
  for (const kind of KINDS) {
    test(`${kind}: the saved run carries model_${kind} and the provider's sentence`, async () => {
      const { app, layoutId } = await optionOptionApp();
      try {
        const accepted = await startAgentRun(app, { version: 1, requestId: `fail-${kind}`, layoutRef: layoutId, input: { message: "Give me Option, Option" } }, { model: failingModel(kind) });
        const finished = await waitForAgentRun(app, accepted.id);
        expect(finished.status).toBe("failed");
        const expected = classifiedFailure(kind);
        expect(finished.presentation?.status).toBe("failed");
        expect(finished.presentation?.failure).toEqual({ code: `model_${expected.kind}`, message: expected.message });
        // A reload reads the same reason from the conversation's history.
        const reopened = showConversation(app, finished.conversationId).presentations?.find((p) => p.userMessageId === finished.userMessageId);
        expect(reopened?.failure).toEqual(finished.presentation?.failure);
        expect(inspectAgentRun(app, accepted.id).presentation?.failure?.code).toBe(`model_${expected.kind}`);
      } finally { await drainAgentRuns(app); app.db.close(); }
    });
  }

  test("a prompt that is too long is context_full, not a generic request failure (R4-11)", () => {
    expect(classifiedFailure("context_full").kind).toBe("context_full");
    expect(classifiedFailure("server").kind).toBe("server");
    expect(classifiedFailure("connection").kind).toBe("connection");
  });

  test("the provider's sentence is shown without the raw JSON body", () => {
    expect(classifiedFailure("permission").message).toBe("OpenRouter denied the request (403): This key may not use anthropic/claude-opus-5.5");
    expect(classifiedFailure("server").message).toBe("OpenRouter server error (500): Internal server error");
  });

  test("out of credits names no terminal flag, so the page can show it beside its buttons", () => {
    expect(classifiedFailure("no_credits").message).not.toContain("--provider");
  });

  test("a failure that isn't the model's is shown without its internal text", async () => {
    const { app, layoutId } = await optionOptionApp();
    const broken: AgentModel = { provider: "anthropic", model: "synthetic", effort: "medium", classifyError: () => null, run: () => Promise.reject(new Error("TypeError at /Users/someone/secret.ts:12")) };
    try {
      const accepted = await startAgentRun(app, { version: 1, requestId: "bug", layoutRef: layoutId, input: { message: "Hi" } }, { model: broken });
      const finished = await waitForAgentRun(app, accepted.id);
      expect(finished.presentation?.failure?.code).toBe("agent_error");
      expect(finished.presentation?.failure?.message).not.toContain("secret");
    } finally { await drainAgentRuns(app); app.db.close(); }
  });

  test("a model that is no longer set up gets the code a refusal before acceptance gets", () => {
    expect(runFailure({ kind: "missing_key", message: "Codex is not signed in." })).toEqual({ code: "missing_api_key", message: "Codex is not signed in." });
  });
});
