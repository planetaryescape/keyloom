import { z } from "zod";
import { defineTool } from "./define.ts";

const OptionSchema = z.object({
  label: z.string().min(1).max(60).describe("The choice in a few words, as a button."),
  description: z.string().min(1).max(160).optional().describe("One line on what it means or costs. Omit when the label says it."),
});

export const AskUserSchema = z.object({
  question: z.string().min(1).max(240).describe("One plain sentence BK can answer by pressing a button."),
  options: z.array(OptionSchema).min(2).max(4).describe("The choices. Put the one you recommend first; it is shown marked."),
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
