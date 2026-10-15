// The only module src/cli (and src/server) may import (01#modules).
export { type App, closeApp, openApp } from "./context.ts";
export { BusyError, ModelError, NotFoundError, StaleBaseError, UsageError, ValidationFailedError } from "./errors.ts";
export {
  type ApplyOutcome, type ChangeSetView, applyChange, applyOps, checkChange, editorDraft, listChanges, proposeChange, rejectChange, showChange, undo,
} from "./changes.ts";
export { type ParsedBinding, parseBindingExpression } from "./binding-expression.ts";
export { type ImportInput, type ImportOutcome, type LayoutView, getLayout, importLayout, listLayouts } from "./layouts.ts";
export { type Board, type CheckResult, boardDevView, checkBoard, listBoardDefinitions, regenerateGeometry, showBoard } from "./boards.ts";
export { renderLayoutText, renderPositionGrid, selectLayers } from "./render.ts";
export { type DoctorCheck, runDoctor, runKeyboardChecks, runToolchainChecks } from "./doctor.ts";
export { type HandsFreeDeps, type HandsFreeOverrides, type RebootOutcome, rebootKeyboard } from "./keyboard.ts";
export {
  type BuildOptions, type BuildView, type FlashOptions, type FlashView, type GenerateOutcome, buildAndWait, flashAndWait, generateFirmware,
  getBuild, getFlash, startBuild, startFlash,
} from "./firmware.ts";
export { BuildFailedError, EmulateFailedError, FlashFailedError, RebootFailedError } from "./firmware-errors.ts";
export { type EmulateOptions, type EmulateOutcome, emulateLayout } from "./emulate.ts";
export { SCRIPT_HELP } from "../firmware/emulate/script.ts";
export type { ImportReport } from "../layout/import-report.ts";
export type { Layout } from "../layout/schema.ts";
export { type ChangeOp, ChangeOpSchema } from "../layout/change.ts";
export { describeBinding } from "../layout/functions.ts";
export { type ValidationResult, ValidationResultSchema } from "../validation/result.ts";
export type { ChangeSetSource, ChangeSetStatus } from "../persistence/change-sets.ts";
export type { LayoutRow, RevisionRow } from "../persistence/layouts.ts";
export { logsDir } from "../persistence/paths.ts";
export {
  type ChatEvent, type ChatOutcome, type ConversationView, type DisplayMessage, type PriorityCard, type ProposalCard, type SendMessageInput,
  listConversationSummaries, sendMessage, showConversation,
} from "./conversations.ts";
export {
  type DecisionRow, type DecisionStatus, type OutcomeQuestion, type OutcomeStatus, dismissOutcome, editDecision, listDecisions, outcomeQuestions,
  recordOutcome, recordPriority, retireDecision, retirePriority, showDecision,
} from "./decisions.ts";
export { type ProviderStatus, defaultAgentModel, providerStatus } from "./chat-model.ts";
export type { AgentModel } from "../agent/model.ts";
export { PROVIDERS, type ProviderId, isProviderId } from "../agent/provider.ts";
export type { ConversationRow } from "../persistence/conversations.ts";
