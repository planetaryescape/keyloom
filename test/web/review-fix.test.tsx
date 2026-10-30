// Fix issues in the board review (D-461): the button shows when a change can fix what the review found, and the chat is asked to start
// exactly one run per press — not twice for React's double mount effect, and not at all while the review is stale, being written, busy or
// without a ready model.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatProviderStatusSchema } from "../../src/api/http.ts";
import { fixableFindings, type ReviewItem } from "../../src/validation/review-item.ts";
import { activeProviderReady } from "../../src/web/chat/provider-ready.ts";
import { createOneShot, sendOnce } from "../../src/web/chat/one-shot.ts";
import { FixIssuesButton } from "../../src/web/review/FixIssues.tsx";

const item = (over: Partial<ReviewItem>): ReviewItem => ({
  id: "check:keys_do_nothing::layer-0/33", source: "check", kind: "hint", severity: "info", code: "keys_do_nothing",
  title: "A key does nothing", body: "Pressing it types nothing.", keys: [{ layerId: "layer-0", position: 33 }], layers: ["layer-0"],
  proposalId: null, fixes: [], dismissedAt: null, ...over,
});

const button = (over: Partial<Parameters<typeof FixIssuesButton>[0]> = {}) =>
  renderToStaticMarkup(createElement(FixIssuesButton, { findings: 2, stale: false, busy: false, reviewing: false, ready: true, onFix: () => {}, ...over }));

describe("Fix issues", () => {
  test("shows, enabled, when there is something to fix and a model to do it with", () => {
    const html = button();
    expect(html).toContain("Fix issues");
    expect(html).not.toContain("disabled");
  });

  test("is not offered when the review found nothing a change can fix", () => {
    expect(button({ findings: 0 })).toBe("");
  });

  test("is disabled with the reason while the review is stale, being written, busy, or without a ready model", () => {
    expect(button({ stale: true })).toContain("keyloom is looking over your change");
    expect(button({ stale: true })).toContain("disabled");
    expect(button({ reviewing: true })).toContain("keyloom&#x27;s own look is still coming");
    expect(button({ busy: true })).toContain("Finish the review action first");
    expect(button({ ready: false })).toContain("Set up a model to fix the issues");
    for (const over of [{ stale: true }, { reviewing: true }, { busy: true }, { ready: false }]) expect(button(over)).toContain("disabled");
  });

  test("the trigger is the visible problems and hints: a suggestion is already a proposal, a hidden finding is his decision", () => {
    const hint = item({});
    const problem = item({ id: "check:layer_unreachable::layer-1", kind: "problem", severity: "error", code: "layer_unreachable" });
    const suggestion = item({ id: "agent:empty-key-use::layer-0/33", source: "agent", kind: "suggestion", proposalId: "cs_1" });
    expect(fixableFindings([hint, problem, suggestion]).map((i) => i.id)).toEqual([hint.id, problem.id]);
    expect(fixableFindings([suggestion])).toEqual([]);
    expect(fixableFindings([item({ dismissedAt: 1 })])).toEqual([]);
  });
});

describe("the model that answers", () => {
  const status = (ready: boolean, active: "anthropic" | null = "anthropic") =>
    ChatProviderStatusSchema.parse({
      active: active === null ? null : { provider: active, model: "a-model", effort: "high" },
      providers: [
        { id: "anthropic", label: "Anthropic", defaultModel: "a-model", ready, setup: "Set ANTHROPIC_API_KEY", command: "export ANTHROPIC_API_KEY=…" },
        { id: "openrouter", label: "OpenRouter", defaultModel: "b-model", ready: false, setup: "Set OPENROUTER_API_KEY", command: "export OPENROUTER_API_KEY=…" },
      ],
    });

  test("a ready provider the next conversation would use is what enables the fix", () => {
    expect(activeProviderReady(status(true))).toBe(true);
    expect(activeProviderReady(status(false))).toBe(false);
    expect(activeProviderReady(status(true, null))).toBe(false);
    expect(activeProviderReady(null)).toBe(false);
  });
});

describe("the one-shot request", () => {
  test("sends once for an id, not again when the effect runs a second time", () => {
    const sent: string[] = [];
    const once = createOneShot();
    sendOnce(once, "fix-1", () => sent.push("first run"));
    sendOnce(once, "fix-1", () => sent.push("strict mode's second run"));
    expect(sent).toEqual(["first run"]);
  });

  test("a second press is a new id, and is sent", () => {
    const sent: string[] = [];
    const once = createOneShot();
    sendOnce(once, "fix-1", () => sent.push("fix-1"));
    sendOnce(once, "fix-2", () => sent.push("fix-2"));
    expect(sent).toEqual(["fix-1", "fix-2"]);
  });

  test("nothing is sent before the shell asks", () => {
    const sent: string[] = [];
    sendOnce(createOneShot(), undefined, () => sent.push("sent"));
    expect(sent).toEqual([]);
  });
});
