// The "remembered reason" scenario (13 rung 6, D-022, D-023) against the real model. BK set up a
// Command-Shift key months ago and gave a reason; now he asks to replace it. keyloom should bring the
// reason up and ask before proposing, the proposals should carry the reminder, and applying one anyway
// should supersede the old decision. It costs money, so it runs only on purpose:
//   KEYLOOM_EVAL_PROVIDER=anthropic|openrouter|codex (default anthropic) with that provider's credential,
//   KEYLOOM_LIVE_EVALS=1 bun test evals/scenarios/remembered-reason.eval.test.ts
// Otherwise it is skipped, and nothing here touches the network.
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ChatOutcome, applyChange, getLayout, listDecisions, proposeChange, sendMessage, showDecision } from "../../src/app/index.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { commandShiftApp, TAB_POSITION } from "../../test/helpers/command-shift.ts";
import { costLine, evalProvider, live, namesNoKeyNumbers, reportFile } from "../provider.ts";


const REASON = "My right hand stays on the mouse, so the left hand has to do Command-Shift shortcuts in Figma on its own.";
const SEEDED: ChangeOp[] = [{ op: "setBinding", at: { layerId: "layer-0", position: TAB_POSITION }, binding: { kind: "modifier", mods: ["LGUI", "LSFT"] } }];

const ASK = "Replace the Command-Shift key with a Caps Lock key.";
// What BK says to the agent's question: the reason no longer holds, so go ahead.
const ANSWERS = [
  "I stopped using Figma for that months ago and the shortcuts aren't a thing for me anymore. It doesn't hold any more. Please go ahead and propose it.",
  "Yes, propose it now.",
];
const MAX_TURNS = 3;

describe("eval: remembered reason", () => {
  test.skipIf(!live)("quotes the stored reason and asks, proposals carry the reminder, applying anyway supersedes it", async () => {
    const { app, layoutId } = await commandShiftApp();
    // The decision from months ago: applied through the same path a real proposal takes.
    const seededChange = proposeChange(app, layoutId, {
      ops: SEEDED, explanation: "Command-Shift where Tab was", source: "agent", title: "Command-Shift where Tab is",
      decisionDraft: {
        goal: "I press Command-Shift a lot and wanted one key for it", choice: "Command-Shift where Tab was, on Layer 0", reason: REASON,
        scope: { apps: ["Figma"], habits: ["Command-Shift shortcuts with the left hand"] }, sourceMessageIds: [],
      },
    });
    const old = applyChange(app, seededChange.id).decisionId as string;

    const outcomes: ChatOutcome[] = [];
    let conversationId: string | undefined;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const outcome = await sendMessage(app, layoutId, {
      provider: evalProvider,
        message: turn === 0 ? ASK : (ANSWERS[turn - 1] ?? "Yes, propose it now."), ...(conversationId ? { conversationId } : {}),
      });
      conversationId = outcome.conversationId;
      outcomes.push(outcome);
      expect(outcome.status).toBe("complete");
      if (outcome.proposals.length > 0) break;
    }

    const first = outcomes[0];
    const reply = (first?.text ?? "").toLowerCase();
    const proposals = outcomes.flatMap((o) => o.proposals);
    const valid = proposals.filter((p) => p.validation.ok);
    const usage = outcomes.reduce(
      (a, o) => ({
        inputTokens: a.inputTokens + o.usage.inputTokens, outputTokens: a.outputTokens + o.usage.outputTokens,
        cacheReadTokens: a.cacheReadTokens + o.usage.cacheReadTokens, cacheCreationTokens: a.cacheCreationTokens + o.usage.cacheCreationTokens,
      }),
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    );

    const checks = {
      namesKeysNotNumbers: namesNoKeyNumbers(outcomes),
      askedBeforeProposing: (first?.proposals.length ?? 0) === 0,
      // The reply uses the stored reason (the mouse, the left hand or Figma), not a generic confirmation.
      citesTheStoredReason: /mouse|left hand|figma/.test(reply),
      // D-279: the key by what it prints and where it sits (⌘⇧ on the left pinky, bottom row), not "key 43".
      namesTheKeyByLegendAndPlace: /⌘⇧|command.?shift/.test(reply) && /pinky|bottom/.test(reply),
      asksWhetherItStillHolds: reply.includes("?"),
      proposesOnceTheReasonIsGone: valid.length > 0,
      everyProposalCarriesTheReminder: valid.length > 0 && valid.every((p) => p.validation.diff.reminders.some((r) => r.decisionId === old && r.reason === REASON)),
      everyProposalHasADraft: valid.length > 0 && valid.every((p) => p.decisionDraft !== null && p.decisionDraft.reason.length > 0),
      applyingAnywaySupersedes: false,
    };
    const chosen = valid[0];
    let successor: string | null = null;
    if (chosen) {
      successor = applyChange(app, chosen.changeSetId).decisionId;
      const after = showDecision(app, old);
      checks.applyingAnywaySupersedes = after.status === "superseded" && after.supersededBy === successor && successor !== null;
    }

    const date = new Date().toISOString().slice(0, 10);
    const report = [
      `# Remembered-reason eval, ${date}, ${evalProvider}, ${first?.model} (effort ${first?.effort})`,
      "",
      ...Object.entries(checks).map(([k, v]) => `- ${v ? "pass" : "FAIL"}: ${k}`),
      "",
      `Turns: ${outcomes.length}. Model requests: ${outcomes.reduce((n, o) => n + o.iterations, 0)}.`,
      `Tokens: ${usage.inputTokens} in, ${usage.outputTokens} out, ${usage.cacheReadTokens} cache read, ${usage.cacheCreationTokens} cache write.`,
      costLine(outcomes, usage),
      "",
      "## Seeded decision",
      `- ${old}: ${REASON}`,
      "",
      "## Agent replies",
      ...outcomes.map((o, i) => `### Turn ${i + 1}\n${o.text}`),
      "",
      "## Proposals",
      ...proposals.map((p) => `### ${p.title} (${p.validation.ok ? "valid" : "invalid"})\n${p.explanation}\n\nOps: ${JSON.stringify(p.ops)}\n\nReminders: ${JSON.stringify(p.validation.diff.reminders)}\nWarnings: ${p.validation.warnings.map((w) => w.code).join(", ")}\n\nDecision draft: ${JSON.stringify(p.decisionDraft)}`),
      "",
      "## Decisions afterwards",
      ...listDecisions(app, layoutId, { kind: "choice" }).map((d) => `- ${d.id} ${d.status}${d.supersededBy ? ` (superseded by ${d.supersededBy})` : ""}: ${d.goal} / ${d.reason}`),
      "",
      `Head: ${JSON.stringify(getLayout(app, layoutId).document.layers[0]?.bindings[TAB_POSITION])}`,
    ].join("\n");
    const dir = join(import.meta.dir, "..", "reports");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, reportFile(date, first?.model, first?.effort, "remembered-reason")), `${report}\n`);

    expect(Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)).toEqual([]);
  }, 900_000);
});
