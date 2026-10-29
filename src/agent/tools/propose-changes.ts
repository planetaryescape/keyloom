import { z } from "zod";
import { ChangeOpSchema, DecisionDraftSchema } from "../../layout/change.ts";
import type { AgentPorts, ProposalResult } from "../ports.ts";
import type { TurnRecorder } from "../recorder.ts";
import { defineTool } from "./define.ts";
import { validationForModel } from "./validation-text.ts";

/** 03#the-loop-for-one-message: after this many attempts with nothing valid, the agent stops retrying and tells BK. */
export const MAX_FAILED_PROPOSALS = 3;

const ProposalSchema = z.object({
  title: z.string().min(1).max(80).describe('Short card heading, such as "Plain Option on the symbol layer". Keys by what they print, never by number.'),
  ops: z.array(ChangeOpSchema).min(1).describe("The change as ops, applied in order. A proposal with no ops is not a proposal; describe it in your reply instead."),
  explanation: z.string().min(1).describe("Why this solves what BK described, in plain words: a first sentence that says what changes, then at most a sentence or two of reasoning. The card shows the first sentence and keeps the rest behind Details. It is also the line History shows for this change, so start with what changes, and name keys by what they print and where they sit (\"the R key on Layer 0\"), never by number."),
  tradeoffs: z.object({
    gains: z.array(z.string()).describe("What gets better, including functions that become easier to reach."),
    costs: z.array(z.string()).describe("What gets worse or moves, including anything displaced and how BK will have to relearn it."),
  }),
  decisionDraft: DecisionDraftSchema.describe(
    "What keyloom will remember if BK applies this, so a later change can bring the reason back. Write it from what BK said: his goal, what this proposal chooses, and why. When it revises an earlier proposal after he answered a question, the reason carries his answers in his own words (\"You said your left hand stays free, and you barely use F16\"), because this is the only draft that is kept.",
  ),
});

const InputSchema = ProposalSchema.extend({
  supersedes: z.string().min(1).nullable().optional().describe(
    "Required whenever a proposal of yours is still open in this conversation, and left out when none is. The id of the open proposal this one revises (a revision after BK's answer): it is set aside as superseded once this one is saved, and this one replaces it on the board. Or null when this one is separate and stands beside the open one. Without it while one is open, nothing is saved and you are told which are open.",
  ),
});

const STOP = `You have made ${MAX_FAILED_PROPOSALS} proposals with no valid alternative. Stop proposing. Tell BK in plain words what you were trying to do, which validation errors blocked it, and what he could decide to unblock it.`;

/**
 * Conversations stored before D-452 hold calls shaped `{ alternatives: [...] }`, and a model that reads one may write it again, as the review
 * run does with one alternative. A single one is accepted as a proposal; two or more are the old way of working, so they are refused with
 * the reason rather than quietly kept.
 */
function flatten(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || !("alternatives" in raw) || !Array.isArray(raw.alternatives)) return raw;
  const { alternatives, ...rest } = raw as { alternatives: unknown[] } & Record<string, unknown>;
  if (alternatives.length > 1) throw new Error("propose_changes takes one proposal per call, the best one: send its fields directly. To offer a different way instead, revise it after BK answers a question.");
  return { ...(alternatives[0] as object), ...rest };
}

function describe(r: ProposalResult, supersedes: string | null | undefined): string {
  const replaced = typeof supersedes === "string" ? supersedes : null;
  return r.changeSetId === null
    ? `- "${r.title}": INVALID, not saved. Fix these and propose again: ${validationForModel(r.validation)}${replaced === null ? "" : `\n${replaced} is still the current proposal.`}`
    : `- "${r.title}": saved as ${r.changeSetId}. Validation: ${validationForModel(r.validation)}${replaced === null ? "" : `\n${replaced} is now superseded; ${r.changeSetId} replaces it on BK's board.`}`;
}

export const proposeChangesTool = (ports: AgentPorts, recorder: TurnRecorder, onProposal: (p: ProposalResult) => void) => {
  let failedAttempts = 0;
  const tool = defineTool({
    name: "propose_changes",
    description:
      "Put your best proposal on BK's board: one change set with ops, an explanation, trade-offs and a decision draft. This is the only way a proposal reaches him. It is validated against the head: a valid one is saved for BK to apply, an invalid one comes back with errors for you to repair. You never apply anything. After BK answers a question, call it again with supersedes set to the proposal the question was about, for every answer: the same ops if the answer only confirms it, and a decision draft whose reason carries the answer. The new one replaces the old on the board. Whenever a proposal of yours is open, say with supersedes whether this replaces one (its id) or stands beside it (null).",
    inputSchema: InputSchema,
    // The ChangeOp union makes a strict grammar the API rejects as too large; zod checks the input instead.
    strict: false,
    run: ({ supersedes, ...proposal }) => {
      if (failedAttempts >= MAX_FAILED_PROPOSALS) return STOP;
      const results = ports.propose([proposal], supersedes === undefined ? undefined : { supersedes });
      for (const r of results) {
        recorder.validation("propose_changes", r.validation);
        if (r.changeSetId !== null) onProposal(r);
      }
      const saved = results.filter((r) => r.changeSetId !== null).length;
      if (saved === 0) failedAttempts++;
      const lines = results.map((r) => describe(r, supersedes));
      if (saved === 0 && failedAttempts >= MAX_FAILED_PROPOSALS) lines.push(STOP);
      return lines.join("\n");
    },
  });
  return { ...tool, run: (raw: unknown) => tool.run(flatten(raw)) };
};
