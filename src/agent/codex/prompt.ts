// Codex runs with --ephemeral (its own session files would hold BK's layout and priorities outside
// keyloom), so it cannot resume a thread. keyloom's stored conversation is replayed to it as text
// instead, which is also why a Codex conversation can't be handed to another provider (D-111).
import type { ModelMessage } from "../model.ts";

// A tool result can be the whole layout; Codex can call the tool again if it needs the rest.
const RESULT_LIMIT = 2_000;

const clip = (text: string) => (text.length > RESULT_LIMIT ? `${text.slice(0, RESULT_LIMIT)}... (cut; call the tool again for the rest)` : text);

function render(message: ModelMessage): string {
  const parts = message.content.flatMap((block) => {
    switch (block.type) {
      case "text":
        return [block.text];
      case "tool_use":
        return [`[called ${block.name} with ${JSON.stringify(block.input)}]`];
      case "tool_result":
        return [`[${block.is_error ? "error" : "result"}: ${clip(block.content)}]`];
      default:
        return [];
    }
  });
  return `${message.role === "user" ? "BK" : "keyloom"}: ${parts.join("\n")}`;
}

const textOf = (message: ModelMessage) => message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");

/** The last message is the one to answer; everything before it is context, including any tool results merged into it. */
export function transcriptPrompt(messages: ModelMessage[]): string {
  const last = messages.at(-1);
  if (!last) return "";
  const leftovers = last.content.filter((b) => b.type !== "text");
  const earlier = [...messages.slice(0, -1), ...(leftovers.length > 0 ? [{ ...last, content: leftovers }] : [])];
  if (earlier.length === 0) return textOf(last);
  return [
    "This conversation is already under way. What was said so far, oldest first:",
    "",
    ...earlier.map(render),
    "",
    "BK's new message, which you are answering now:",
    textOf(last),
  ].join("\n");
}
