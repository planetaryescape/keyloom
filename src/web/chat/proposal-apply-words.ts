// Why Apply on a proposal card failed, by the server's code only (R6-06). The same card serves chat and OpenProposals. Pure.

export type ProposalApplyFailure = {
  message: string;
  /** The layout moved on: the proposal can be planned again, never applied as it is. */
  stale: boolean;
  /** Applied or set aside elsewhere (another tab, the CLI, the review): Apply is off and the proposals are read again. */
  closed: boolean;
};

export const CLOSED_WORDS = "This proposal is no longer open.";

export function proposalApplyFailure(error: { code?: string | undefined; status?: number; message: string } | null): ProposalApplyFailure {
  if (error === null) return { message: "Couldn't apply this.", stale: false, closed: false };
  if (error.code === "stale_base") return { message: "The layout changed after this was proposed, so it no longer applies cleanly.", stale: true, closed: false };
  // The apply route answers 400 not_open ("change set … is applied, not proposed") or 404 for one that is gone. Its sentence names an
  // internal ID, and asking again is refused the same way. Any other refusal keeps the server's words: the proposal may still be open.
  if (error.code === "not_open" || error.code === "not_found") return { message: CLOSED_WORDS, stale: false, closed: true };
  return { message: error.message, stale: false, closed: false };
}
