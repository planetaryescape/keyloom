import { describe, expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { createTools } from "../../src/agent/tools/index.ts";
import type { ModelTool } from "../../src/agent/model.ts";
import { createAgentPorts } from "../../src/app/agent-ports.ts";
import { applyChange, applyOps, getLayout, importLayout, listChanges, openApp, sendMessage } from "../../src/app/index.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { applyOps as applyToDocument } from "../../src/layout/apply-ops.ts";
import { bindingFunctions } from "../../src/layout/functions.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { draft } from "../helpers/ops.ts";
import { tempDir } from "../helpers/tmp.ts";
import { TEMPLATE_FIXTURE } from "../helpers/zmk.ts";

async function twoBoards() {
  const app = openApp({ dataDir: tempDir() });
  const moon = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "my-moonlander" });
  const glove = await importLayout(app, { board: "moergo/glove80", source: TEMPLATE_FIXTURE, name: "my-glove80" });
  const tools = (layoutId: string) => {
    const proposals: unknown[] = [];
    const list = createTools(createAgentPorts(app, layoutId, "conv_test"), { validation() {} } as never, { onProposal: (p) => proposals.push(p), onPriority() {} });
    const run = async (name: string, input: unknown = {}) => String(await (list.find((t) => t.name === name) as ModelTool).run(input));
    return { run, proposals };
  };
  return { app, moon, glove, tools };
}

const opsIn = (text: string): ChangeOp[] => {
  const line = text.split("\n").find((l) => l.startsWith("[{") || l === "[]");
  return JSON.parse(line ?? "[]") as ChangeOp[];
};

/** The base-layer position of the Moonlander's home-row key that types `tap`. */
const homeKey = (app: ReturnType<typeof openApp>, layoutId: string, tap: string) => {
  const { document, board } = getLayout(app, layoutId);
  const home = new Set(board.definition.rows.home);
  return (document.layers[0]?.bindings ?? []).findIndex((b, p) => home.has(p) && bindingFunctions(b, document.tapDances)[0] === `key:${tap}`);
};

