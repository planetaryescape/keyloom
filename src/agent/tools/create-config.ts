import { z } from "zod";
import { defineTool } from "./define.ts";

const InputSchema = z.object({
  name: z.string().min(1).max(80).describe('The new config\'s name, such as "Colemak". Pick a clear one yourself; if it is taken, call again with another.'),
  from: z.enum(["this", "blank"]).describe('"this": a copy of the config this conversation is about, the usual start for a different way of typing. "blank": the board\'s empty start.'),
});

export const createConfigTool = (ports: { newConfig(input: z.infer<typeof InputSchema>): { id: string; name: string; boardName: string } }) =>
  defineTool({
    name: "create_config",
    description:
      'Make a NEW config for this board ("make me a Colemak config", "a separate layout for steno", "keep my current layout and try another"). It is never a layer and never put on the keyboard: the current config stays as it is until BK switches. Call it at once with a copy of this config and a name you choose, then say it exists and offer to start changing it. Changes to the new config are proposed in a conversation on it.',
    inputSchema: InputSchema,
    run: (input) => {
      const made = ports.newConfig(input);
      return `Made the config "${made.name}" (${made.id}) on the ${made.boardName}${input.from === "this" ? ", copied from this one" : ", from the board's blank start"}. It is not on the keyboard; this conversation's config is unchanged. Tell BK it exists and that he can switch to it from the config menu and talk to you there; don't name any command.`;
    },
  });
