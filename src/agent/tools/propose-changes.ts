import { z } from "zod";
import { ChangeOpSchema } from "../../layout/change.ts";
import type { AgentPorts, ProposalResult } from "../ports.ts";
import type { TurnRecorder } from "../recorder.ts";
import { defineTool } from "./define.ts";
import { validationForModel } from "./validation-text.ts";

/** 03#the-loop-for-one-message: after this many attempts with nothing valid, the agent stops retrying and tells BK. */
export const MAX_FAILED_PROPOSALS = 3;

const ProposalSchema = z.object({
  title: z.string().min(1).max(80).describe('Short card heading, such as "Plain Option on the symbol layer".'),
  ops: z.array(ChangeOpSchema).min(1).describe("The change as ops, applied in order. An alternative with no ops is not a proposal; describe it in your reply instead."),
  explanation: z.string().min(1).describe("Why this solves what BK described, in plain words."),
  tradeoffs: z.object({
    gains: z.array(z.string()).describe("What gets better, including functions that become easier to reach."),
    costs: z.array(z.string()).describe("What gets worse or moves, including anything displaced and how BK will have to relearn it."),
  }),
});

const InputSchema = z.object({ alternatives: z.array(ProposalSchema).min(1).max(3) });

const STOP = `You have made ${MAX_FAILED_PROPOSALS} proposals with no valid alternative. Stop proposing. Tell BK in plain words what you were trying to do, which validation errors blocked it, and what he could decide to unblock it.`;

function describe(r: ProposalResult): string {
  return r.changeSetId === null
    ? `- "${r.title}": INVALID, not saved. Fix these and propose again: ${validationForModel(r.validation)}`
    : `- "${r.title}": saved as ${r.changeSetId}. Validation: ${validationForModel(r.validation)}`;
}

export const proposeChangesTool = (ports: AgentPorts, recorder: TurnRecorder, onProposal: (p: ProposalResult) => void) => {
  let failedAttempts = 0;
  return defineTool({
    name: "propose_changes",
    description:
      "Give BK one to three alternative change sets. This is the only way a proposal reaches him. Each alternative is validated against the head: valid ones are saved for BK to apply, invalid ones come back with errors for you to repair. You never apply anything.",
    inputSchema: InputSchema,
    run: ({ alternatives }) => {
      if (failedAttempts >= MAX_FAILED_PROPOSALS) return STOP;
      const results = ports.propose(alternatives);
      for (const r of results) {
        recorder.validation("propose_changes", r.validation);
        if (r.changeSetId !== null) onProposal(r);
      }
      const saved = results.filter((r) => r.changeSetId !== null).length;
      if (saved === 0) failedAttempts++;
      const lines = results.map(describe);
      if (saved === 0 && failedAttempts >= MAX_FAILED_PROPOSALS) lines.push(STOP);
      return lines.join("\n");
    },
  });
};
