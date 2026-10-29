// The Command-Shift refine scenario (13 rung 4, D-020, D-025, D-452) against the real model: the best proposal first, refining questions
// one at a time, each answer revising the proposal (the old one superseded), and a decision that carries what BK answered. It costs money,
// so it runs only on purpose, once per provider:
//   KEYLOOM_EVAL_PROVIDER=anthropic|openrouter|codex (default anthropic) with that provider's credential,
//   KEYLOOM_LIVE_EVALS=1 bun test evals/scenarios/command-shift.eval.test.ts
// Otherwise it is skipped, and nothing here touches the network. The report goes to evals/reports/.
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ChatOutcome, applyChange, getLayout, listChanges, listDecisions, sendMessage, undo } from "../../src/app/index.ts";
import { applyOps as applyLayoutOps } from "../../src/layout/apply-ops.ts";
import { deepEqual } from "../../src/layout/equal.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { BACKSPACE_POSITION, commandShiftApp } from "../../test/helpers/command-shift.ts";
import { chainChecks } from "../command-shift-checks.ts";
import { costLine, evalProvider, live, namesNoKeyNumbers, reportFile } from "../provider.ts";


const PROBLEM = "I press Command–Shift a lot; give me one key for it.";
// What BK would say to the questions the agent asks, in order. Typed answers: they work whatever the options were.
const ANSWERS = [
  "My left hand does the shortcuts while my right hand is on the mouse. I barely use F16. Keep Backspace where it is.",
  "Whichever costs me least; I would rather give a key up than move the ones I use.",
  "Fine, go with your recommendation.",
  "Fine, go with your recommendation.",
];
// The prompt asks for at most three questions, so a run that is still asking after the fourth turn has not converged.
const MAX_TURNS = 5;


