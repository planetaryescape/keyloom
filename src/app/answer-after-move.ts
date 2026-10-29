// What the model reads with BK's answer when the layout head moved after the run that asked the question began (D-458). Its own file because only
// the conversation code uses it, to store the answer.
import type { ContentBlock } from "../agent/model.ts";
import { headline } from "../layout/history-summary.ts";
import type { App } from "./context.ts";
import { listRevisions } from "./history.ts";

/** A revision's summary as one short line: a change from the chat stores the agent's whole explanation, and the note must stay one paragraph. */
function brief(summary: string): string {
  const line = headline(summary).replace(/\s+/g, " ");
  const characters = [...line]; // by character, so a cut never splits a surrogate pair
  return characters.length > 100 ? `${characters.slice(0, 99).join("")}…` : line;
}

/**
 * The tool result stored for an answer. When the layout head is `since`, the head the run that asked was accepted at, it is BK's words. When it is
 * not (a change made while that run was still working counts too), a note goes ahead of them: the model reads it first and looks at the layout
 * again, and every revision it makes after that is still validated against the head (D-014). With `since` not among the revisions (it always is)
 * the note says the layout changed and not how.
 *
 * The note is told from his words by the record, never by reading the text: `words` is what he wrote, and the card shows it. `providerData` is the
 * block as the API gets it. An older keyloom sends a block with a key it does not know exactly as stored, so without it `words` would go to the API.
 */
export function answerResult(app: App, layoutId: string, toolUseId: string, since: string, head: string, words: string): ContentBlock {
  if (since === head) return { type: "tool_result", tool_use_id: toolUseId, content: words };
  const revisions = listRevisions(app, layoutId);
  const moved = revisions.findIndex((revision) => revision.id === since);
  const latest = revisions[0];
  const named = moved < 0 || latest === undefined ? "" : moved === 1 ? ` (1 revision: "${brief(latest.summary)}")` : ` (${moved} revisions, the latest "${brief(latest.summary)}")`;
  const content = `The layout changed after your last reply began${named}. Read it again with get_layout before you revise anything. BK's answer:\n\n${words}`;
  return { type: "tool_result", tool_use_id: toolUseId, content, words, providerData: { type: "tool_result", tool_use_id: toolUseId, content } };
}