describe("the agent sees every layout", () => {
  test("list_layouts names both, marks the read-only one, and says what each board can do", async () => {
    const { glove, tools } = await twoBoards();
    const text = await tools(glove.layoutId).run("list_layouts");
    expect(text).toContain("2 layouts");
    expect(text).toContain('"my-glove80" (THIS conversation\'s layout');
    expect(text).toContain('"my-moonlander" (another of BK\'s layouts: read-only)');
    expect(text).toMatch(/Moonlander[\s\S]*Can do: per-key colours, combos/);
    expect(text).toMatch(/Glove80[\s\S]*Cannot do: per-key colours \(its lights are ZMK underglow/);
    expect(text).toContain("Layers (");
  });

  test("get_layout with another layout is read-only and says whose positions these are", async () => {
    const { glove, tools } = await twoBoards();
    const text = await tools(glove.layoutId).run("get_layout", { layout: "my-moonlander", layers: ["layer-0"] });
    expect(text).toContain("READ-ONLY");
    expect(text).toContain("Layout my-moonlander");
    expect(text).toContain("board zsa/moonlander");
    // Without `layout` it is still this conversation's layout, as before.
    const own = await tools(glove.layoutId).run("get_layout", { layers: ["0"] });
    expect(own).toContain("Layout my-glove80");
    expect(own).not.toContain("READ-ONLY");
  });

  test("an unknown layout name is an error the agent can read, and its own name is not 'another layout'", async () => {
    const { glove, tools } = await twoBoards();
    await expect(tools(glove.layoutId).run("get_layout", { layout: "my-moonlandr" })).rejects.toThrow(/no layout "my-moonlandr"/);
    await expect(tools(glove.layoutId).run("map_keys", { from: "my-glove80" })).rejects.toThrow(/this conversation's own layout/);
  });

  test("the other layout is shown as a fresh import would read it, without saving anything", async () => {
    const { app, moon, glove, tools } = await twoBoards();
    const before = getLayout(app, moon.layoutId).revision.id;
    const text = await tools(glove.layoutId).run("list_layouts");
    expect(getLayout(app, moon.layoutId).revision.id).toBe(before);
    expect(text).toContain("tap dances");
  });
});

describe("board capabilities", () => {
  test("copying colours onto a board that cannot show them ends in a plain reason, with no ops", async () => {
    const { glove, tools } = await twoBoards();
    const text = await tools(glove.layoutId).run("map_keys", { from: "my-moonlander", carry: "lighting" });
    expect(text).toContain("Glove80 can't show per-key colours because its lights are ZMK underglow");
    expect(text).toContain("do not offer to set colours on it");
    expect(text).not.toContain("setLayerLighting");
  });

  test("the validator refuses colours on a board that cannot show them, with the board's own reason", async () => {
    const { app, glove } = await twoBoards();
    const view = getLayout(app, glove.layoutId);
    const op: ChangeOp = { op: "setLayerLighting", layerId: view.document.layers[0]?.id as string, lighting: { layer: [10, 255, 255] } };
    const checked = createAgentPorts(app, glove.layoutId, "c").check([op]);
    expect(checked.ok).toBe(false);
    const issue = checked.errors.find((e) => e.code === "lighting_unsupported");
    expect(issue?.plain).toContain("can't show per-key colours because its lights are ZMK underglow");
  });

  test("a board that can show colours receives them layer by layer, on the matching layers", async () => {
    const { app, moon, tools } = await twoBoards();
    // A second Moonlander layout with no colours: the same board, so every colour must land on the same key.
    const second = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "second-moonlander" });
    const source = getLayout(app, moon.layoutId).document;
    const clear = source.layers.filter((l) => l.lighting !== undefined).map((l): ChangeOp => ({ op: "setLayerLighting", layerId: l.id, lighting: null }));
    const head = getLayout(app, second.layoutId);
    if (clear.length > 0) applyOps(app, second.layoutId, { baseRevisionId: head.revision.id, ops: clear, summary: "no colours" });

    const t = tools(second.layoutId);
    const text = await t.run("map_keys", { from: "my-moonlander", carry: "lighting" });
    const ops = opsIn(text);
    const lit = getLayout(app, moon.layoutId).document.layers.filter((l) => l.lighting !== undefined);
    const upgraded = ops.filter((o): o is Extract<ChangeOp, { op: "setLayerLighting" }> => o.op === "setLayerLighting");
    expect(upgraded.length).toBeGreaterThan(0);
    // Every layer the stored Moonlander colours (as a fresh import reads them) gets the same colours on the same keys.
    const sourceView = createAgentPorts(app, second.layoutId, "c").layout("my-moonlander").document;
    const want = sourceView.layers.filter((l) => l.lighting !== undefined);
    expect(want.length).toBeGreaterThan(0);
    for (const layer of want) {
      const op = upgraded.find((o) => o.layerId === layer.id);
      expect(op?.lighting).toEqual(layer.lighting as never);
    }
    expect(lit.length).toBeLessThanOrEqual(want.length);
    expect(text).toContain('"ok":true');
  });
});

