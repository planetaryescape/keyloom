import type { ModelTool } from "../model.ts";
import type { AgentPorts, ProposalResult, RecordedPriority } from "../ports.ts";
import type { TurnRecorder } from "../recorder.ts";
import { askUserTool } from "./ask-user.ts";
import { analyseChangeTool } from "./analyse-change.ts";
import { createConfigTool } from "./create-config.ts";
import { findFunctionTool } from "./find-function.ts";
import { getLayoutTool } from "./get-layout.ts";
import { getReviewTool } from "./get-review.ts";
import { getTypingFindingsTool } from "./get-typing-findings.ts";
import { listLayoutsTool } from "./list-layouts.ts";
import { mapKeysTool } from "./map-keys.ts";
import { mirrorKeysTool } from "./mirror-keys.ts";
import { proposeChangesTool } from "./propose-changes.ts";
import { putConfigTool } from "./put-config.ts";
import { recordPriorityTool } from "./record-priority.ts";
import { updateDecisionOutcomeTool } from "./update-decision-outcome.ts";

/** What a tool reports to the caller as it works, for the chat panel's live cards and chips. */
export type ToolEvents = { onProposal: (p: ProposalResult) => void; onPriority: (p: RecordedPriority) => void };

export function createTools(ports: AgentPorts, recorder: TurnRecorder, events: ToolEvents): ModelTool[] {
  return [
    listLayoutsTool(ports),
    getLayoutTool(ports),
    findFunctionTool(ports),
    analyseChangeTool(ports, recorder),
    recordPriorityTool(ports, events.onPriority),
    updateDecisionOutcomeTool(ports),
    proposeChangesTool(ports, recorder, events.onProposal),
    mirrorKeysTool(ports),
    mapKeysTool(ports),
    putConfigTool(ports),
    getTypingFindingsTool(ports),
    getReviewTool(ports),
    askUserTool(),
    createConfigTool(ports),
  ];
}
