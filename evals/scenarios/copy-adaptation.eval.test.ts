// Run only with explicit live-eval authorization, from evals/: KEYLOOM_EVAL_PROVIDER=codex KEYLOOM_LIVE_EVALS=1 bun test ./scenarios/copy-adaptation.eval.test.ts
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sendMessage, applyChange, getLayout, listDecisions, type ChatOutcome } from "../../src/app/index.ts";
import { drainAgentRuns, savedRunOutcome, waitForAgentRun } from "../../src/app/agent-runs.ts";
import { getBoardConfig } from "../../src/persistence/configs.ts";
import { copyAdaptationApp } from "../../test/helpers/copy-adaptation.ts";
import { evalProvider, live, reportFile } from "../provider.ts";

test.skipIf(!live)("copy adapts the complete setup on a separate config and remembers its refinement", async () => {
  const { app, sourceId, targetId, preview } = copyAdaptationApp();
  const before = [sourceId, targetId].map((id) => getLayout(app, id).revision.id);
  const selected = getBoardConfig(app.db, "foostan/corne");
  const outcomes: ChatOutcome[] = [];
  try {
    expect(preview.placements.length).toBeGreaterThan(0);
    const source = await sendMessage(app, targetId, { provider: evalProvider, message: "Put my Synthetic source setup on this Corne. Adapt the whole layout and feel to this board, using my recorded reasons. If middle-thumb reach versus index-finger access is consequential, show your best first and ask me one question about it." });
    expect(source.handoff).toBeDefined();
    const handoff = source.handoff;
    if (!handoff) throw new Error("Copy did not hand off");
    await waitForAgentRun(app, handoff.runId);
    let outcome = savedRunOutcome(app, handoff.runId);
    outcomes.push(outcome);
    expect(outcome.proposals).toHaveLength(1);
    expect(outcome.proposals[0]?.validation.ok).toBe(true);
    expect(["awaiting_answer", "complete"]).toContain(outcome.status);
    // A refining answer is supplied even if the model can finish without a question.
    for (let turn = 0; turn < 3; turn++) {
      outcome = await sendMessage(app, handoff.layoutId, {
        conversationId: handoff.conversationId, provider: evalProvider,
        ...(outcome.question?.answer === null ? { answer: { toolUseId: outcome.question.toolUseId, text: "Use the middle left thumb for Navigation. My right hand must stay free for the mouse, and the inner left thumb stays reserved for Space." } } : { message: "Keep that placement; retain my middle-left-thumb preference and its reason in a revised proposal." }),
      });
      outcomes.push(outcome);
      if (outcome.status === "complete") break;
    }
    const proposals = outcomes.flatMap((value) => value.proposals);
    expect(proposals.length).toBeGreaterThanOrEqual(2);
    expect(proposals.slice(1).every((proposal) => proposal.supersedes !== null && proposal.supersedes !== undefined)).toBe(true);
    const final = proposals.at(-1);
    if (!final) throw new Error("No final proposal");
    const applied = applyChange(app, final.changeSetId);
    const choice = listDecisions(app, handoff.layoutId, { kind: "choice" }).find((value) => value.id === applied.decisionId);
    expect(choice?.reason).toMatch(/left|thumb|mouse/i);
    expect(choice?.reason).toMatch(/space|inner/i);
    expect(getLayout(app, handoff.layoutId).document.layers[0]?.bindings[38]).toEqual({ kind: "key", code: "SPACE" });
    expect(choice?.sourceMessageIds).toContain(source.messageIds[0]);
    const navigation = getLayout(app, handoff.layoutId).document.layers[0]?.bindings.flatMap((binding, position) => binding.kind === "layer" && binding.layerId === "navigation" ? [position] : binding.kind === "holdTap" && "layerId" in binding.hold && binding.hold.layerId === "navigation" ? [position] : []);
    expect(navigation?.some((position) => position === 37)).toBe(true);
    expect([sourceId, targetId].map((id) => getLayout(app, id).revision.id)).toEqual(before);
    expect(getBoardConfig(app.db, "foostan/corne")).toBe(selected);
  } finally {
    const directory = join(import.meta.dir, "..", "reports");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, reportFile(new Date().toISOString().slice(0, 10), outcomes[0]?.model, outcomes[0]?.effort, "copy-adaptation")), `# Whole-config copy adaptation\n\nProvider: ${evalProvider}.\n\n\`\`\`json\n${JSON.stringify({ outcomes }, null, 2)}\n\`\`\`\n`);
    await drainAgentRuns(app);
    app.db.close();
  }
}, 900_000);
