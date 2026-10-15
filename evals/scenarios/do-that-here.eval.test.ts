// "Do that here too" (13 rung 7, D-011, D-012, D-060) against the real model, on both boards: BK selects the
// right-hand home row keys whose left-hand mirror has a mod and asks for the same mods, mirrored. It costs money, so
// it runs only on purpose:
//   KEYLOOM_EVAL_PROVIDER=anthropic|openrouter|codex (default anthropic) with that provider's credential,
//   KEYLOOM_LIVE_EVALS=1 bun test evals/scenarios/do-that-here.eval.test.ts
// Otherwise it is skipped, and nothing here touches the network.
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ChatOutcome, getLayout, sendMessage } from "../../src/app/index.ts";
import { applyOps as applyLayoutOps } from "../../src/layout/apply-ops.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { type HomeRowCase, glove80HomeRow, moonlanderHomeRow } from "../../test/helpers/home-row.ts";
import { costLine, costUsd, evalProvider, live, reportFile } from "../provider.ts";


const MESSAGE = "give these the same home row mods as the left, mirrored";
const MAX_TURNS = 3;
const NUDGE = "Yes, mirror them exactly as the left is. Please propose now.";


const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

/** What each selected key holds after the proposal: its tap and the modifiers it holds, or null when it is not a mod hold-tap. */
function heldBy(doc: Layout, layerId: string, position: number): { tap: string; mods: string[] } | null {
  const b = doc.layers.find((l) => l.id === layerId)?.bindings[position];
  return b?.kind === "holdTap" && "mods" in b.hold ? { tap: b.tap.code, mods: sortMods(b.hold.mods) } : null;
}
const sortMods = (mods: readonly string[]) => [...mods].sort();

async function runBoard(name: string, make: () => Promise<HomeRowCase>) {
  const c = await make();
  const before = getLayout(c.app, c.layoutId).document;
  const outcomes: ChatOutcome[] = [];
  let conversationId: string | undefined;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const outcome = await sendMessage(c.app, c.layoutId, {
      provider: evalProvider,
      message: turn === 0 ? MESSAGE : NUDGE,
      ...(turn === 0 ? { selection: { layer: c.layerId, positions: c.selection } } : {}),
      ...(conversationId ? { conversationId } : {}),
    });
    conversationId = outcome.conversationId;
    outcomes.push(outcome);
    expect(outcome.status).toBe("complete");
    if (outcome.proposals.length > 0) break;
  }

  const proposals = outcomes.flatMap((o) => o.proposals);
  const valid = proposals.filter((p) => p.validation.ok);
  const wanted = sorted(c.selection);
  const afterEach = valid.map((p) => {
    const applied = applyLayoutOps(before, p.ops);
    return applied.ok ? applied.layout : null;
  });
  const usage = outcomes.reduce(
    (a, o) => ({
      inputTokens: a.inputTokens + o.usage.inputTokens, outputTokens: a.outputTokens + o.usage.outputTokens,
      cacheReadTokens: a.cacheReadTokens + o.usage.cacheReadTokens, cacheCreationTokens: a.cacheCreationTokens + o.usage.cacheCreationTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  );
  const board = getLayout(c.app, c.layoutId).board.definition;

  const checks = {
    proposedSomething: valid.length > 0,
    everyProposalChangesExactlyTheSelection: valid.length > 0 && valid.every((p) => JSON.stringify(sorted(p.validation.diff.changed.map((s) => s.position))) === JSON.stringify(wanted) && p.validation.diff.changed.every((s) => s.layerId === c.layerId)),
    noOutsideSelectionWarning: valid.every((p) => !p.validation.warnings.some((w) => w.code === "outside_selection")),
    // Each key keeps its own letter and holds the mirrored, right-hand modifiers of its left-hand partner.
    modsMirroredPerFinger: afterEach.length > 0 && afterEach.every((doc) => doc !== null && c.selection.every((p) => {
      const got = heldBy(doc, c.layerId, p);
      const want = c.expected[p]!;
      return got !== null && got.tap === want.tap && JSON.stringify(got.mods) === JSON.stringify(sortMods(want.mods));
    })),
    // ZMK only: the right hand's profile must list the left hand's keys, or holds fire on same-hand rolls.
    profileTriggersOnTheOtherHand: board.firmware !== "zmk" || (afterEach.length > 0 && afterEach.every((doc) => doc !== null && c.selection.every((p) => {
      const b = doc.layers.find((l) => l.id === c.layerId)?.bindings[p];
      const profile = b?.kind === "holdTap" ? doc.holdTapProfiles.find((x) => x.id === b.profileId) : undefined;
      const triggers = profile?.options["hold-trigger-key-positions"];
      return Array.isArray(triggers) && triggers.length > 0 && triggers.every((t) => board.hands.left.includes(t));
    }))),
  };

  const date = new Date().toISOString().slice(0, 10);
  const first = outcomes[0];
  const section = [
    `## ${name}`,
    "",
    ...Object.entries(checks).map(([k, v]) => `- ${v ? "pass" : "FAIL"}: ${k}`),
    "",
    `Selection: ${JSON.stringify(c.selection)} on ${c.layerId}. Turns: ${outcomes.length}. Model requests: ${outcomes.reduce((n, o) => n + o.iterations, 0)}.`,
    `Tokens: ${usage.inputTokens} in, ${usage.outputTokens} out, ${usage.cacheReadTokens} cache read, ${usage.cacheCreationTokens} cache write.`,
    costLine(outcomes, usage),
    "### Agent replies",
    ...outcomes.map((o, i) => `Turn ${i + 1}: ${o.text}`),
    "",
    "### Proposals",
    ...proposals.map((p) => `#### ${p.title} (${p.validation.ok ? "valid" : "invalid"})\n${p.explanation}\n\nOps: ${JSON.stringify(p.ops)}\n\nChanged: ${JSON.stringify(p.validation.diff.changed.map((s) => s.position))}. Warnings: ${p.validation.warnings.map((w) => w.code).join(", ") || "none"}\n\nGains: ${p.tradeoffs.gains.join("; ")}\nCosts: ${p.tradeoffs.costs.join("; ")}`),
  ].join("\n");
  return { checks, section, date, model: first?.model, effort: first?.effort, cost: costUsd(outcomes, usage) };
}

describe("eval: do that here too", () => {
  test.skipIf(!live)("mirrors the home row mods onto exactly the selected right-hand keys, on both boards", async () => {
    const moonlander = await runBoard("Moonlander (QMK, BK's layout)", moonlanderHomeRow);
    const glove80 = await runBoard("Glove80 (ZMK, MoErgo template with left home row mods)", glove80HomeRow);

    const report = [
      `# Do that here too eval, ${moonlander.date}, ${evalProvider}, ${moonlander.model} (effort ${moonlander.effort})`,
      "",
      `Message: "${MESSAGE}". Total cost: ${moonlander.cost === null || glove80.cost === null ? "not reported by Codex" : `$${(moonlander.cost + glove80.cost).toFixed(3)}`}.`,
      "",
      moonlander.section,
      "",
      glove80.section,
    ].join("\n");
    const dir = join(import.meta.dir, "..", "reports");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, reportFile(moonlander.date, moonlander.model, moonlander.effort, "do-that-here")), `${report}\n`);

    const all = { proposedSomething: true, everyProposalChangesExactlyTheSelection: true, noOutsideSelectionWarning: true, modsMirroredPerFinger: true, profileTriggersOnTheOtherHand: true };
    expect(moonlander.checks).toEqual(all);
    expect(glove80.checks).toEqual(all);
  }, 900_000);
});
