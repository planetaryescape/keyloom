// "Copy this from my other keyboard" (13 rung 19, D-220 to D-227) against the real model. BK has a Moonlander
// and a Glove80 in keyloom; the conversation is on the Glove80. It costs money, so it runs only on purpose:
//   KEYLOOM_EVAL_PROVIDER=anthropic|openrouter|codex (default anthropic) with that provider's credential,
//   KEYLOOM_LIVE_EVALS=1 bun test ./scenarios/cross-board.eval.test.ts, from evals/ (see 11-observability-and-evals)
// Otherwise it is skipped, and nothing here touches the network.
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAgentPorts } from "../../src/app/agent-ports.ts";
import { type ChatOutcome, applyOps, getLayout, importLayout, openApp, sendMessage } from "../../src/app/index.ts";
import { applyOps as applyLayoutOps } from "../../src/layout/apply-ops.ts";
import { bindingFunctions } from "../../src/layout/functions.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { listMessages } from "../../src/persistence/conversations.ts";
import { FIXTURE_DIR } from "../../test/helpers/board.ts";
import { tempDir } from "../../test/helpers/tmp.ts";
import { TEMPLATE_FIXTURE } from "../../test/helpers/zmk.ts";
import { costLine, costUsd, evalProvider, live, namesNoKeyNumbers, reportFile } from "../provider.ts";

const MAX_TURNS = 3;
const NUDGE = "Please decide and go ahead; I trust your mapping.";

type ToolUse = { name: string; input: Record<string, unknown> };

/** BK's two boards in one keyloom, the conversation on the Glove80. */
async function setup() {
  const app = openApp({ dataDir: tempDir() });
  await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "my-moonlander" });
  const glove = await importLayout(app, { board: "moergo/glove80", source: TEMPLATE_FIXTURE, name: "my-glove80" });
  return { app, layoutId: glove.layoutId };
}

function toolUses(app: ReturnType<typeof openApp>, conversationId: string): ToolUse[] {
  return listMessages(app.db, conversationId).flatMap((m) =>
    m.content.flatMap((b) => (b.type === "tool_use" && typeof b.name === "string" ? [{ name: b.name, input: (b.input ?? {}) as Record<string, unknown> }] : [])),
  );
}

async function converse(app: ReturnType<typeof openApp>, layoutId: string, first: string) {
  const outcomes: ChatOutcome[] = [];
  let conversationId: string | undefined;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const outcome = await sendMessage(app, layoutId, { provider: evalProvider, message: turn === 0 ? first : NUDGE, ...(conversationId ? { conversationId } : {}) });
    conversationId = outcome.conversationId;
    outcomes.push(outcome);
    expect(outcome.status).toBe("complete");
    // The colours scenario ends in an explanation, not a proposal, so a turn with text and no question mark is an answer.
    if (outcome.proposals.length > 0 || (turn === 0 && !outcome.text.includes("?"))) break;
  }
  const usage = outcomes.reduce(
    (a, o) => ({ inputTokens: a.inputTokens + o.usage.inputTokens, outputTokens: a.outputTokens + o.usage.outputTokens, cacheReadTokens: a.cacheReadTokens + o.usage.cacheReadTokens, cacheCreationTokens: a.cacheCreationTokens + o.usage.cacheCreationTokens }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  );
  return { outcomes, usage, uses: toolUses(app, outcomes[0]?.conversationId as string), text: outcomes.map((o) => o.text).join("\n"), proposals: outcomes.flatMap((o) => o.proposals) };
}

/** Looked at the other layout itself instead of asking BK for it. */
const looked = (uses: ToolUse[]) =>
  uses.some((u) => u.name === "list_layouts") ||
  uses.some((u) => u.name === "get_layout" && typeof u.input.layout === "string") ||
  uses.some((u) => u.name === "map_keys");

