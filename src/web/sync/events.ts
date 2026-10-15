// Reads the events stream (`GET /api/events`): Server-Sent Events frames (`event: sync` and `data: <SyncEvent JSON>`) separated by a blank
// line, with comment lines for keep-alive. The chunks can split a frame anywhere; a frame the page can't read is dropped and reported,
// because the next one is a whole snapshot and nothing is lost by skipping.
import { SyncEventSchema, type BoardSync } from "../../api/http.ts";

export function createEventParser(onBoards: (boards: BoardSync[]) => void, onUnreadable: () => void): { push: (chunk: string) => void } {
  let pending = "";
  const frame = (raw: string): void => {
    const data = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
    if (data === "") return; // a comment
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      onUnreadable();
      return;
    }
    const parsed = SyncEventSchema.safeParse(json);
    if (!parsed.success) {
      console.error("keyloom: unreadable sync frame", parsed.error);
      onUnreadable();
      return;
    }
    onBoards(parsed.data.boards);
  };
  return {
    push(chunk) {
      pending += chunk.replaceAll("\r\n", "\n");
      for (let end = pending.indexOf("\n\n"); end >= 0; end = pending.indexOf("\n\n")) {
        const raw = pending.slice(0, end);
        pending = pending.slice(end + 2);
        frame(raw);
      }
    },
  };
}