describe("copying behaviours across boards", () => {
  test("home row mods from the Moonlander land on the same letters of the Glove80 with the mods of the hand they sit on", async () => {
    const { app, moon, glove, tools } = await twoBoards();
    const source = getLayout(app, moon.layoutId).document;
    const mods = ["A", "S", "D", "F", "J", "K", "L"].flatMap((tap) => {
      const p = homeKey(app, moon.layoutId, tap);
      return source.layers[0]?.bindings[p]?.kind === "holdTap" ? [p] : [];
    });
    expect(mods.length).toBeGreaterThanOrEqual(3);

    const text = await tools(glove.layoutId).run("map_keys", { from: "my-moonlander", fromLayer: "layer-0", toLayer: "0", carry: "behaviours", positions: mods });
    const ops = opsIn(text);
    const sets = ops.filter((o): o is Extract<ChangeOp, { op: "setBinding" }> => o.op === "setBinding");
    expect(sets).toHaveLength(mods.length);

    const target = getLayout(app, glove.layoutId);
    const home = new Set(target.board.definition.rows.home);
    for (const set of sets) {
      expect(home.has(set.at.position)).toBe(true);
      const b = set.binding;
      expect(b.kind).toBe("holdTap");
      if (b.kind !== "holdTap") continue;
      // The key keeps its own letter: whatever the Glove80 typed there is what is tapped now.
      const was = target.document.layers[0]?.bindings[set.at.position];
      expect(was && bindingFunctions(was, target.document.tapDances)[0]).toBe(`key:${b.tap.code}`);
      // And the modifiers are the hand of the key they are on, never mixed.
      const hand = target.board.definition.hands.left.includes(set.at.position) ? "L" : "R";
      expect("mods" in b.hold && b.hold.mods.every((m) => m.startsWith(hand))).toBe(true);
    }
    // Per finger, the same modifier as on the Moonlander (A: Ctrl, S: Alt, F: Command).
    const expected = new Map(mods.map((p) => {
      const b = source.layers[0]?.bindings[p];
      return [b?.kind === "holdTap" ? b.tap.code : "", b?.kind === "holdTap" && "mods" in b.hold ? b.hold.mods.map((m) => m.slice(1)).sort() : []] as const;
    }));
    for (const set of sets) {
      if (set.binding.kind !== "holdTap" || !("mods" in set.binding.hold)) continue;
      expect(set.binding.hold.mods.map((m) => m.slice(1)).sort()).toEqual(expected.get(set.binding.tap.code) as string[]);
    }

    // The Glove80 template has no hold-taps, so profiles are made, one per hand, that wait for the other hand.
    const profiles = ops.filter((o): o is Extract<ChangeOp, { op: "upsertHoldTapProfile" }> => o.op === "upsertHoldTapProfile");
    // One profile per hand, however many keys use it.
    expect(profiles.map((p) => p.profile.id).sort()).toEqual(["home-row-mods-left", "home-row-mods-right"]);
    expect(ops.findIndex((o) => o.op === "upsertHoldTapProfile")).toBeLessThan(ops.findIndex((o) => o.op === "setBinding"));
    for (const { profile } of profiles) {
      const trigger = profile.options["hold-trigger-key-positions"] as number[];
      const own = profile.id.endsWith("left") ? target.board.definition.hands.left : target.board.definition.hands.right;
      expect(trigger.some((p) => own.includes(p) && !(target.board.definition.rows.thumb ?? []).includes(p))).toBe(false);
    }
    expect(text).toContain('"ok":true');
    // Applied, it is a valid layout, and the home-row warning is not raised because the profiles wait for the other hand.
    const applied = applyToDocument(target.document, ops);
    expect(applied.ok).toBe(true);
    expect(text).not.toContain("homerow_same_hand_mods");
  });

  test("a copy that would replace something else on the target is not made, and says so", async () => {
    const { app, moon, glove, tools } = await twoBoards();
    // Macro 0 sits on a key of the Moonlander; by position it lands on a Glove80 key that already does something.
    const source = getLayout(app, moon.layoutId).document;
    const macroKey = (source.layers[0]?.bindings ?? []).findIndex((b) => b.kind === "macro");
    expect(macroKey).toBeGreaterThanOrEqual(0);
    const text = await tools(glove.layoutId).run("map_keys", { from: "my-moonlander", fromLayer: "layer-0", toLayer: "0", strategy: "position", carry: "behaviours", positions: [macroKey], minConfidence: 0.5 });
    expect(text).toMatch(/not copied, key \d+ already does something else/);
    expect(opsIn(text)).toEqual([]);
  });

  test("a layer key whose layer has no counterpart is skipped with the layer's name", async () => {
    const { app, moon, glove, tools } = await twoBoards();
    const source = getLayout(app, moon.layoutId).document;
    // The quote key holds Layer 2 (layer-tap), and the Glove80 template has no layer that does the same job.
    const key = (source.layers[0]?.bindings ?? []).findIndex((b) => b.kind === "holdTap" && "layerId" in b.hold && b.hold.layerId === "layer-2");
    expect(key).toBeGreaterThanOrEqual(0);
    const text = await tools(glove.layoutId).run("map_keys", { from: "my-moonlander", fromLayer: "layer-0", toLayer: "0", carry: "behaviours", positions: [key] });
    expect(text).toContain("switches to the Layer 2 layer, and the target has no layer that does the same job");
  });

  test("native code is never copied across", async () => {
    const { app, moon, glove, tools } = await twoBoards();
    const source = getLayout(app, moon.layoutId).document;
    const native = (source.layers[0]?.bindings ?? []).findIndex((b) => b.kind === "native");
    if (native < 0) return;
    const text = await tools(glove.layoutId).run("map_keys", { from: "my-moonlander", fromLayer: "layer-0", toLayer: "0", carry: "behaviours", positions: [native], minConfidence: 0.3 });
    expect(opsIn(text).filter((o) => o.op === "setBinding")).toEqual([]);
  });

  test("positions past the end of the other board are reported, not applied, and do not break the result", async () => {
    const { glove, tools } = await twoBoards();
    const text = await tools(glove.layoutId).run("map_keys", { from: "my-moonlander", fromLayer: "layer-0", toLayer: "0", carry: "behaviours", positions: [999, 30] });
    expect(text).toContain("the source layout has no such key");
    expect(opsIn(text).filter((o) => o.op === "setBinding")).toHaveLength(1);
  });

  test("copying behaviours needs the keys to be named; it never copies the whole layer by default", async () => {
    const { glove, tools } = await twoBoards();
    await expect(tools(glove.layoutId).run("map_keys", { from: "my-moonlander", carry: "behaviours" })).rejects.toThrow(/needs `positions`/);
  });

  test("combos come across with their keys mapped, and the ones that cannot say why", async () => {
    const { app, moon, glove, tools } = await twoBoards();
    const source = getLayout(app, moon.layoutId).document;
    const ids = source.combos.map((c) => c.id);
    const text = await tools(glove.layoutId).run("map_keys", { from: "my-moonlander", fromLayer: "layer-0", toLayer: "0", carry: "combos", comboIds: [...ids, "nope"] });
    expect(text).toContain('not copied, the source layout has no combo "nope"');
    const combos = opsIn(text).filter((o): o is Extract<ChangeOp, { op: "upsertCombo" }> => o.op === "upsertCombo");
    const target = getLayout(app, glove.layoutId);
    for (const { combo } of combos) {
      expect(combo.positions.every((p) => p < target.board.definition.keyCount)).toBe(true);
      expect(combo.positions).toEqual([...combo.positions].sort((a, b) => a - b));
      expect(target.document.combos.some((c) => c.id === combo.id)).toBe(false);
    }
    expect(applyToDocument(target.document, opsIn(text)).ok).toBe(true);
  });

  test("results are read fresh every call: once applied, the same request has nothing left to change", async () => {
    const { app, moon, glove, tools } = await twoBoards();
    const a = homeKey(app, moon.layoutId, "S");
    const input = { from: "my-moonlander", fromLayer: "layer-0", toLayer: "0", carry: "behaviours", positions: [a] };
    const first = await tools(glove.layoutId).run("map_keys", input);
    const ops = opsIn(first);
    expect(ops.length).toBeGreaterThan(0);
    const head = getLayout(app, glove.layoutId);
    applyOps(app, glove.layoutId, { baseRevisionId: head.revision.id, ops, summary: "copy" });
    const second = await tools(glove.layoutId).run("map_keys", input);
    expect(second).toContain("already the same, no op");
    expect(opsIn(second)).toEqual([]);
  });
});

