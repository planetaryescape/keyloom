import { describe, expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { planMirror } from "../../src/agent/mirror-plan.ts";
import { getLayout, listChanges, sendMessage, showConversation } from "../../src/app/index.ts";
import { applyOps as applyLayoutOps } from "../../src/layout/apply-ops.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { type HomeRowCase, GLOVE80_PROFILE, glove80HomeRow, moonlanderHomeRow } from "../helpers/home-row.ts";

const cases: Array<[string, () => Promise<HomeRowCase>]> = [["Moonlander (QMK)", moonlanderHomeRow], ["Glove80 (ZMK)", glove80HomeRow]];

describe("planMirror", () => {
  for (const [name, make] of cases) {
    test(`${name}: mirrors exactly the selected keys, with each key's own letter and right-hand mods`, async () => {
      const c = await make();
      const { document, board } = getLayout(c.app, c.layoutId);
      const plan = planMirror(document, board.definition, c.layerId, c.selection);
      const sets = plan.ops.filter((op): op is Extract<ChangeOp, { op: "setBinding" }> => op.op === "setBinding");
      expect(sets.map((op) => op.at.position)).toEqual(c.selection);
      for (const op of sets) {
        const want = c.expected[op.at.position]!;
        expect(op.binding).toMatchObject({ kind: "holdTap", tap: { code: want.tap }, hold: { mods: want.mods } });
      }
      const applied = applyLayoutOps(document, plan.ops);
      expect(applied.ok).toBe(true);
    });
  }

  test("ZMK: the left profile lists right-hand keys, so the right-hand keys get a mirrored profile listing left-hand ones", async () => {
    const c = await glove80HomeRow();
    const { document, board } = getLayout(c.app, c.layoutId);
    const plan = planMirror(document, board.definition, c.layerId, c.selection);
    const upsert = plan.ops.find((op) => op.op === "upsertHoldTapProfile");
    expect(upsert).toBeDefined();
    const profile = (upsert as Extract<ChangeOp, { op: "upsertHoldTapProfile" }>).profile;
    expect(profile.id).toBe(`${GLOVE80_PROFILE}-mirrored`);
    expect(profile.options["hold-trigger-key-positions"]).toEqual([...board.definition.hands.left].sort((a, b) => a - b));
    expect(plan.ops[0]).toBe(upsert); // profile first
    for (const op of plan.ops) if (op.op === "setBinding" && op.binding.kind === "holdTap") expect(op.binding.profileId).toBe(profile.id);
  });

  test("QMK: the profile has no positions, so it is shared and no profile op is added", async () => {
    const c = await moonlanderHomeRow();
    const { document, board } = getLayout(c.app, c.layoutId);
    const plan = planMirror(document, board.definition, c.layerId, c.selection);
    expect(plan.ops.some((op) => op.op === "upsertHoldTapProfile")).toBe(false);
  });

  test("Moonlander: Hyper on the left becomes all four right-hand modifiers, never mixed", async () => {
    const c = await moonlanderHomeRow();
    const { document, board } = getLayout(c.app, c.layoutId);
    const plan = planMirror(document, board.definition, c.layerId, [36]);
    expect(plan.ops).toEqual([{
      op: "setBinding", at: { layerId: c.layerId, position: 36 },
      binding: { kind: "holdTap", tap: { code: "H" }, hold: { mods: ["RCTL", "RSFT", "RALT", "RGUI"] }, profileId: "home-row-mods" },
    }]);
  });

  test("a key whose mirror is plain is left out of the ops, and keys already mirrored say so", async () => {
    const c = await moonlanderHomeRow();
    const { document, board } = getLayout(c.app, c.layoutId);
    const plan = planMirror(document, board.definition, c.layerId, [38, 40]);
    expect(plan.ops).toEqual([]);
    expect(plan.steps.map((s) => "unchanged" in s.outcome)).toEqual([true, true]);
  });

  test("the other direction works too: selecting the left hand mirrors the right onto it", async () => {
    const c = await glove80HomeRow();
    const { document, board } = getLayout(c.app, c.layoutId);
    // The right hand has no mods, so mirroring right -> left strips the left's.
    const plan = planMirror(document, board.definition, c.layerId, [35, 36]);
    expect(plan.ops.map((op) => op.op === "setBinding" && op.binding)).toEqual([{ kind: "key", code: "A" }, { kind: "key", code: "S" }]);
  });
});

describe("a selection, a mirror and a proposal through the agent", () => {
  for (const [name, make] of cases) {
    test(`${name}: mirror_keys then propose_changes changes exactly the selected keys, with no outside_selection warning`, async () => {
      const c = await make();
      let opsFromTool: unknown;
      const fake = fakeAnthropic([
        { blocks: [{ tool: "mirror_keys", input: { positions: c.selection, layer: c.layerId } }] },
        (seen) => {
          expect(seen.toolResults[0]).toContain("Ops covering exactly the keys that change");
          opsFromTool = JSON.parse(seen.toolResults[0]!.split("\n").find((l) => l.startsWith("[")) as string);
          return { blocks: [{ tool: "propose_changes", input: { alternatives: [{ title: "Mirror the home row mods", ops: opsFromTool, explanation: "Same mods as the left, on the right hand.", tradeoffs: { gains: ["symmetry"], costs: [] } }] } }] };
        },
        { blocks: [{ text: "Done." }] },
      ]);
      const outcome = await sendMessage(c.app, c.layoutId, {
        message: "give these the same home row mods as the left, mirrored",
        selection: { layer: c.layerId, positions: c.selection },
        model: anthropicModel(fake.client),
      });
      const [proposal] = outcome.proposals;
      expect(proposal?.validation.ok).toBe(true);
      expect(proposal?.validation.diff.changed.map((s) => s.position).sort((a, b) => a - b)).toEqual(c.selection);
      expect(proposal?.validation.warnings.map((w) => w.code)).not.toContain("outside_selection");

      // The model was shown both numbers for every selected key.
      const header = (fake.requests[0]?.body.messages[0].content[0].text as string).split("\n\n")[0]!;
      expect(header).toContain(`(layer id ${c.layerId})`);
      expect(header).toContain(`key ${c.selection[0]! + 1} (position ${c.selection[0]})`);
      expect(listChanges(c.app, c.layoutId, { status: "proposed" })).toHaveLength(1);
    });

    test(`${name}: a proposal that strays outside the selection is saved with an outside_selection warning`, async () => {
      const c = await make();
      const { document, board } = getLayout(c.app, c.layoutId);
      // The mirror ops plus one more home-row key BK did not select; its own letter stays, so nothing is lost.
      const stray = c.selection.at(-1)! + 1;
      const letter = document.layers.find((l) => l.id === c.layerId)!.bindings[stray]!;
      const extra: ChangeOp = {
        op: "setBinding", at: { layerId: c.layerId, position: stray },
        binding: { kind: "holdTap", tap: { code: letter.kind === "key" ? letter.code : "A" }, hold: { mods: ["RGUI"] }, profileId: planMirror(document, board.definition, c.layerId, c.selection).ops.flatMap((op) => (op.op === "setBinding" && op.binding.kind === "holdTap" ? [op.binding.profileId] : []))[0]! },
      };
      const ops = [...planMirror(document, board.definition, c.layerId, c.selection).ops, extra];
      const fake = fakeAnthropic([
        { blocks: [{ tool: "propose_changes", input: { alternatives: [{ title: "Too much", ops, explanation: "x", tradeoffs: { gains: [], costs: [] } }] } }] },
        { blocks: [{ text: "Done." }] },
      ]);
      const outcome = await sendMessage(c.app, c.layoutId, { message: "do it", selection: { layer: c.layerId, positions: c.selection }, model: anthropicModel(fake.client) });
      const warning = outcome.proposals[0]?.validation.warnings.find((w) => w.code === "outside_selection");
      expect(warning?.slots).toEqual([{ layerId: c.layerId, position: stray }]);
    });
  }

  test("the history shows what BK typed, not the header the model was given", async () => {
    const c = await moonlanderHomeRow();
    const fake = fakeAnthropic([{ blocks: [{ text: "ok" }] }]);
    const outcome = await sendMessage(c.app, c.layoutId, { message: "mirror these", selection: { layer: c.layerId, positions: c.selection }, model: anthropicModel(fake.client) });
    const [first] = showConversation(c.app, outcome.conversationId).messages;
    expect(first?.text).toBe("mirror these");
    expect(first?.selection).toEqual({ layerId: c.layerId, positions: c.selection });
  });
});
