import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentArtifact } from "../../src/api/artifacts.ts";
import { AssistantMessage } from "../../src/web/chat/Turns.tsx";
import type { AssistantTurn } from "../../src/web/chat/transcript.ts";
import { loadFixture } from "../server/fixture.ts";

const fixture = await loadFixture();

type Transfer = Extract<AgentArtifact, { kind: "transfer" }>;

const rich: Transfer = {
  kind: "transfer", sourceBoard: "Moonlander", destinationBoard: "Corne",
  mappedCount: 42, guessedCount: 5, skippedCount: 15,
  skipped: [
    { key: "Esc (Base)", reason: "no key on the new board does this" },
    { key: "Num Lock (Numbers)", reason: "the new board has no key in this place" },
  ],
  layers: [
    { source: "Base", target: "base", carried: 30, guessed: 5, notCarried: 12 },
    { source: "Navigation", target: "navigation", carried: 12, guessed: 0, notCarried: 3 },
  ],
  layerCount: 2,
  combos: { copied: 2, skipped: [{ id: "left-shift", why: "the new board has no key in this place" }], skippedCount: 1 },
  notes: ["LED colours were not carried: the Corne has no per-key lighting", "2 firmware settings were not carried"],
  noteCount: 2,
  placementCount: 1, placementsBlocked: 0,
};

const minimal: Transfer = {
  kind: "transfer", sourceBoard: "Glove80", destinationBoard: "Moonlander",
  mappedCount: 3, skipped: [],
};

const dropped40: Transfer = {
  ...rich, skippedCount: 80,
  skipped: Array.from({ length: 40 }, (_, i) => ({ key: `Key ${i} (Base)`, reason: "no key on the new board does this" })),
  layers: [], layerCount: 1, notes: [], noteCount: 0, combos: { copied: 0, skipped: [], skippedCount: 0 },
};

const turnOf = (artifacts?: AgentArtifact[]): AssistantTurn => ({
  kind: "assistant", id: "a", text: "I made a config for the Corne.", activity: null, proposals: [], priorities: [], question: null, phase: "done", failure: null, ending: "complete",
  ...(artifacts === undefined ? {} : { artifacts }),
});

const render = (artifacts?: AgentArtifact[]) => renderToStaticMarkup(createElement(AssistantMessage, {
  turn: turnOf(artifacts), layout: fixture.document, board: fixture.board, pinnedId: null,
  onPreview: () => {}, onPin: () => {}, onApply: async () => {}, onRemovePriority: async () => {}, onAskAgain: () => {}, onOpenRelease: () => {}, onRetry: () => {}, onAnswer: () => {},
}));

async function count(html: string, selector: string): Promise<number> {
  let found = 0;
  await new HTMLRewriter().on(selector, { element: () => { found += 1; } }).transform(new Response(html)).text();
  return found;
}

