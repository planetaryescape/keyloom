import { z } from "zod";
import { fingerOf, handOf } from "../layout-facts.ts";
import { bindingLabel } from "../../layout/render-grid.ts";
import { planMirror } from "../mirror-plan.ts";
import type { AgentPorts } from "../ports.ts";
import { defineTool } from "./define.ts";
import { validationForModel } from "./validation-text.ts";

const InputSchema = z.object({
  positions: z.array(z.number().int().nonnegative()).min(1).max(100).describe("The positions to give the behaviour of their mirror-image keys, as in the Selected header or get_layout. Position numbers, not key numbers."),
  layer: z.string().min(1).describe("Layer id, name or index: the layer named in the Selected header, or the one BK is talking about."),
});

export const mirrorKeysTool = (ports: AgentPorts) =>
  defineTool({
    name: "mirror_keys",
    description:
      'Work out "the same as the other hand, mirrored" for some positions. For each, it finds the key at the mirror position on the other half of the board, and gives the binding this position should have: the same hold with this key\'s own letter, modifiers switched to this hand, and a mirrored hold-tap profile where a ZMK profile lists the other hand\'s keys. Returns ready-to-use ops, checked against the layout. Use it instead of working out mirror positions or modifier hands yourself.',
    inputSchema: InputSchema,
    run: ({ positions, layer }) => {
      const { document, board } = ports.snapshot();
      const wanted = document.layers.find((l, i) => l.id === layer || l.name === layer || String(i) === layer);
      if (wanted === undefined) throw new Error(`no layer "${layer}"; layers are: ${document.layers.map((l) => l.id).join(", ")}`);
      const bad = positions.find((p) => p >= board.definition.keyCount);
      if (bad !== undefined) throw new Error(`position ${bad} is not on this board (0-${board.definition.keyCount - 1})`);

      const plan = planMirror(document, board.definition, wanted.id, positions);
      const ctx = { layers: document.layers, macros: document.macros, tapDances: document.tapDances };
      const name = (p: number) => {
        const b = wanted.bindings[p];
        return `key ${p + 1} (position ${p}, ${handOf(board.definition, p)} ${fingerOf(board.definition, p)}${b ? `, ${bindingLabel(b, ctx)}` : ""})`;
      };
      const lines = plan.steps.map((s) => {
        const from = s.partner === null ? "no mirror key" : `mirrors ${name(s.partner)}`;
        if ("binding" in s.outcome) return `- ${name(s.position)} ${from}: becomes ${bindingLabel(s.outcome.binding, ctx)}`;
        if ("unchanged" in s.outcome) return `- ${name(s.position)} ${from}: already matches, no op`;
        return `- ${name(s.position)} ${from}: skipped, ${s.outcome.skip}`;
      });
      const check = plan.ops.length === 0 ? "No ops: nothing to change." : `Validation of these ops: ${validationForModel(ports.check(plan.ops))}`;
      return [
        `Mirror on ${wanted.name} (layer id ${wanted.id}):`,
        ...lines,
        "",
        "Ops covering exactly the keys that change (profile ops first):",
        JSON.stringify(plan.ops),
        "",
        check,
      ].join("\n");
    },
  });
