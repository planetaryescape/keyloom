// The Option-Option scenario (11#evals-for-the-agent, D-019, D-025) against the real model. It costs
// money, so it runs only on purpose:
//   ANTHROPIC_API_KEY=... KEYLOOM_LIVE_EVALS=1 bun test evals/scenarios/option-option.eval.test.ts
// Otherwise it is skipped, and nothing here touches the network.
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ChatOutcome, getLayout, listChanges, sendMessage } from "../../src/app/index.ts";
import { applyOps as applyLayoutOps } from "../../src/layout/apply-ops.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { optionOptionApp, S_POSITION } from "../../test/helpers/option-option.ts";

const live = Boolean(process.env.ANTHROPIC_API_KEY) && process.env.KEYLOOM_LIVE_EVALS === "1";

const PROBLEM = "Some apps want Option–Option, and I can't do it because Option is my S home row mod.";
// What BK would say to the questions the agent is expected to ask; sent only while it has proposed nothing.
const ANSWERS = [
  "It's Raycast, which opens on a double tap of Option. I hold layers with my right thumb, so my left hand is free and does the shortcut.",
  "Any of those is fine. Please just propose the options now, and keep S and the rest of the home row as they are.",
  "Please propose now.",
];
const MAX_TURNS = 4;

// Opus 5.5 list prices (12-cost-model): $4/M input, $20/M output, $0.20/M cache reads; cache writes at 1.25x input.
const cost = (u: ChatOutcome["usage"]) => (u.inputTokens * 4 + u.outputTokens * 20 + u.cacheReadTokens * 0.2 + u.cacheCreationTokens * 5) / 1e6;

const isPlainAlt = (doc: Layout) =>
  doc.layers.some((l) => l.bindings.some((b) => b.kind === "modifier" && b.mods.includes("LALT")));
const hasOptionOptionMacro = (doc: Layout) =>
  doc.macros.some((m) => m.steps.filter((s) => s.op === "tap" && s.mods?.includes("LALT") === true).length >= 2) ||
  doc.macros.some((m) => m.steps.filter((s) => s.op === "tap" && s.code?.includes("ALT") === true).length >= 2);

describe("eval: Option-Option", () => {
  test.skipIf(!live)("proposes a valid alternative that makes Option reachable, without multi-tap on S", async () => {
    const { app, layoutId } = await optionOptionApp();
    const before = getLayout(app, layoutId).document;
    const outcomes: ChatOutcome[] = [];
    let conversationId: string | undefined;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const outcome = await sendMessage(app, layoutId, {
        message: turn === 0 ? PROBLEM : (ANSWERS[turn - 1] ?? "Please propose now."),
        ...(conversationId ? { conversationId } : {}),
      });
      conversationId = outcome.conversationId;
      outcomes.push(outcome);
      expect(outcome.status).toBe("complete");
      if (outcome.proposals.length > 0) break;
    }

    const proposed = listChanges(app, layoutId, { status: "proposed" });
    const usage = outcomes.reduce(
      (a, o) => ({
        inputTokens: a.inputTokens + o.usage.inputTokens, outputTokens: a.outputTokens + o.usage.outputTokens,
        cacheReadTokens: a.cacheReadTokens + o.usage.cacheReadTokens, cacheCreationTokens: a.cacheCreationTokens + o.usage.cacheCreationTokens,
      }),
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    );

    const checks = {
      atLeastOneValidAlternative: proposed.length >= 1 && proposed.every((c) => (c.validation as { ok: boolean }).ok),
      optionReachable: false,
      noMultiTapOnS: true,
    };
    for (const cs of proposed) {
      const applied = applyLayoutOps(before, cs.ops);
      if (!applied.ok) continue;
      const doc = applied.layout;
      if (isPlainAlt(doc) || hasOptionOptionMacro(doc)) checks.optionReachable = true;
      const s = doc.layers[0]?.bindings[S_POSITION];
      if (s && (s.kind === "native" || s.kind === "macro")) checks.noMultiTapOnS = false;
    }

    const date = new Date().toISOString().slice(0, 10);
    const first = outcomes[0];
    const report = [
      `# Option-Option eval, ${date}, ${first?.model} (effort ${first?.effort})`,
      "",
      ...Object.entries(checks).map(([k, v]) => `- ${v ? "pass" : "FAIL"}: ${k}`),
      "",
      `Turns: ${outcomes.length}. Model requests: ${outcomes.reduce((n, o) => n + o.iterations, 0)}.`,
      `Tokens: ${usage.inputTokens} in, ${usage.outputTokens} out, ${usage.cacheReadTokens} cache read, ${usage.cacheCreationTokens} cache write.`,
      `Estimated cost: $${cost(usage).toFixed(3)}.`,
      "",
      "## Agent replies",
      ...outcomes.map((o, i) => `### Turn ${i + 1}\n${o.text}`),
      "",
      "## Proposals",
      ...proposed.map((c) => `### ${c.title}\n${c.explanation}\n\nOps: ${JSON.stringify(c.ops)}\n\nGains: ${c.tradeoffs.gains.join("; ")}\nCosts: ${c.tradeoffs.costs.join("; ")}`),
    ].join("\n");
    const dir = join(import.meta.dir, "..", "reports");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${date}-${first?.model}-${first?.effort}-option-option.md`), `${report}\n`);

    expect(checks).toEqual({ atLeastOneValidAlternative: true, optionReachable: true, noMultiTapOnS: true });
  }, 600_000);
});
