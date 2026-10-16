// The Command-Shift scenario (13 rung 4, D-020, D-025) against the real model. It costs money, so it
// runs only on purpose:
//   KEYLOOM_EVAL_PROVIDER=anthropic|openrouter|codex (default anthropic) with that provider's credential,
//   KEYLOOM_LIVE_EVALS=1 bun test evals/scenarios/command-shift.eval.test.ts
// Otherwise it is skipped, and nothing here touches the network.
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ChatOutcome, applyChange, getLayout, listChanges, listDecisions, sendMessage, undo } from "../../src/app/index.ts";
import { applyOps as applyLayoutOps } from "../../src/layout/apply-ops.ts";
import { deepEqual } from "../../src/layout/equal.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { BACKSPACE_POSITION, commandShiftApp } from "../../test/helpers/command-shift.ts";
import { costLine, evalProvider, live, namesNoKeyNumbers, reportFile } from "../provider.ts";


const PROBLEM = "I press Command–Shift a lot; give me one key for it.";
// What BK would say to the questions the agent is expected to ask; sent only while it has proposed nothing.
const ANSWERS = [
  "My left hand does the shortcuts while my right hand is on the mouse. I barely use F16. Keep Backspace where it is.",
  "Please just propose the options now.",
  "Please propose now.",
];
const MAX_TURNS = 4;


const hasCommandShift = (doc: Layout) =>
  doc.layers.some((l) =>
    l.bindings.some((b) =>
      (b.kind === "modifier" && b.mods.includes("LGUI") && b.mods.includes("LSFT")) ||
      (b.kind === "holdTap" && JSON.stringify(b.hold).includes("LGUI") && JSON.stringify(b.hold).includes("LSFT")),
    ),
  );

describe("eval: Command-Shift", () => {
  test.skipIf(!live)("asks, remembers the priorities, offers real alternatives, and undoes in one step", async () => {
    const { app, layoutId } = await commandShiftApp();
    const before = getLayout(app, layoutId).document;
    const outcomes: ChatOutcome[] = [];
    let conversationId: string | undefined;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const outcome = await sendMessage(app, layoutId, {
      provider: evalProvider,
        message: turn === 0 ? PROBLEM : (ANSWERS[turn - 1] ?? "Please propose now."),
        ...(conversationId ? { conversationId } : {}),
      });
      conversationId = outcome.conversationId;
      outcomes.push(outcome);
      expect(outcome.status).toBe("complete");
      if (outcome.proposals.length > 0) break;
    }

    const proposals = outcomes.flatMap((o) => o.proposals);
    const valid = proposals.filter((p) => p.validation.ok);
    const priorities = listDecisions(app, layoutId, { kind: "priority" });
    const subjects = JSON.stringify(priorities).toUpperCase();
    const usage = outcomes.reduce(
      (a, o) => ({
        inputTokens: a.inputTokens + o.usage.inputTokens, outputTokens: a.outputTokens + o.usage.outputTokens,
        cacheReadTokens: a.cacheReadTokens + o.usage.cacheReadTokens, cacheCreationTokens: a.cacheCreationTokens + o.usage.cacheCreationTokens,
      }),
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    );

    const checks = {
      namesKeysNotNumbers: namesNoKeyNumbers(outcomes),
      askedBeforeProposing: (outcomes[0]?.proposals.length ?? 0) === 0,
      atLeastTwoValidAlternatives: valid.length >= 2,
      everyValidOneGivesCommandShift: valid.length > 0 && valid.every((p) => {
        const applied = applyLayoutOps(before, p.ops);
        return applied.ok && hasCommandShift(applied.layout);
      }),
      // A valid proposal never loses a function silently; this checks the agent showed what moves.
      displacedShown: valid.some((p) => p.validation.diff.displaced.length + p.validation.diff.dropped.length > 0),
      backspacePinned: subjects.includes("BACKSPACE"),
      f16RarelyUsed: subjects.includes("F16"),
      oneKeepsBackspace: valid.some((p) => {
        const applied = applyLayoutOps(before, p.ops);
        return applied.ok && deepEqual(applied.layout.layers[0]?.bindings[BACKSPACE_POSITION], before.layers[0]?.bindings[BACKSPACE_POSITION]);
      }),
      undoRestoresAll: false,
    };
    const chosen = valid[0];
    if (chosen) {
      const applied = applyChange(app, chosen.changeSetId);
      undo(app, layoutId, { revisionId: applied.revisionId });
      checks.undoRestoresAll = deepEqual(getLayout(app, layoutId).document, before);
    }

    const date = new Date().toISOString().slice(0, 10);
    const first = outcomes[0];
    const report = [
      `# Command-Shift eval, ${date}, ${evalProvider}, ${first?.model} (effort ${first?.effort})`,
      "",
      ...Object.entries(checks).map(([k, v]) => `- ${v ? "pass" : "FAIL"}: ${k}`),
      "",
      `Turns: ${outcomes.length}. Model requests: ${outcomes.reduce((n, o) => n + o.iterations, 0)}.`,
      `Tokens: ${usage.inputTokens} in, ${usage.outputTokens} out, ${usage.cacheReadTokens} cache read, ${usage.cacheCreationTokens} cache write.`,
      costLine(outcomes, usage),
      "",
      "## Remembered priorities",
      ...priorities.map((d) => `- ${JSON.stringify(d)}`),
      "",
      "## Agent replies",
      ...outcomes.map((o, i) => `### Turn ${i + 1}\n${o.text}`),
      "",
      "## Proposals",
      ...proposals.map((c) => `### ${c.title} (${c.validation.ok ? "valid" : "invalid"})\n${c.explanation}\n\nOps: ${JSON.stringify(c.ops)}\n\nDisplaced: ${JSON.stringify(c.validation.diff.displaced)}\nDropped: ${JSON.stringify(c.validation.diff.dropped)}\nWarnings: ${c.validation.warnings.map((w) => w.code).join(", ")}\n\nGains: ${c.tradeoffs.gains.join("; ")}\nCosts: ${c.tradeoffs.costs.join("; ")}`),
    ].join("\n");
    const dir = join(import.meta.dir, "..", "reports");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, reportFile(date, first?.model, first?.effort, "command-shift")), `${report}\n`);

    expect(Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)).toEqual([]);
  }, 900_000);
});