describe("eval: Command-Shift", () => {
  test.skipIf(!live)("puts one proposal first, refines it with questions, carries the answers into the decision, and undoes in one step", async () => {
    const { app, layoutId } = await commandShiftApp();
    const before = getLayout(app, layoutId).document;
    const outcomes: ChatOutcome[] = [];
    let conversationId: string | undefined;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const waiting: ChatOutcome | undefined = outcomes.at(-1);
      const answer = waiting?.status === "awaiting_answer" && waiting.question !== undefined
        ? { answer: { toolUseId: waiting.question.toolUseId, text: ANSWERS[turn - 1] ?? "Fine, go with your recommendation." } }
        : { message: turn === 0 ? PROBLEM : "Fine, go with your recommendation." };
      const outcome = await sendMessage(app, layoutId, { provider: evalProvider, ...answer, ...(conversationId ? { conversationId } : {}) });
      conversationId = outcome.conversationId;
      outcomes.push(outcome);
      expect(["awaiting_answer", "complete"]).toContain(outcome.status);
      if (outcome.status === "complete") break;
    }

    const proposals = outcomes.flatMap((o) => o.proposals);
    const questions = outcomes.flatMap((o) => (o.question === undefined ? [] : [o.question]));
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
    const sets = listChanges(app, layoutId, {});
    const open = sets.filter((cs) => cs.status === "proposed");
    const final = open.at(-1);

    const checks: Record<string, boolean> = {
      namesKeysNotNumbers: namesNoKeyNumbers(outcomes),
      finishedWithinTheTurnLimit: outcomes.at(-1)?.status === "complete",
      proposedBeforeAsking: (outcomes[0]?.proposals.length ?? 0) === 1,
      oneProposalPerTurn: outcomes.every((o) => o.proposals.length <= 1),
      atMostThreeQuestions: questions.length <= 3,
      everyQuestionHasConsiderationsAndStep: questions.every((q) => (q.considerations?.length ?? 0) >= 1 && q.step !== undefined && q.step.n <= q.step.of),
      recommendedFirst: questions.every((q) => q.options.length === 0 || q.options[0]?.recommended === true),
      // The revision chain: each proposal after the first replaced the one before, so exactly one is open and the rest are set aside.
      revisionsSupersede: proposals.length >= 2 && proposals.slice(1).every((p) => p.supersedes !== null && p.supersedes !== undefined) && open.length === 1,
      theNewestIsOnTheBoard: final !== undefined && final.id === proposals.at(-1)?.changeSetId,
      // Every valid proposal in the chain, not only the last (evals/command-shift-checks.ts).
      ...chainChecks(before, valid),
      backspacePinned: subjects.includes("BACKSPACE"),
      f16RarelyUsed: subjects.includes("F16"),
      finalKeepsBackspace: final !== undefined && (() => {
        const applied = applyLayoutOps(before, final.ops);
        return applied.ok && deepEqual(applied.layout.layers[0]?.bindings[BACKSPACE_POSITION], before.layers[0]?.bindings[BACKSPACE_POSITION]);
      })(),
      decisionReasonCarriesAnAnswer: false,
      undoRestoresAll: false,
    };
    let reason = "";
    if (final) {
      const applied = applyChange(app, final.id);
      const choice = listDecisions(app, layoutId, { kind: "choice" }).find((d) => d.id === applied.decisionId);
      reason = choice?.reason ?? "";
      // Judged by a person from the report; this only catches a reason that says nothing of what BK said.
      checks.decisionReasonCarriesAnAnswer = /left|mouse|F16|Backspace|least|give/i.test(reason);
      undo(app, layoutId, { revisionId: applied.revisionId });
      checks.undoRestoresAll = deepEqual(getLayout(app, layoutId).document, before);
    }

    const date = new Date().toISOString().slice(0, 10);
    const first = outcomes[0];
    const report = [
      `# Command-Shift refine eval, ${date}, ${evalProvider}, ${first?.model} (effort ${first?.effort})`,
      "",
      ...Object.entries(checks).map(([k, v]) => `- ${v ? "pass" : "FAIL"}: ${k}`),
      "",
      `Turns: ${outcomes.length}. Questions: ${questions.length}. Model requests: ${outcomes.reduce((n, o) => n + o.iterations, 0)}.`,
      `Tokens: ${usage.inputTokens} in, ${usage.outputTokens} out, ${usage.cacheReadTokens} cache read, ${usage.cacheCreationTokens} cache write.`,
      costLine(outcomes, usage),
      "",
      "## Remembered priorities",
      ...priorities.map((d) => `- ${JSON.stringify(d)}`),
      "",
      "## The decision applying wrote (read it: does it carry what BK answered?)",
      reason || "(none)",
      "",
      "## Agent replies and questions",
      ...outcomes.map((o, i) => `### Turn ${i + 1} (${o.status})\n${o.text}${o.question === undefined ? "" : `\n\nQuestion ${o.question.step?.n ?? "?"} of ${o.question.step?.of ?? "?"}: ${o.question.question}\nConsiderations: ${(o.question.considerations ?? []).join(" / ")}\nOptions: ${o.question.options.map((opt) => `${opt.recommended ? "[recommended] " : ""}${opt.label}`).join(" | ")}`}`),
      "",
      "## Proposals",
      ...proposals.map((c) => `### ${c.title} (${c.validation.ok ? "valid" : "invalid"}, supersedes ${c.supersedes ?? "nothing"})\n${c.explanation}\n\nOps: ${JSON.stringify(c.ops)}\n\nDisplaced: ${JSON.stringify(c.validation.diff.displaced)}\nDropped: ${JSON.stringify(c.validation.diff.dropped)}\nWarnings: ${c.validation.warnings.map((w) => w.code).join(", ")}\n\nGains: ${c.tradeoffs.gains.join("; ")}\nCosts: ${c.tradeoffs.costs.join("; ")}`),
    ].join("\n");
    const dir = join(import.meta.dir, "..", "reports");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, reportFile(date, first?.model, first?.effort, "command-shift")), `${report}\n`);

    expect(valid.length).toBeGreaterThan(0);
    expect(Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)).toEqual([]);
  }, 900_000);
});
