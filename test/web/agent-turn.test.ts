import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProposalCard } from "../../src/api/http.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { evaluate } from "../../src/validation/validate.ts";
import { AssistantMessage, UserMessage } from "../../src/web/chat/Turns.tsx";
import { Composer } from "../../src/web/chat/Composer.tsx";
import type { AssistantTurn } from "../../src/web/chat/transcript.ts";
import type { AgentWorkView } from "../../src/web/chat/work-view.ts";
import { loadFixture } from "../server/fixture.ts";

const fixture = await loadFixture();
const ops: ChangeOp[] = [{ op: "setBinding", at: { layerId: "base", position: 57 }, binding: { kind: "modifier", mods: ["LALT"] } }];
const proposal: ProposalCard = {
  changeSetId: "synthetic-proposal", proposalGroup: null, title: "An Option key", explanation: "A plain Option on the free key.",
  tradeoffs: { gains: [], costs: [] }, decisionDraft: null, status: "proposed", validation: evaluate(fixture.board, fixture.document, ops).result, ops,
};
const turn: AssistantTurn = {
  kind: "assistant", id: "answer", text: "Your preview is ready.", activity: null, proposals: [proposal], priorities: [], question: null, phase: "done", failure: null, ending: "complete",
};
const work: AgentWorkView = { kind: "observed", status: "completed", label: null, notes: [{ id: "note", text: "I checked the free key." }], operations: [{ id: "read", label: "Read the free key", status: "succeeded", target: "Moonlander · Daily", durationMs: 400, summary: null }] };
const render = (reply: AssistantTurn, working?: AgentWorkView) => {
  const props = {
    turn: reply, layout: fixture.document, board: fixture.board, pinnedId: proposal.changeSetId,
    onPreview: () => {}, onPin: () => {}, onApply: async () => {}, onRemovePriority: async () => {}, onAskAgain: () => {}, onOpenRelease: () => {}, onRetry: () => {}, onAnswer: () => {},
  };
  return renderToStaticMarkup(createElement(AssistantMessage, working === undefined ? props : { ...props, working }));
};

async function count(html: string, selector: string): Promise<number> {
  let found = 0;
  await new HTMLRewriter().on(selector, { element: () => { found++; } }).transform(new Response(html)).text();
  return found;
}

describe("agent turn composition", () => {
  test("the answer and working proposal remain outside the collapsed routine section", async () => {
    const html = render(turn, work);
    expect(html).toContain('aria-expanded="false"');
    expect(await count(html, ".agent-work-details .prose")).toBe(0);
    expect(await count(html, ".agent-work-details .proposal")).toBe(0);
    expect(await count(html, ".msg-assistant > .proposal-group")).toBe(1);
    expect(await count(html, ".proposal button")).toBeGreaterThan(0);
    expect(html).toContain("Your preview is ready.");
    expect(html).toContain("Apply");
  });

  test("an unanswered question defeats a stale completed presentation and stays outside working", async () => {
    const html = render({ ...turn, question: { toolUseId: "question", question: "Keep the old Option key?", options: [{ label: "Keep it" }], allowOther: false, answer: null } }, work);
    expect(html).toContain("Needs your answer");
    expect(html).toContain('aria-expanded="true"');
    expect(await count(html, ".agent-work-details .ask-card")).toBe(0);
    expect(await count(html, ".ask-card .ask-option")).toBe(1);
  });

  test("failure defeats a stale completion, preserves proposals and never claims rollback", async () => {
    const html = render({ ...turn, phase: "failed", failure: { code: "stream", message: "Connection dropped." } }, work);
    expect(html).toContain('aria-expanded="true"');
    expect(await count(html, ".agent-work-details .chat-problem")).toBe(0);
    expect(await count(html, ".msg-assistant > .proposal-group")).toBe(1);
    expect(html).toContain("prepared before the reply stopped may remain");
    expect(html).not.toContain("Nothing was changed");
  });

  test("legacy text stays intact without classifying prose or old tool-name hints", () => {
    const html = render({ ...turn, text: "Checking keys…\n\nThe preview is ready.", activity: "Invented completion from a tool name" });
    expect(html).toContain("Checking keys…");
    expect(html).toContain("The preview is ready.");
    expect(html).toContain("Working details unavailable for this conversation.");
    expect(html).not.toContain("Invented completion");
    expect(html).not.toContain("agent-work-disclosure");
  });

  test("the real transport presentation reaches the working component without a fixture prop", () => {
    const html = render({ ...turn, presentation: {
      version: 1, userMessageId: "request", status: "completed", messages: [{ id: "note", kind: "working_note", text: "I checked the spare thumb key." }],
      operations: [{ id: "op1", tool: "propose_changes", label: "Prepare proposals", status: "declined", durationMs: 75, accepted: 0, declined: 1, validationCodes: ["layer_trap"], references: [] }],
      warning: null, effectsMayHaveOccurred: true, detailsTruncated: false,
    } });
    expect(html).toContain("Prepare proposals");
    expect(html).toContain("Not accepted");
    expect(html).toContain("Validation: layer_trap");
    expect(html).not.toContain("Working details unavailable");
    expect(html).toContain("Your preview is ready.");
    expect(html).toContain("Apply");
  });

  test("stopped legacy replies warn that prepared effects may remain", () => {
    const html = render({ ...turn, phase: "stopped" });
    expect(html).toContain("Configs or proposals prepared before Stop may remain.");
    expect(html).not.toContain("Nothing was changed");
  });

  test("an explicit lost-connection observation is not rewritten as a successful or running phase", () => {
    const html = render({ ...turn, phase: "failed", failure: { code: "stream", message: "The connection dropped." } }, { ...work, status: "disconnected" });
    expect(html).toContain("Connection lost · outcome not confirmed");
    expect(html).not.toContain('data-active="true"');
  });

  test("requests carry explicit config context without changing the user's words", () => {
    const html = renderToStaticMarkup(createElement(UserMessage, { turn: { kind: "user", id: "user", text: "Keep the letters.", selection: { layerId: "base", positions: [32] } }, layout: fixture.document, context: "Moonlander · Daily" }));
    expect(html).toContain("Keep the letters.");
    expect(html).toContain("Selected on Base: S");
    expect(html).toContain("Moonlander · Daily");
  });

  test("Stop is in the composer, including quiet phone mode with no sendable draft", async () => {
    const html = renderToStaticMarkup(createElement(Composer, { value: "", onChange: () => {}, onSend: () => {}, onStop: () => {}, streaming: true, selection: null, onRemoveKey: () => {}, onClearSelection: () => {}, inputRef: { current: null }, quiet: { menu: null, onEscape: () => {}, placeholder: "Reply" } }));
    expect(await count(html, "form.composer .composer-row button.composer-stop")).toBe(1);
    expect(html).toContain('data-streaming="true"');
    expect(html).toContain(">Stop</button>");
  });
});