describe("a conversation about another keyboard, with a scripted model", () => {
  test("the model looks before asking, the prompt says other layouts exist, and a proposal targets only this layout", async () => {
    const { app, moon, glove } = await twoBoards();
    const a = homeKey(app, moon.layoutId, "S");
    const seenSystem: string[] = [];
    let mapped = "";
    const { client } = fakeAnthropic([
      { blocks: [{ tool: "list_layouts", input: {} }] },
      (seen) => {
        seenSystem.push(String(JSON.stringify(seen.body.system)));
        return { blocks: [{ tool: "get_layout", input: { layout: "my-moonlander", layers: ["layer-0"] } }] };
      },
      { blocks: [{ tool: "map_keys", input: { from: "my-moonlander", fromLayer: "layer-0", toLayer: "0", carry: "behaviours", positions: [a] } }] },
      (seen) => {
        mapped = seen.toolResults[0] ?? "";
        const ops = opsIn(mapped);
        return {
          blocks: [{
            tool: "propose_changes",
            input: {
              alternatives: [{
                title: "Option on S like the Moonlander",
                ops,
                explanation: "S holds Option on the Moonlander; the key that types S here does too.",
                tradeoffs: { gains: ["Same shortcut as the Moonlander"], costs: ["A holds a modifier, so rolling keys needs the other hand"] },
                decisionDraft: draft({ goal: "Copy my home row mods from the Moonlander", choice: "Option on S", reason: "You use it on the Moonlander" }),
              }],
            },
          }],
        };
      },
      { blocks: [{ text: "Done. S holds Option, as on your Moonlander." }] },
    ]);
    const result = await sendMessage(app, glove.layoutId, { message: "copy my home row mods from my moonlander", model: anthropicModel(client) });
    expect(seenSystem[0]).toContain("BK's other layouts (read-only)");
    expect(seenSystem[0]).toContain("my-moonlander");
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]?.validation.ok).toBe(true);
    const changes = listChanges(app, glove.layoutId);
    expect(changes.length).toBe(1);
    // Nothing was proposed on the Moonlander.
    expect(listChanges(app, moon.layoutId)).toEqual([]);
    expect(applyChange).toBeDefined();
  });
});
