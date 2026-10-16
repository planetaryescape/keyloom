import type { Turn } from "./transcript.ts";
import { Markdown } from "./Markdown.tsx";

/** The conversation on screen when BK switched board or config (D-317), shown above this layout's own. */
export type CarriedThread = { fromName: string; turns: readonly Turn[] };

// A conversation belongs to one layout: its agent reads and proposes against that layout, so it can't continue on another (D-317).
// The thread stays in view across the switch, read-only and without its options (they'd apply to the other layout), and the next
// message starts this layout's conversation.
export function CarriedThreadView({ thread, boardName }: { thread: CarriedThread; boardName: string }) {
  return (
    <div className="carried-thread" aria-label={`Earlier, about ${thread.fromName}`}>
      <p className="carried-head">Earlier, about {thread.fromName}</p>
      {thread.turns.map((turn) =>
        turn.kind === "user" ? (
          <div key={turn.id} className="msg msg-user carried-turn">
            <p className="msg-who">You</p>
            <div className="msg-bubble"><p>{turn.text}</p></div>
          </div>
        ) : (
          <div key={turn.id} className="msg msg-assistant carried-turn">
            <p className="msg-who">keyloom</p>
            {turn.text === "" ? null : <Markdown source={turn.text} />}
            {turn.proposals.length === 0 ? null : (
              <p className="carried-note">{turn.proposals.length === 1 ? "An option was" : `${turn.proposals.length} options were`} offered for {thread.fromName}; open that to apply them.</p>
            )}
          </div>
        ),
      )}
      <p className="carried-foot">New messages are about your {boardName} as it is on screen.</p>
    </div>
  );
}
