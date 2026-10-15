import type { ModelTool } from "../model.ts";
import type { AgentPorts, ProposalResult, RecordedPriority } from "../ports.ts";
import type { TurnRecorder } from "../recorder.ts";
import { analyseChangeTool } from "./analyse-change.ts";
import { findFunctionTool } from "./find-function.ts";
import { getLayoutTool } from "./get-layout.ts";
import { mirrorKeysTool } from "./mirror-keys.ts";
import { proposeChangesTool } from "./propose-changes.ts";
import { recordPriorityTool } from "./record-priority.ts";

/** What a tool reports to the caller as it works, for the chat panel's live cards and chips. */
export type ToolEvents = { onProposal: (p: ProposalResult) => void; onPriority: (p: RecordedPriority) => void };

/** `update_decision_outcome` arrives with choice decisions in rung 6. */
export function createTools(ports: AgentPorts, recorder: TurnRecorder, events: ToolEvents): ModelTool[] {
  return [
    getLayoutTool(ports),
    findFunctionTool(ports),
    analyseChangeTool(ports, recorder),
    recordPriorityTool(ports, events.onPriority),
    proposeChangesTool(ports, recorder, events.onProposal),
    mirrorKeysTool(ports),
  ];
}
