import { z } from "zod";
import type { AgentPorts, PutResult } from "../ports.ts";
import { defineTool } from "./define.ts";

const InputSchema = z.object({
  from: z.string().min(1).describe("The layout to copy BK's setup from: its id or name, from list_layouts."),
  board: z.string().min(1).describe("The board to put it on, by id such as local/corne, from list_layouts or boards BK has added. It must not be the board `from` is already on."),
  name: z.string().min(1).optional().describe('The new config\'s name. Omit for "<layout> on <board>". Give another name if one is already taken.'),
  placements: z.record(z.string(), z.number().int().nonnegative()).optional().describe("For a layer key with no counterpart: its position on the SOURCE layout -> the position on the target chosen among the candidates a first call listed. Only when BK chose; omit otherwise."),
});

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function describe(r: PutResult): string {
  const lines = [
    `Made the config "${r.config.name}" (${r.config.id}) on the ${r.config.boardName}. Nothing was applied, nothing was built or flashed, and this conversation's layout is unchanged.`,
    `${plural(r.proposals.length, "proposal")} stored on it for BK to review (the validator checked each against the new config):`,
    ...r.proposals.map((p) => `- ${p.title}: ${p.summary}. ${plural(p.changedKeys, "key")} change${p.changedKeys === 1 ? "s" : ""}, ${plural(p.warnings, "warning")}.`),
    "Layers:",
    ...r.layers.map((l) => `- ${l.source} -> ${l.target}: ${plural(l.carried, "key")} carried${l.guessed > 0 ? `, ${l.guessed} of them nearest-place guesses` : ""}${l.notCarried > 0 ? `, ${l.notCarried} not carried` : ""}`),
  ];
  if (r.notCarried.length > 0) {
    lines.push("Not carried:", ...r.notCarried.slice(0, 20).map((n) => `- ${n.sourceName} (${n.layerName}): ${n.why}`));
    if (r.notCarried.length > 20) lines.push(`- and ${r.notCarried.length - 20} more`);
  }
  const open = r.placements.filter((p) => p.candidates.length > 0 && p.blocked === undefined);
  if (open.length > 0) {
    lines.push("Layer keys with no key of their own, and the keys that could take each (best first; the second proposal uses the first):", ...open.map((p) => `- ${p.sourceName} (${p.layerName}): ${p.candidates.map((c) => `${c.name} at ${c.target}${c.replaces ? ` (replaces ${c.replaces})` : ""}`).join("; ")}`));
  }
  for (const p of r.placements.filter((p) => p.blocked !== undefined)) lines.push(`- ${p.sourceName} (${p.layerName}) can't be placed: ${p.blocked}`);
  if (r.combos.copied.length > 0 || r.combos.skipped.length > 0) {
    lines.push(`Combos: ${r.combos.copied.length} copied${r.combos.skipped.length > 0 ? `; skipped: ${r.combos.skipped.map((s) => `${s.id} (${s.why})`).join("; ")}` : ""}.`);
  }
  if (r.notes.length > 0) lines.push("Notes:", ...r.notes.map((n) => `- ${n}`));
  lines.push("Tell BK in plain words what came across and what did not, and that the proposals wait in the new config (the config menu's switcher, then its open proposals); he applies them, and putting the config on a keyboard is a separate step he takes.");
  return lines.join("\n");
}

export const putConfigTool = (ports: AgentPorts) =>
  defineTool({
    name: "put_config",
    description:
      'Put BK\'s setup from one of his layouts onto another board, such as "put my Glove80 setup on my Corne": it makes a NEW config on that board and stores the mapping of every layer (keys, layer keys, hold-taps, combos) as proposals on it, checked by the validator. Nothing is applied and nothing reaches a keyboard; this conversation\'s layout is not changed. Call list_layouts first to find the layout and the board, and tell BK which board and layout you used. A name already taken is an error: call again with another name. Use map_keys instead to carry parts of another layout into THIS conversation\'s layout.',
    inputSchema: InputSchema,
    // `placements` is a record, which strict structured output does not accept (it needs every object closed).
    strict: false,
    run: ({ from, board, name, placements }) => describe(ports.put({ from, board, ...(name === undefined ? {} : { name }), ...(placements === undefined ? {} : { placements }) })),
  });
