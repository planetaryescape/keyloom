// The quiet line under a streaming reply, from the agent tool that is running (docs/blueprint/03-agent.md#tools).
const LABELS: Readonly<Record<string, string>> = {
  get_layout: "Looking at your layout…",
  find_function: "Looking at your layout…",
  analyse_change: "Checking a change…",
  propose_changes: "Preparing your options…",
  record_priority: "Noting what matters to you…",
  update_decision_outcome: "Updating your notes…",
};

export const toolActivity = (name: string): string => LABELS[name] ?? "Working…";
