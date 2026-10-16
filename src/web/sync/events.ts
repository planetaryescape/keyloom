// Reads the events stream (`GET /api/events`): Server-Sent Events frames (`event: sync` and `data: <SyncEvent JSON>`) separated by a blank
// line, with comment lines for keep-alive. The chunks can split a frame anywhere; a frame the page can't read is dropped and reported,
// because the next one is a whole snapshot and nothing is lost by skipping.
import type { DetectedKeyboard } from "../../api/detected-keyboards.ts";
import { SyncEventSchema, type BoardSync } from "../../api/http.ts";
import { type ReviewEvent, ReviewEventSchema } from "../../api/review.ts";

/**
 * `newKeyboards` is empty from a sender that doesn't carry them. A `review` frame (D-340) says a board review changed; it is passed to
 * `onReview`, and ignored when the caller has none.
 */
export function createEventParser(
  onBoards: (boards: BoardSync[], newKeyboards: DetectedKeyboard[]) => void, onUnreadable: () => void, onReview?: (event: ReviewEvent) => void,
): { push: (chunk: string) => void } {
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
    if ((json as { type?: unknown } | null)?.type === "review") {
      const review = ReviewEventSchema.safeParse(json);
      if (!review.success) onUnreadable();
      else onReview?.(review.data);
      return;
    }
    const parsed = SyncEventSchema.safeParse(json);
    if (!parsed.success) {
      console.error("keyloom: unreadable sync frame", parsed.error);
      onUnreadable();
      return;
    }
    onBoards(parsed.data.boards, parsed.data.newKeyboards ?? []);
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
