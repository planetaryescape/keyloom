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

export const AskUserSchema = z.object({
  kind: QuestionKindSchema.optional().describe("The kind of input: single_choice (default), multiple_choice, short_text, keyboard_or_config, layer, or key."),
  question: z.string().min(1).max(240).describe("One plain sentence BK can answer."),
  options: z.array(OptionSchema).min(0).max(10).optional().describe("The choices for choice kinds. Omit for short_text or direct board key-picking."),
  placeholder: z.string().max(80).optional().describe("Placeholder hint for short_text input."),
  targetBoard: z.string().optional().describe("Target keyboard identifier for key, layer or config selection."),
  targetLayer: z.string().optional().describe("Target layer identifier for key picking."),
  allowedPositions: z.array(z.number().int().nonnegative()).optional().describe("Allowed key positions when picking a key."),
  allowedLayers: z.array(z.string()).optional().describe("Allowed layer identifiers when choosing a layer."),
  allowedKeyboards: z.array(z.string()).optional().describe("Allowed keyboard identifiers when choosing a keyboard."),
  allowOther: z.boolean().optional().describe("True when BK may type an answer you did not list."),
});
export type AskedQuestion = z.infer<typeof AskUserSchema>;

export const askUserTool = () =>
  defineTool({
    name: "ask_user",
    description:
      "Ask BK one question when the choice is really his and nothing sensible can be assumed: replacing the config he runs versus adding a new one when the request does not say, or a step that cannot be undone. Never for anything you can decide or default, and never for what he already asked for: an explicit instruction such as replace my config is never asked again, so do it, and when it is destructive but one click to undo (the old config stays in History) say so in one line. Act on the default and say what you chose. At most once per turn, and call no other tool in the same reply. The turn stops here and BK's answer comes back as this call's result.",
    inputSchema: AskUserSchema,
    pauses: true,
    run: () => "The question is on BK's screen. His answer will arrive as this call's result.",
  });

export const ASK_USER = "ask_user";
