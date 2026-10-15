import type { ModelTool } from "../model.ts";
import type { AgentPorts, ProposalResult } from "../ports.ts";
import type { TurnRecorder } from "../recorder.ts";
import { analyseChangeTool } from "./analyse-change.ts";
import { findFunctionTool } from "./find-function.ts";
import { getLayoutTool } from "./get-layout.ts";
import { proposeChangesTool } from "./propose-changes.ts";

/** The rung 3 tools. `record_priority` and `update_decision_outcome` arrive with decisions in rung 6. */
export function createTools(ports: AgentPorts, recorder: TurnRecorder, onProposal: (p: ProposalResult) => void): ModelTool[] {
  return [getLayoutTool(ports), findFunctionTool(ports), analyseChangeTool(ports, recorder), proposeChangesTool(ports, recorder, onProposal)];
}
