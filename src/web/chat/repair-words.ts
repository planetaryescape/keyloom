// What a repair request says under its title, and the buttons that match the words (R6-23). Pure.

export type RepairKind = "proposal" | "build" | "finding";
export type RepairView = {
  scope: string;
  /** The button that drops the request: Cancel while it can still be sent, Dismiss request once it can't or was sent. */
  dismissLabel: "Cancel" | "Dismiss request";
  /** The one button beside it that moves on: the chat's history after a send, a fresh review for a finding that went out of date. */
  offer: "open_history" | "fresh_review" | null;
};

export function repairWords(kind: RepairKind, state: { sent: boolean; current: boolean }): RepairView {
  if (state.sent) return { scope: "Already sent. If the reply was interrupted, open the chat history to see it before you do anything else. keyloom won't send it again.", dismissLabel: "Dismiss request", offer: "open_history" };
  if (state.current) {
    return { scope: kind === "build" ? "Check the question before sending. It sends the build log to the model; nothing is applied." : "Check the request before sending. It asks for a proposal; nothing is applied.", dismissLabel: "Cancel", offer: null };
  }
  if (kind === "proposal") return { scope: "The layout or source changed. Your original goal and edits are kept. Dismiss this request and select its recovery action again before sending.", dismissLabel: "Dismiss request", offer: null };
  if (kind === "build") return { scope: "The layout changed since this build, so this question no longer fits it. Dismiss it, and ask about the newest build if that one fails too.", dismissLabel: "Dismiss request", offer: null };
  // A fresh review's finding gets a request of its own, and Plan a repair waits while this one is up: the button dismisses it and runs
  // the review in one press, and says so.
  return { scope: "This finding is out of date, so this request can't be sent. Dismiss it and run a fresh review, then plan a repair from the finding it shows.", dismissLabel: "Dismiss request", offer: "fresh_review" };
}