// What BK would be annoyed to be asked: for files or pictures of a layout keyloom already holds.
const ASKS_FOR_THE_LAYOUT = /oryx|screenshot|screen shot|export|send me (a |the )?(link|file|photo|picture)|share (a |the )?(link|file)/i;

describe("eval: copy from my other keyboard", () => {
  test.skipIf(!live)("colours: on a board that cannot show them, explains why and proposes nothing; never asks for an Oryx link", async () => {
    const { app, layoutId } = await setup();
    const run = await converse(app, layoutId, "copy the colors (rgb) key lights to be like the ones on my moonlander keyboard");
    const lightingOps = run.proposals.flatMap((p) => p.ops).filter((o) => o.op === "setLayerLighting");
    const checks = {
      namesKeysNotNumbers: namesNoKeyNumbers(run.outcomes),
      // The board's limit is in the prompt, so a model that answers from it without opening the Moonlander has not needed to look; one that does look is also right.
      lookedOrAnsweredFromTheBoardsLimit: looked(run.uses) || /underglow|one effect|no way to give a key/i.test(run.text),
      didNotAskForOryxOrScreenshots: !ASKS_FOR_THE_LAYOUT.test(run.text),
      // The Glove80 has no per-key colours: either nothing is proposed, or (if keyloom ever models them) every proposal is valid.
      noProposalOnABoardThatCannotDoIt: run.proposals.length === 0 && lightingOps.length === 0,
      saysItCannot: /can'?t|cannot|isn'?t able|not able|doesn'?t|does not|no way|unable/i.test(run.text) && /colou?r|light|rgb|underglow/i.test(run.text),
      doesNotOfferWhatItCannotDo: !/I can set per-key colou?rs|I'll set|I will set|want me to (set|add|apply) (the )?colou?rs/i.test(run.text),
    };
    const date = new Date().toISOString().slice(0, 10);
    const section = [
      "## Colours, Glove80",
      ...Object.entries(checks).map(([k, v]) => `- ${v ? "pass" : "FAIL"}: ${k}`),
      "",
      `Tool calls: ${run.uses.map((u) => `${u.name}${u.name === "get_layout" && u.input.layout ? `(${String(u.input.layout)})` : ""}`).join(", ") || "none"}.`,
      `Turns: ${run.outcomes.length}. Model requests: ${run.outcomes.reduce((n, o) => n + o.iterations, 0)}. ${costLine(run.outcomes, run.usage)}`,
      "",
      "### Agent replies",
      ...run.outcomes.map((o, i) => `Turn ${i + 1}: ${o.text}`),
    ].join("\n");
    save(date, run.outcomes, "cross-board-colours", section);
    expect(Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)).toEqual([]);
  }, 600_000);

  test.skipIf(!live)("colours onto a board that can show them: a valid proposal that puts each colour on the same key", async () => {
    const { app } = await setup();
    // A second Moonlander layout with its colours cleared, so there is something to copy from "my-moonlander".
    const second = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "my-second-moonlander" });
    const source = getLayout(app, "my-moonlander");
    const head = getLayout(app, second.layoutId);
    applyOps(app, second.layoutId, { baseRevisionId: head.revision.id, ops: head.document.layers.filter((l) => l.lighting !== undefined).map((l) => ({ op: "setLayerLighting" as const, layerId: l.id, lighting: null })), summary: "Clear colours" });
    const before = getLayout(app, second.layoutId);
    expect(before.document.layers.some((l) => l.lighting !== undefined)).toBe(false);

    const run = await converse(app, second.layoutId, "copy the colors (rgb) key lights from my other moonlander, 'my-moonlander', onto this one");
    const valid = run.proposals.filter((p) => p.validation.ok);
    const afterEach = valid.map((p) => {
      const applied = applyLayoutOps(before.document, p.ops);
      return applied.ok ? applied.layout : null;
    });
    // The source's colours as the agent saw them (a stored Oryx layout is read the way a fresh import reads it).
    const seen = createAgentPorts(app, second.layoutId, "eval").layout("my-moonlander").document;
    const lit = seen.layers.filter((l) => l.lighting !== undefined);
    const checks = {
      namesKeysNotNumbers: namesNoKeyNumbers(run.outcomes),
      lookedAtTheOtherMoonlanderItself: looked(run.uses),
      didNotAskForOryxOrScreenshots: !ASKS_FOR_THE_LAYOUT.test(run.text),
      proposedSomethingValid: valid.length > 0,
      everyColouredLayerCopiedKeyForKey: afterEach.length > 0 && afterEach.every((doc) => doc !== null && lit.length > 0 && lit.every((l) => JSON.stringify(doc.layers.find((x) => x.id === l.id)?.lighting) === JSON.stringify(l.lighting))),
    };
    const date = new Date().toISOString().slice(0, 10);
    const section = [
      "## Colours, Moonlander to Moonlander",
      ...Object.entries(checks).map(([k, v]) => `- ${v ? "pass" : "FAIL"}: ${k}`),
      "",
      `Source layers with colours: ${lit.map((l) => l.name).join(", ")}. Source: ${source.layout.name}.`,
      `Tool calls: ${run.uses.map((u) => `${u.name}${u.name === "get_layout" && u.input.layout ? `(${String(u.input.layout)})` : ""}`).join(", ") || "none"}.`,
      `Turns: ${run.outcomes.length}. Model requests: ${run.outcomes.reduce((n, o) => n + o.iterations, 0)}. ${costLine(run.outcomes, run.usage)}`,
      "",
      "### Agent replies",
      ...run.outcomes.map((o, i) => `Turn ${i + 1}: ${o.text}`),
    ].join("\n");
    save(date, run.outcomes, "cross-board-colours-supported", section);
    expect(Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)).toEqual([]);
  }, 600_000);

  test.skipIf(!live)("home row mods: a valid proposal on the right home-row keys, the right modifiers for each finger and hand", async () => {
    const { app, layoutId } = await setup();
    const moon = getLayout(app, "my-moonlander");
    const before = getLayout(app, layoutId);
    const run = await converse(app, layoutId, "copy my home row mods from my moonlander");

    const board = before.board.definition;
    const home = new Set(board.rows.home);
    const tapOf = (doc: Layout, layer: number, position: number) => bindingFunctions(doc.layers[layer]?.bindings[position] as never, doc.tapDances)[0];
    // What the Moonlander holds per home-row letter, as the base modifier names (Alt, Gui, ...), hand removed.
    const wanted = new Map<string, string[]>();
    for (const p of moon.board.definition.rows.home ?? []) {
      const b = moon.document.layers[0]?.bindings[p];
      if (b?.kind === "holdTap" && "mods" in b.hold) wanted.set(b.tap.code, b.hold.mods.map((m) => m.slice(1)).sort());
    }
    const valid = run.proposals.filter((p) => p.validation.ok);
    const afterEach = valid.map((p) => {
      const applied = applyLayoutOps(before.document, p.ops);
      return applied.ok ? applied.layout : null;
    });
    const sets = valid.flatMap((p) => p.ops.filter((o) => o.op === "setBinding"));

    const checks = {
      namesKeysNotNumbers: namesNoKeyNumbers(run.outcomes),
      lookedAtTheMoonlanderItself: looked(run.uses),
      usedMapKeys: run.uses.some((u) => u.name === "map_keys"),
      proposedSomethingValid: valid.length > 0,
      didNotAskForOryxOrScreenshots: !ASKS_FOR_THE_LAYOUT.test(run.text),
      onlyHomeRowKeysChange: valid.length > 0 && sets.every((o) => o.op === "setBinding" && o.at.layerId === (before.document.layers[0]?.id as string) && home.has(o.at.position)),
      // Every Moonlander home-row mod that the Glove80 lacks ends up on the Glove80 key that types the same letter, with the same modifiers on the hand it sits on.
      everyModCarriedWithTheRightModifiers: afterEach.length > 0 && afterEach.every((doc) => doc !== null && [...wanted].every(([letter, mods]) => {
        const position = [...home].find((p) => tapOf(doc, 0, p) === `key:${letter}`);
        const b = position === undefined ? undefined : doc.layers[0]?.bindings[position];
        if (b?.kind !== "holdTap" || !("mods" in b.hold)) return false;
        const hand = board.hands.left.includes(position as number) ? "L" : "R";
        return b.hold.mods.every((m) => m.startsWith(hand)) && JSON.stringify(b.hold.mods.map((m) => m.slice(1)).sort()) === JSON.stringify(mods);
      })),
      // ZMK: the hold must wait for the other hand, or same-hand rolls fire the modifier.
      profilesWaitForTheOtherHand: afterEach.length > 0 && afterEach.every((doc) => doc !== null && [...home].every((p) => {
        const b = doc.layers[0]?.bindings[p];
        if (b?.kind !== "holdTap" || !("mods" in b.hold)) return true;
        const profile = doc.holdTapProfiles.find((x) => x.id === b.profileId);
        const trigger = profile?.options["hold-trigger-key-positions"];
        const own = board.hands.left.includes(p) ? board.hands.left : board.hands.right;
        const thumbs = new Set(board.rows.thumb ?? []);
        return Array.isArray(trigger) && trigger.length > 0 && trigger.every((t) => !own.includes(t) || thumbs.has(t));
      })),
    };

    const date = new Date().toISOString().slice(0, 10);
    const section = [
      "## Home row mods, Glove80",
      ...Object.entries(checks).map(([k, v]) => `- ${v ? "pass" : "FAIL"}: ${k}`),
      "",
      `Moonlander home-row mods (letter: modifiers): ${JSON.stringify([...wanted])}.`,
      `Tool calls: ${run.uses.map((u) => `${u.name}${u.name === "get_layout" && u.input.layout ? `(${String(u.input.layout)})` : ""}`).join(", ") || "none"}.`,
      `Turns: ${run.outcomes.length}. Model requests: ${run.outcomes.reduce((n, o) => n + o.iterations, 0)}. ${costLine(run.outcomes, run.usage)}`,
      "",
      "### Agent replies",
      ...run.outcomes.map((o, i) => `Turn ${i + 1}: ${o.text}`),
      "",
      "### Proposals",
      ...run.proposals.map((p) => `#### ${p.title} (${p.validation.ok ? "valid" : "invalid"})\n${p.explanation}\n\nOps: ${JSON.stringify(p.ops)}\n\nWarnings: ${p.validation.warnings.map((w) => w.code).join(", ") || "none"}`),
    ].join("\n");
    save(date, run.outcomes, "cross-board-home-row", section);
    expect(Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)).toEqual([]);
  }, 600_000);
});

function save(date: string, outcomes: ChatOutcome[], scenario: string, section: string): void {
  const first = outcomes[0];
  const usage = outcomes.reduce((a, o) => ({ ...a, inputTokens: a.inputTokens + o.usage.inputTokens, outputTokens: a.outputTokens + o.usage.outputTokens, cacheReadTokens: a.cacheReadTokens + o.usage.cacheReadTokens, cacheCreationTokens: a.cacheCreationTokens + o.usage.cacheCreationTokens }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
  const cost = costUsd(outcomes, usage);
  const report = [`# ${scenario} eval, ${date}, ${evalProvider}, ${first?.model} (effort ${first?.effort})`, "", `Cost: ${cost === null ? "not reported" : `$${cost.toFixed(3)}`}.`, "", section].join("\n");
  const dir = join(import.meta.dir, "..", "reports");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, reportFile(date, first?.model, first?.effort, scenario)), `${report}\n`);
}
