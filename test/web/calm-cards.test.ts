import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProposalCard } from "../../src/api/http.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { evaluate } from "../../src/validation/validate.ts";
import { AssistantMessage } from "../../src/web/chat/Turns.tsx";
import { leadSentence } from "../../src/web/chat/proposal-facts.ts";
import type { AssistantTurn } from "../../src/web/chat/transcript.ts";
import { TurnUsage } from "../../src/web/chat/TurnUsage.tsx";
import { loadFixture } from "../server/fixture.ts";

const fixture = await loadFixture();
const ops: ChangeOp[] = [{ op: "setBinding", at: { layerId: "base", position: 57 }, binding: { kind: "modifier", mods: ["LALT"] } }];
const validation = evaluate(fixture.board, fixture.document, ops).result;
const card = (id: string, over: Partial<ProposalCard> = {}): ProposalCard => ({
  changeSetId: id, proposalGroup: null, title: `Option ${id}`, explanation: "A plain Option on the free key. It keeps every other key where it is.",
  tradeoffs: { gains: ["Option is one press"], costs: ["Nothing else moves"] }, decisionDraft: null, status: "proposed", validation, ops, ...over,
});
const turnOf = (proposals: ProposalCard[]): AssistantTurn => ({
  kind: "assistant", id: "a", text: "Here you go.", activity: null, proposals, priorities: [], question: null, phase: "done", failure: null, ending: "complete",
});
const render = (proposals: ProposalCard[]) => renderToStaticMarkup(createElement(AssistantMessage, {
  turn: turnOf(proposals), layout: fixture.document, board: fixture.board, pinnedId: proposals[0]?.changeSetId ?? null, compact: true,
  onPreview: () => {}, onPin: () => {}, onApply: async () => {}, onRemovePriority: async () => {}, onAskAgain: () => {}, onOpenRelease: () => {}, onRetry: () => {}, onAnswer: () => {},
}));
async function count(html: string, selector: string): Promise<number> {
  let found = 0;
  await new HTMLRewriter().on(selector, { element: () => { found++; } }).transform(new Response(html)).text();
  return found;
}

describe("leadSentence", () => {
  test("splits at the first sentence end and keeps the rest", () => {
    expect(leadSentence("One. Two. Three.")).toEqual({ lead: "One.", rest: "Two. Three." });
    expect(leadSentence("No end")).toEqual({ lead: "No end", rest: "" });
    expect(leadSentence("  ")).toEqual({ lead: "", rest: "" });
    expect(leadSentence("Only one.")).toEqual({ lead: "Only one.", rest: "" });
  });
});

describe("a proposal in chat", () => {
  test("says the change in a line, the numbers once, and keeps the rest behind Details", async () => {
    const html = render([card("one")]);
    expect(html).toContain("A plain Option on the free key.");
    expect(await count(html, ".proposal-why")).toBe(1);
    // The rest of the explanation and the lists are in the collapsed details, not at rest.
    expect(await count(html, '.proposal-details-toggle[aria-expanded="false"]')).toBe(1);
    expect(html).toMatch(/<div id="[^"]+" hidden="">[\s\S]*It keeps every other key where it is\./);
    expect(html).not.toContain("Trade-off:");
    expect(html).toContain("1 key changes");
    expect(await count(html, ".proposal-tabs")).toBe(0);
  });

  test("a proposal with no costs and no gains shows no cost line and no empty headings", async () => {
    const html = render([card("one", { tradeoffs: { gains: [], costs: [] }, explanation: "Just this." })]);
    expect(await count(html, ".proposal-cost")).toBe(0);
    expect(html).not.toContain("<h4>Gains</h4>");
    expect(html).not.toContain("<h4>Costs</h4>");
    expect(await count(html, ".proposal-details-toggle")).toBe(1);
  });

  test("a long cost list stays in one cost element, in full, for the line clamp", () => {
    const costs = [`${"F1, ".repeat(200)}and more`];
    expect(render([card("one", { tradeoffs: { gains: [], costs } })])).toContain(costs[0] as string);
  });

  test("alternatives are one row of tabs above the card, and the card has its own actions after", async () => {
    const html = render([card("a", { proposalGroup: "g" }), card("b", { proposalGroup: "g" })]);
    expect(await count(html, '.proposal-compact > .proposal-tabs[role="tablist"] > .proposal-tab')).toBe(2);
    expect(html.indexOf("proposal-tabs")).toBeLessThan(html.indexOf("proposal-title"));
    expect(await count(html, ".proposal-bar-foot .proposal-tabs")).toBe(0);
  });

  test("warnings are one line with the full text a tap away, and several fold into a count", async () => {
    const issue = (n: number) => ({ code: "layer_unreachable", message: `Layer ${n} can't be reached: no key switches to it.` });
    const one = render([card("one", { validation: { ...validation, warnings: [issue(4)] } })]);
    expect(await count(one, '.proposal-notes-toggle[aria-expanded="false"]')).toBe(1);
    expect(one).toContain("Layer 4 can&#x27;t be reached");
    const many = render([card("one", { validation: { ...validation, warnings: [issue(4), issue(5), issue(6)] } })]);
    expect(many).toContain("3 warnings");
    expect(await count(many, ".proposal-notes ul[hidden] > li")).toBe(3);
    expect(await count(render([card("one", { validation: { ...validation, warnings: [], errors: [] } })]), ".proposal-notes")).toBe(0);
  });
});

describe("the reply footer", () => {
  const usage = { inputTokens: 300, outputTokens: 150, cacheReadTokens: 0, cacheCreationTokens: 0 };
  const accounting = { provider: "anthropic" as const, model: "claude-opus-5-5", usage };

  test("at rest it is the dollar figure on a real button, with the accounting words collapsed", async () => {
    const html = renderToStaticMarkup(createElement(TurnUsage, { accounting }));
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>\$0\.0042<\/button>/);
    expect(await count(html, "p[hidden]")).toBe(1);
    expect(html).toContain("USD estimated");
  });

  test("an unknown cost never shows a number at rest", () => {
    const html = renderToStaticMarkup(createElement(TurnUsage, { accounting: { ...accounting, model: "other" } }));
    expect(html).toMatch(/>Cost not reported<\/button>/);
    expect(html).not.toMatch(/>\$[0-9<]/);
    expect(renderToStaticMarkup(createElement(TurnUsage, { accounting: undefined }))).toMatch(/>Cost not reported<\/button>/);
  });
});
