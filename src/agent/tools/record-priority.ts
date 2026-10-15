import { z } from "zod";
import { SlotSchema } from "../../layout/change.ts";
import { PRIORITY_KINDS } from "../../memory/priorities.ts";
import { findOccurrences, normalizeFunction } from "../layout-facts.ts";
import type { AgentPorts, RecordedPriority } from "../ports.ts";
import { defineTool } from "./define.ts";

const InputSchema = z.object({
  priorityKind: z
    .enum(PRIORITY_KINDS)
    .describe("pinned: keep it where it is. rarely_used: BK barely uses it, so it can give up its place. frequent: BK uses it a lot and it must stay easy to reach. willing_to_relearn: BK is happy to learn a new place for it."),
  statement: z.string().min(1).max(300).describe("What BK said, in his own words, such as \"keep Backspace where it is\"."),
  subject: z
    .object({
      functions: z.array(z.string().min(1)).max(10).optional().describe('Functions the statement is about, such as "key:BACKSPACE", "mod:LGUI" or "key:CAPS_LOCK". Prefer this for "keep Backspace" or "I barely use Caps Lock".'),
      slots: z.array(SlotSchema).max(20).optional().describe("Specific keys, when BK means a place and not a function (\"keep this thumb key\")."),
    })
    .describe("What it is about. Give at least one function or slot."),
  reason: z.string().max(300).optional().describe("His reason, only if he gave one."),
});

/** One line the model reads back, and the chip BK sees says the same thing in the editor's words. */
function confirmation(r: RecordedPriority): string {
  const what = [...(r.subject.functions ?? []), ...(r.subject.slots ?? []).map((s) => `${s.layerId} position ${s.position}`)].join(", ");
  return r.alreadyKnown
    ? `Already remembered (${r.id}): ${r.priorityKind} for ${what}. Nothing new was stored.`
    : `Remembered (${r.id}): ${r.priorityKind} for ${what}, as "${r.statement}". BK sees it as a chip he can remove.`;
}

export const recordPriorityTool = (ports: AgentPorts, onRecorded: (p: RecordedPriority) => void) =>
  defineTool({
    name: "record_priority",
    description:
      'Remember something BK has just told you matters: a key that must stay put ("keep Backspace where it is"), one he barely uses ("I barely use Caps Lock"), one he uses constantly, or one he is willing to relearn. Call it as soon as he says it, once per statement, before you ask more questions or propose. Record only what he said, never a guess. Do not record something already listed under his priorities.',
    inputSchema: InputSchema,
    run: ({ priorityKind, statement, subject, reason }) => {
      const { document, board } = ports.snapshot();
      const functions: string[] = [];
      const notes: string[] = [];
      for (const requested of subject.functions ?? []) {
        const fn = normalizeFunction(requested);
        if (fn === null) throw new Error(`"${requested}" is not a function id; use forms like key:BACKSPACE, mod:LGUI, layer:momentary:layer-1 or macro:<id>`);
        if (findOccurrences(document, fn).length === 0) notes.push(`${fn} is on no key right now; it is remembered anyway.`);
        if (!functions.includes(fn)) functions.push(fn);
      }
      const slots = subject.slots ?? [];
      for (const slot of slots) {
        if (!document.layers.some((l) => l.id === slot.layerId)) throw new Error(`no layer "${slot.layerId}"; layers are: ${document.layers.map((l) => l.id).join(", ")}`);
        if (slot.position >= board.definition.keyCount) throw new Error(`position ${slot.position} is not on this board (0-${board.definition.keyCount - 1})`);
      }
      if (functions.length === 0 && slots.length === 0) throw new Error("a priority needs at least one function or slot");

      const recorded = ports.recordPriority({
        priorityKind, statement, subject: { ...(functions.length ? { functions } : {}), ...(slots.length ? { slots } : {}) }, ...(reason ? { reason } : {}),
      });
      if (!recorded.alreadyKnown) onRecorded(recorded);
      return [confirmation(recorded), ...notes].join("\n");
    },
  });
