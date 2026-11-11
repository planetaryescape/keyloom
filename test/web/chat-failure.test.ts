import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import type { ChatPresentation } from "../../src/api/http.ts";
import type { AssistantTurn } from "../../src/web/chat/transcript.ts";
import { AssistantMessage } from "../../src/web/chat/Turns.tsx";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";

const board = await moonlander();
const { layout } = await importOryxSource(FIXTURE_DIR, board.definition);

const failed = (code: string, message: string): AssistantTurn => ({
  kind: "assistant", id: "a1", text: "", activity: null, proposals: [], priorities: [], question: null, phase: "failed", failure: { code, message }, ending: null,
});

const render = (turn: AssistantTurn, switchTo: { id: string; name: string }[] = [], busy = false) =>
  renderToStaticMarkup(
    createElement(AssistantMessage, {
      turn, layout, board: board.definition, pinnedId: null, switchTo, busy, onSetUpModel: () => {}, onNewConversation: () => {}, onSetUpOther: () => {}, onOpenHistory: () => {},
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

  test("a used-up plan switches to a ready provider, or sets one up when none is ready (R5-04)", () => {
    const message = "Your ChatGPT plan has used up its Codex allowance until 3:45 PM.";
    const ready = render(failed("model_usage_limit", message), [{ id: "anthropic", name: "Anthropic" }]);
    expect(ready).toContain("Your Codex usage limit is reached");
    expect(ready).toContain("until 3:45 PM");
    expect(ready).toContain("Switch to Anthropic");
    expect(ready).not.toContain("Set up another model");
    expect(ready).not.toContain("The model is busy");
    const none = render(failed("model_usage_limit", message));
    expect(none).toContain("Set up another model");
    expect(none).toContain("Try again");
  });

  test("a message keyloom may have accepted offers Open history and Ask again (R5-07)", () => {
    const html = render(failed("unconfirmed", "keyloom stopped answering. keyloom may already be answering it. Open history to see whether it did before you ask again."));
    expect(html).toContain("keyloom didn&#x27;t confirm your message");
    expect(html).toContain("Open history");
    expect(html).toContain("Ask again");
    expect(html).not.toContain(">Try again<");
    expect(html).not.toContain("Check them before trying again");
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

  test("a run that prepared nothing says nothing about prepared work (#288 review)", () => {
    const presentation: ChatPresentation = { version: 1, userMessageId: "m", status: "failed", operations: [], messages: [], effectsMayHaveOccurred: false, warning: null, detailsTruncated: false };
    const html = render({ ...failed("model_server", "OpenRouter server error (500)."), presentation });
    expect(html).not.toContain("may remain");
    expect(html).toContain("Try again");
  });

  test("a run that may have prepared something offers Ask again, not Try again (#288 review)", () => {
    const presentation: ChatPresentation = { version: 1, userMessageId: "m", status: "failed", operations: [], messages: [], effectsMayHaveOccurred: true, warning: null, detailsTruncated: false };
    const html = render({ ...failed("model_server", "OpenRouter server error (500)."), presentation });
    expect(html).toContain("Check them before you ask again.");
    expect(html).toContain("Ask again");
    expect(html).not.toContain("Try again");
  });

  test("while a reply is running, the box's buttons are off (#288 review)", () => {
    const html = render(failed("model_no_credits", "Out of credits."), [{ id: "codex", name: "Codex" }], true);
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    const off = (label: string) => new RegExp(`<button[^>]*disabled=""[^>]*>(?:(?!</button>).)*${label}`).test(html);
    expect(buttons.length).toBeGreaterThan(0);
    expect(off("Switch to Codex")).toBe(true);
    expect(off("Try again")).toBe(true);
  });

  test("a refused request offers a new conversation beside Try again (#288 review)", () => {
    const html = render(failed("model_request", "The model refused the request (400)."));
    expect(html).toContain("Start a new conversation");
    expect(html).toContain("Try again");
  });

  test("a refused key opens the setup", () => {
    expect(render(failed("model_auth", "OpenRouter rejected the API key (401)."))).toContain("Change the key");
  });
});

