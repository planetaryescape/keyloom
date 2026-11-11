import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import type { AssistantTurn } from "../../src/web/chat/transcript.ts";
import { AssistantMessage } from "../../src/web/chat/Turns.tsx";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";

const board = await moonlander();
const { layout } = await importOryxSource(FIXTURE_DIR, board.definition);

const failed = (code: string, message: string): AssistantTurn => ({
  kind: "assistant", id: "a1", text: "", activity: null, proposals: [], priorities: [], question: null, phase: "failed", failure: { code, message }, ending: null,
});

const render = (turn: AssistantTurn, switchTo: { id: string; name: string }[] = []) =>
  renderToStaticMarkup(
    createElement(AssistantMessage, {
      turn, layout, board: board.definition, pinnedId: null, switchTo, onSetUpModel: () => {}, onNewConversation: () => {},
      onPreview: () => {}, onPin: () => {}, onApply: async () => {}, onRemovePriority: async () => {}, onAskAgain: () => {}, onOpenRelease: () => {}, onRetry: () => {}, onAnswer: () => {}, onSwitch: () => {},
    }),
  );

describe("a reply that stopped says why, in comp d2's words (P3)", () => {
  test("out of credits offers the other ready providers without claiming effects were rolled back", () => {
    const html = render(failed("model_no_credits", "OpenRouter says the account is out of credits."), [{ id: "codex", name: "Codex" }]);
    expect(html).toContain("Out of credits");
    expect(html).not.toContain("Nothing was changed.");
    expect(html).toContain("prepared before the reply stopped may remain");
    expect(html).toContain("Switch to Codex");
    expect(html).toContain("Try again");
  });

  test("a refused key is named and can switch too", () => {
    const html = render(failed("model_auth", "OpenRouter rejected the API key (401)."), [{ id: "codex", name: "Codex" }]);
    expect(html).toContain("The key was refused");
    expect(html).toContain("Switch to Codex");
  });

  test("a rate limit only retries: another provider would not help the request", () => {
    const html = render(failed("model_rate_limit", "Rate limit reached (429)."), [{ id: "codex", name: "Codex" }]);
    expect(html).toContain("The model is busy");
    expect(html).not.toContain("Switch to");
  });

  test("anything else keeps the plain title", () => {
    expect(render(failed("stream", "The connection dropped."))).toContain("The reply stopped");
  });

  test("a full conversation offers a new one instead of Try again (R4-11)", () => {
    const html = render(failed("model_context_full", "This conversation is too long for OpenRouter's model to read in one go."), [{ id: "codex", name: "Codex" }]);
    expect(html).toContain("This conversation is full");
    expect(html).toContain("Start a new conversation");
    expect(html).not.toContain("Try again");
    expect(html).not.toContain("Switch to");
  });

  test("a server failure names the service and retries", () => {
    const html = render(failed("model_server", "OpenRouter server error (500)."));
    expect(html).toContain("The model&#x27;s service had a problem");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Change the key");
  });

  test("a refused key opens the setup", () => {
    expect(render(failed("model_auth", "OpenRouter rejected the API key (401)."))).toContain("Change the key");
  });
});

