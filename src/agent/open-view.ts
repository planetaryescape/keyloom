/** A local view is not a recording, setting change, or domain effect. */
export type AgentView = "history" | "lab" | "decisions" | "settings";
export type ViewUnavailableReason = "unsupported" | "busy" | "timeout" | "cancelled" | "background" | "draft" | "recording" | "moved" | "disconnected" | "limit";
export type ViewResult = { version: 1; status: "opened" | "already-open" } | { version: 1; status: "unavailable"; reason: ViewUnavailableReason };
