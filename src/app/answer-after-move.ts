// What the model reads with BK's answer when the layout head moved after the run that asked the question began (D-458). Its own file because only
// the conversation code uses it: to store the answer, and to show BK his own words back.
import { headline } from "../layout/history-summary.ts";
import type { App } from "./context.ts";
import { listRevisions } from "./history.ts";

// The fixed ends of the note. What lies between them varies, so the card finds BK's words by both ends and not by the whole text, the way
// `typedText` finds a message after a selection header.
const OPENING = "The layout changed after your last reply began";
const CLOSING = ". Read it again with get_layout before you revise anything. BK's answer:\n\n";

/** A revision's summary as one short line: a change from the chat stores the agent's whole explanation, and the note must stay one paragraph. */
function brief(summary: string): string {
  const line = headline(summary).replace(/\s+/g, " ");
  const characters = [...line]; // by character, so a cut never splits a surrogate pair
  return characters.length > 100 ? `${characters.slice(0, 99).join("")}…` : line;
}

/**
 * The result stored for an answer: BK's words, behind a note when the layout head is not `since`, the head the run that asked was accepted at (so a
 * change made while that run was still working counts too). The model reads the note first and looks at the layout again; every revision it makes
 * after that is still validated against the head (D-014). With `since` not among the revisions (it always is) the note says the layout changed
 * and not how.
 */
export function answerResult(app: App, layoutId: string, since: string, head: string, words: string): string {
  if (since === head) return words;
  const revisions = listRevisions(app, layoutId);
  const moved = revisions.findIndex((revision) => revision.id === since);
  const latest = revisions[0];
  const named = moved < 0 || latest === undefined ? "" : moved === 1 ? ` (1 revision: "${brief(latest.summary)}")` : ` (${moved} revisions, the latest "${brief(latest.summary)}")`;
  return `${OPENING}${named}${CLOSING}${words}`;
}

/** BK's words without the note `answerResult` put ahead of them; any other result comes back as it is. */
export function answerWords(stored: string): string {
  if (!stored.startsWith(OPENING)) return stored;
  const end = stored.indexOf(CLOSING);
  return end < 0 ? stored : stored.slice(end + CLOSING.length);
}
