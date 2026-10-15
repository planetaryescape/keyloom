import { z } from "zod";
import type { AgentPorts } from "../ports.ts";
import { defineTool } from "./define.ts";

const InputSchema = z.object({
  decisionId: z.string().min(1).describe("The decision's id, as listed under the earlier decisions in this prompt."),
  status: z
    .enum(["tried_helpful", "tried_unhelpful"])
    .describe("tried_helpful: BK used it and it worked out. tried_unhelpful: he used it and it did not, or it feels wrong."),
  note: z.string().min(1).max(300).describe("What BK said about how it went, in his own words, such as \"holding F for Command feels slow\"."),
});

export const updateDecisionOutcomeTool = (ports: AgentPorts) =>
  defineTool({
    name: "update_decision_outcome",
    description:
      "Record how an earlier choice turned out, when BK tells you: \"that fixed it\", \"I love it\", \"it feels slow now\", \"that never worked\". Use it only for a decision listed under the earlier decisions, and only on what he said, never a guess. It does not change the layout: if he also wants a change, propose it separately. A choice that was marked tried_helpful needs a reason from him before you propose undoing it.",
    inputSchema: InputSchema,
    run: ({ decisionId, status, note }) => {
      const d = ports.recordOutcome({ decisionId, status, note });
      return `Recorded for ${d.id} ("${d.goal}"): ${d.status}, "${note}". It stays in your earlier decisions with that outcome.`;
    },
  });
