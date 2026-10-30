// "Fix issues" in the board review (D-461): one validated change that answers what the review found, refined by the agent's questions in
// the chat beside the board. Shown only when there is something a change can fix: the visible problems and hints. A suggestion is already
// a proposal, so it neither adds a reason for the button nor removes one.
export function FixIssuesButton({ findings, stale, busy, reviewing, ready, onFix }: {
  /** Visible problems and hints, the findings a fix run works from (`fixableFindings`). Hidden ones are not counted. */
  findings: number;
  /** The review is of an older revision; the head's is being made. */
  stale: boolean;
  /** The panel is running a review action (dismiss, restore, look again). */
  busy: boolean;
  /** The review's own agent look is still being written. */
  reviewing: boolean;
  /** The provider the next conversation would use is set up and ready. */
  ready: boolean;
  onFix: () => void;
}) {
  if (findings === 0) return null;
  let blocked: string | null = null;
  if (stale) blocked = "This review is of an older version; fix from the new one";
  else if (reviewing) blocked = "The agent's own look is still coming; fix once it is in";
  else if (busy) blocked = "Finish the review action first";
  else if (!ready) blocked = "Set up a model to fix the issues";
  return (
    <button type="button" className="bar-apply" disabled={blocked !== null} title={blocked ?? "One change that answers what the review found"} onClick={onFix}>
      Fix issues
    </button>
  );
}
