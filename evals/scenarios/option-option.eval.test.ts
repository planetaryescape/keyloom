// The Option-Option scenario (11#evals-for-the-agent, D-019, D-025) against the real model. It costs
// money, so it runs only on purpose:
//   KEYLOOM_EVAL_PROVIDER=anthropic|openrouter|codex (default anthropic) with that provider's credential,
//   KEYLOOM_LIVE_EVALS=1 bun test ./scenarios/option-option.eval.test.ts, from evals/ (see 11-observability-and-evals)
// Otherwise it is skipped, and nothing here touches the network.
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getLayout, listChanges } from "../../src/app/index.ts";
import { applyOps as applyLayoutOps } from "../../src/layout/apply-ops.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { optionOptionApp, S_POSITION } from "../../test/helpers/option-option.ts";
import { MAX_QUESTIONS, converse, said } from "../converse.ts";
import { costLine, evalProvider, live, namesNoKeyNumbers, reportFile } from "../provider.ts";


const PROBLEM = "Some apps want Option–Option, and I can't do it because Option is my S home row mod.";
// What BK says when a turn ends in prose with nothing proposed yet. Questions the agent asks with the ask tool are answered with its recommended option.
const NUDGES = [
  "It's Raycast, which opens on a double tap of Option. I hold layers with my right thumb, so my left hand is free and does the shortcut.",
  "Any of those is fine. Please just propose the options now, and keep S and the rest of the home row as they are.",
  "Please propose now.",
];
// Turns include the answers to questions.
const MAX_TURNS = 4 + MAX_QUESTIONS;


const isPlainAlt = (doc: Layout) =>
  doc.layers.some((l) => l.bindings.some((b) => b.kind === "modifier" && b.mods.includes("LALT")));
const hasOptionOptionMacro = (doc: Layout) =>
  doc.macros.some((m) => m.steps.filter((s) => s.op === "tap" && s.mods?.includes("LALT") === true).length >= 2) ||
  doc.macros.some((m) => m.steps.filter((s) => s.op === "tap" && s.code?.includes("ALT") === true).length >= 2);

describe("eval: Option-Option", () => {
  test.skipIf(!live)("proposes a valid alternative that makes Option reachable, without multi-tap on S", async () => {
    const { app, layoutId } = await optionOptionApp();
    const before = getLayout(app, layoutId).document;
    const { outcomes, questions } = await converse(app, layoutId, { message: PROBLEM }, { nudges: NUDGES, maxTurns: MAX_TURNS });

    const proposed = listChanges(app, layoutId, { status: "proposed" });
    const usage = outcomes.reduce(
      (a, o) => ({
        inputTokens: a.inputTokens + o.usage.inputTokens, outputTokens: a.outputTokens + o.usage.outputTokens,
        cacheReadTokens: a.cacheReadTokens + o.usage.cacheReadTokens, cacheCreationTokens: a.cacheCreationTokens + o.usage.cacheCreationTokens,
      }),
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    );

    const checks = {
      namesKeysNotNumbers: namesNoKeyNumbers(outcomes),
      atMostThreeQuestions: questions.length <= MAX_QUESTIONS,
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
      `# Option-Option eval, ${date}, ${evalProvider}, ${first?.model} (effort ${first?.effort})`,
      "",
      ...Object.entries(checks).map(([k, v]) => `- ${v ? "pass" : "FAIL"}: ${k}`),
      "",
      `Turns: ${outcomes.length}. Model requests: ${outcomes.reduce((n, o) => n + o.iterations, 0)}.`,
      `Tokens: ${usage.inputTokens} in, ${usage.outputTokens} out, ${usage.cacheReadTokens} cache read, ${usage.cacheCreationTokens} cache write.`,
      costLine(outcomes, usage),
      "",
      "## Agent replies",
      ...outcomes.map((o, i) => `### Turn ${i + 1} (${o.status})\n${said(o)}`),
      "",
      "## Proposals",
      ...proposed.map((c) => `### ${c.title}\n${c.explanation}\n\nOps: ${JSON.stringify(c.ops)}\n\nGains: ${c.tradeoffs.gains.join("; ")}\nCosts: ${c.tradeoffs.costs.join("; ")}`),
    ].join("\n");
    const dir = join(import.meta.dir, "..", "reports");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, reportFile(date, first?.model, first?.effort, "option-option")), `${report}\n`);

    expect(Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)).toEqual([]);
  }, 600_000);
});
