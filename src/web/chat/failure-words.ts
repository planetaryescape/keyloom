// What a reply that stopped says, and which ways out it offers, by the server's code (D-517). The code is `model_<ModelErrorKind>`,
// `missing_api_key` or `agent_error`, whether it came from a live stream's `error` frame or from the failed run's saved presentation, so a
// page that watches a saved run shows the same box as one that streamed it. Never parse the message for this.

export type FailureAction =
  /** The provider's billing page. */
  | "credits"
  /** Opens the model setup for the provider this conversation uses. */
  | "set_up_model"
  /** One button per other provider that is ready; a new conversation takes the message. */
  | "switch"
  /** Starts a new conversation: the same request can never fit this one again. */
  | "new_conversation"
  /** Sends the same message again. Offered only where a second try can succeed. */
  | "retry";

export type FailureView = { title: string; message: string; actions: readonly FailureAction[]; setUpLabel: string };

// The account, not the request, failed: another provider would not have, so only these offer a switch and the setup.
const ACCOUNT: readonly FailureAction[] = ["set_up_model", "switch", "retry"];

const VIEWS: Readonly<Record<string, Omit<FailureView, "message"> & { message?: string }>> = {
  model_no_credits: { title: "Out of credits", actions: ["credits", ...ACCOUNT], setUpLabel: "Use another key" },
  model_auth: { title: "The key was refused", actions: ACCOUNT, setUpLabel: "Change the key" },
  model_permission: { title: "The key can't use this model", actions: ACCOUNT, setUpLabel: "Change the key" },
  // The server's sentence for this one can name a terminal command (`codex login`); the button does that job here.
  missing_api_key: { title: "The model isn't set up", message: "keyloom can't use this conversation's model account any more. Set it up again, then try again.", actions: ACCOUNT, setUpLabel: "Set up the model" },
  model_rate_limit: { title: "The model is busy", actions: ["retry"], setUpLabel: "" },
  model_overloaded: { title: "The model is busy", actions: ["retry"], setUpLabel: "" },
  model_connection: { title: "Can't reach the model", actions: ["retry"], setUpLabel: "" },
  model_server: { title: "The model's service had a problem", actions: ["retry"], setUpLabel: "" },
  // A refused request can repeat the same way in this conversation, so a fresh one is offered beside Try again.
  model_request: { title: "The model refused the request", actions: ["retry", "new_conversation"], setUpLabel: "" },
  // Sending it again would be refused the same way (R4-11).
  model_context_full: { title: "This conversation is full", actions: ["new_conversation"], setUpLabel: "" },
};

export function failureView(failure: { code: string; message: string }): FailureView {
  const view = VIEWS[failure.code];
  if (view === undefined) return { title: "The reply stopped", message: failure.message, actions: ["retry"], setUpLabel: "" };
  return { ...view, message: view.message ?? failure.message };
}

/** What the failed reply prepared before it stopped. `mayHave` is the run's `effectsMayHaveOccurred`; null when the reply has no record of it. */
export type Prepared = { proposals: number; priorities: number; mayHave: boolean | null };

const count = (n: number, one: string, many: string) => `${n === 1 ? "a" : n} ${n === 1 ? one : many}`;

/**
 * The sentence about prepared work, and what the retry button says (#288 review). Sending the message again starts the request over: the
 * model does not see what the stopped reply prepared, so it can prepare the same proposals and priorities again. The words say so, and the
 * button reads "Ask again", whenever something was or may have been prepared. Nothing prepared keeps "Try again" and says nothing more.
 */
export function preparedWords(prepared: Prepared, retry: boolean): { note: string | null; retryLabel: "Try again" | "Ask again" } {
  const items = [
    ...(prepared.proposals > 0 ? [count(prepared.proposals, "proposal", "proposals")] : []),
    ...(prepared.priorities > 0 ? [count(prepared.priorities, "priority", "priorities")] : []),
  ];
  if (items.length > 0) {
    const shown = prepared.proposals + prepared.priorities === 1 ? "It is above" : "They are above";
    return { note: `Before it stopped, this reply prepared ${items.join(" and ")}. ${shown}.${retry ? " Asking again starts over and can prepare the same again." : ""}`, retryLabel: "Ask again" };
  }
  if (prepared.mayHave === false) return { note: null, retryLabel: "Try again" };
  if (prepared.mayHave === true) return { note: `Configs or proposals it prepared before it stopped may remain.${retry ? " Check them before you ask again." : ""}`, retryLabel: "Ask again" };
  return { note: `Configs or proposals prepared before the reply stopped may remain.${retry ? " Check them before trying again." : ""}`, retryLabel: "Try again" };
}
