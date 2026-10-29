import { z } from "zod";
import { defineTool } from "./define.ts";

export const QuestionKindSchema = z.enum([
  "single_choice",
  "multiple_choice",
  "short_text",
  "keyboard_or_config",
  "layer",
  "key",
]);
export type QuestionKind = z.infer<typeof QuestionKindSchema>;

const OptionSchema = z.object({
  id: z.string().min(1).optional().describe("Stable identifier for the option."),
  label: z.string().min(1).max(60).describe("The choice in a few words, as a button."),
  description: z.string().min(1).max(160).optional().describe("One line on what it means or costs. Omit when the label says it."),
  recommended: z.boolean().optional().describe("True if this is the recommended option."),
});

// What a model must send. A question is a step in refining the proposal already on the board (D-452), so it says why it matters and where it
// sits in the run. The schema is held to the model only: `StoredQuestionSchema` below reads what is already stored.
const QuestionFields = {
  kind: QuestionKindSchema.optional().describe("The kind of input: single_choice (default), multiple_choice, short_text, keyboard_or_config, layer, or key."),
  question: z.string().min(1).max(240).describe("One plain sentence BK can answer."),
  options: z.array(OptionSchema).min(0).max(10).optional().describe("The choices. A single_choice question (the default kind) has two or three, the recommended one first. The picker kinds may list more. Omit for short_text or direct board key-picking."),
  placeholder: z.string().max(80).optional().describe("Placeholder hint for short_text input."),
  targetBoard: z.string().optional().describe("Target keyboard identifier for key, layer or config selection."),
  targetLayer: z.string().optional().describe("Target layer identifier for key picking."),
  allowedPositions: z.array(z.number().int().nonnegative()).optional().describe("Allowed key positions when picking a key."),
  allowedLayers: z.array(z.string()).optional().describe("Allowed layer identifiers when choosing a layer."),
  allowedKeyboards: z.array(z.string()).optional().describe("Allowed keyboard identifiers when choosing a keyboard."),
  allowOther: z.boolean().optional().describe("True when BK may type an answer you did not list."),
};

/** The most questions one run may announce. The prompt asks for at most three; this only stops a runaway count. */
export const MAX_QUESTIONS = 5;

const StepSchema = z.object({
  n: z.number().int().min(1).max(MAX_QUESTIONS).describe("This question's place in the run, from 1."),
  of: z.number().int().min(1).max(MAX_QUESTIONS).describe("How many questions you expect to ask in all. Change it on a later question when an answer adds or removes one."),
}).refine((step) => step.n <= step.of, { message: "n must not be greater than of" });

const ConsiderationsSchema = z.array(z.string().min(1).max(100)).min(1).max(3);

/** A refining question is a choice between two or three ways to revise the proposal; the pickers (key, layer, keyboard, several answers) keep their longer lists. */
export const REFINING_OPTIONS = { min: 2, max: 3 };

export const AskUserSchema = z.object({
  ...QuestionFields,
  considerations: ConsiderationsSchema.describe("One to three short lines on what matters for this choice, shown under the question. Not a restatement of the question."),
  step: StepSchema,
}).refine(
  (q) => (q.kind !== undefined && q.kind !== "single_choice") || (q.options !== undefined && q.options.length >= REFINING_OPTIONS.min && q.options.length <= REFINING_OPTIONS.max),
  { message: `a single_choice question has ${REFINING_OPTIONS.min} to ${REFINING_OPTIONS.max} options, the recommended one first`, path: ["options"] },
);

/** What is stored and shown. Conversations stored before D-452 carry neither field, and a question that fails to parse would vanish while its conversation still waits for the answer. */
export const StoredQuestionSchema = z.object({
  ...QuestionFields,
  considerations: ConsiderationsSchema.optional(),
  step: StepSchema.optional(),
});
export type AskedQuestion = z.infer<typeof StoredQuestionSchema>;

export const askUserTool = () =>
  defineTool({
    name: "ask_user",
    description:
      "Refine the proposal that is already on BK's board with one question. Call it after propose_changes has put a best proposal there, in a reply of its own (never in the same reply as propose_changes), and only when the answer would change that proposal and nothing BK said answers it. Give the considerations that matter, your place in the run as step { n, of } (at most three questions in all), and two or three options with your recommendation first (the picker kinds may list more). Never for anything you can decide or default, and never for what he already asked for: an explicit instruction is never asked again. When BK answers, the answer comes back as this call's result: call propose_changes with supersedes for every answer, with the same ops if nothing changes, so his answer is in the decision. The exceptions are choices that must be made before any proposal can exist (a remembered decision that may no longer hold, a step that cannot be undone): ask those first, with step { n: 1, of: 1 }. The turn stops at this call and no other tool runs in the same reply.",
    inputSchema: AskUserSchema,
    pauses: true,
    run: () => "The question is on BK's screen. His answer will arrive as this call's result.",
  });

export const ASK_USER = "ask_user";
