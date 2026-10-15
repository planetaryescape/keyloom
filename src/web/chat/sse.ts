// Reads the chat stream's Server-Sent Events frames (`event: <type>` and `data: <ChatEvent JSON>`,
// separated by a blank line) from chunks of text. EventSource cannot POST, so the panel reads a
// fetch body and feeds it here; the chunks can split a frame anywhere, including mid-character
// (the caller's TextDecoder handles that) and between the two newlines of a separator.
import { ChatEventSchema, type ChatEvent } from "../../api/http.ts";

export class SseError extends Error {}

export function createSseParser(onEvent: (event: ChatEvent) => void): { push: (chunk: string) => void; end: () => void } {
  let pending = "";

  function frame(raw: string): void {
    // Per the SSE format, several data lines in one frame join with newlines; keyloom sends one.
    const data = raw
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data === "") return; // a comment or keep-alive
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      throw new SseError("keyloom sent a chat frame this page can't read.");
    }
    const parsed = ChatEventSchema.safeParse(json);
    if (!parsed.success) {
      console.error("keyloom: unreadable chat frame", parsed.error);
      throw new SseError("keyloom sent a chat frame this page can't read.");
    }
    onEvent(parsed.data);
  }

  return {
    push(chunk) {
      pending += chunk.replaceAll("\r\n", "\n");
      for (let end = pending.indexOf("\n\n"); end >= 0; end = pending.indexOf("\n\n")) {
        const raw = pending.slice(0, end);
        pending = pending.slice(end + 2);
        frame(raw);
      }
    },
    end() {
      // A well-formed stream ends on a separator, so anything left is a frame cut short.
      pending = "";
    },
  };
}