describe("the copy's report card", () => {
  test("names both boards, the carried and guessed counts, and the drops behind a closed disclosure", async () => {
    const html = render([rich]);
    expect(html).toContain("Moonlander");
    expect(html).toContain("Corne");
    expect(html).toContain("42 keys came across on 2 layers, 5 of them nearest-place guesses.");
    // The per-layer breakdown is detail, closed: the carried sentence leads and the drops sit above it.
    expect(await count(html, "details.transfer-layers-details")).toBe(1);
    expect(await count(html, "details.transfer-layers-details[open]")).toBe(0);
    expect(html).toContain("<summary>Carried by layer</summary>");
    expect(html).toContain("Base");
    expect(html).toContain("30 carried, 5 guessed, 12 left off");
    expect(html).toContain("Navigation");
    expect(html.indexOf("42 keys came across")).toBeLessThan(html.indexOf("Carried by layer"));
    expect(html.indexOf("Carried by layer")).toBeLessThan(html.indexOf("15 keys did not come across"));
    // Every dropped key with its own reason, and the count that says more exist.
    expect(html).toContain("15 keys did not come across");
    expect(html).toContain("Esc (Base)");
    expect(html).toContain("no key on the new board does this");
    expect(html).toContain("and 13 more");
    expect(await count(html, "details.transfer-drops")).toBe(1);
    expect(await count(html, "details.transfer-drops[open]")).toBe(0);
    expect(html).toContain("2 combos copied; 1 did not: left-shift (the new board has no key in this place)");
    expect(html).toContain("1 layer key had nowhere of its own and was placed on a free key.");
    expect(html).toContain("Left out");
    expect(html).toContain("LED colours were not carried");
    // The card sits in that conversation, so it does not tell the reader to go there.
    expect(html).not.toContain("continues in the new config");
    expect(html).not.toContain("unsupported");
    expect(html).not.toContain("successfully");
    expect(html).not.toContain("!");
    expect(html).toContain("<summary");
  });

  test("an older card with only the first fields still reads", async () => {
    const html = render([minimal]);
    expect(html).toContain("Glove80");
    expect(html).toContain("Moonlander");
    expect(html).toContain("All 3 keys came across.");
    expect(html).not.toContain("did not come across");
    expect(await count(html, "details.transfer-layers-details")).toBe(0);
    expect(html).not.toContain("combos copied");
    expect(html).not.toContain("Left out");
  });

  test("a copy that lost nothing says everything came across and shows no disclosure", async () => {
    const html = render([{ ...rich, skipped: [], skippedCount: 0, placementsBlocked: 0 }]);
    expect(html).toContain("All 42 keys came across on 2 layers, 5 of them nearest-place guesses.");
    expect(await count(html, ".transfer-drops")).toBe(0);
    expect(await count(html, "details.transfer-layers-details")).toBe(1);
    expect(html).not.toContain("did not come across");
  });

  test("a skipped combo says why, with the artifact's bound counted", async () => {
    const skipped = Array.from({ length: 12 }, (_, i) => ({ id: `combo-${i}`, why: "no confident counterpart on the target" }));
    const html = render([{ ...rich, combos: { copied: 0, skipped, skippedCount: 15 } }]);
    expect(html).toContain("No combos copied; 15 did not: combo-0 (no confident counterpart on the target)");
    expect(html).toContain("combo-11 (no confident counterpart on the target)");
    expect(html).not.toContain("combo-12 (");
    expect(html).toContain("and 3 more");
  });

  test("a copy whose only losses are not keys says everything came across and still lists them", async () => {
    const html = render([{ ...rich, skipped: [], skippedCount: 0, notes: ["LED colours were not carried", "2 firmware settings were not carried"], noteCount: 2 }]);
    expect(html).toContain("All 42 keys came across on 2 layers, 5 of them nearest-place guesses.");
    expect(html).not.toContain("did not come across");
    expect(html).toContain("Left out");
    expect(html).toContain("LED colours were not carried");
    expect(html).toContain("2 firmware settings were not carried");
    expect(await count(html, "details.transfer-drops")).toBe(0);
  });

  test("a drops list past the card's bound says how many more there were", async () => {
    const html = render([dropped40]);
    expect(html).toContain("80 keys did not come across");
    expect(html).toContain("Key 39 (Base)");
    expect(html).not.toContain("Key 40 (Base)");
    expect(html).toContain("and 40 more");
    expect(await count(html, ".transfer-drops li")).toBe(41);
    // One layer has nothing to break down, so no second disclosure.
    expect(await count(html, "details.transfer-layers-details")).toBe(0);
  });

  test("no artifacts render nothing; an artifact kind the page does not know is ignored, not thrown", async () => {
    const none = render(undefined);
    expect(await count(none, 'section[aria-label="Transfer report"]')).toBe(0);
    const unknown = render([{ kind: "a_kind_from_a_later_release" } as unknown as AgentArtifact]);
    expect(await count(unknown, 'section[aria-label="Transfer report"]')).toBe(0);
    expect(unknown).toContain("I made a config for the Corne.");
  });
});
