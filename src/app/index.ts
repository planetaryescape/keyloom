// The only module src/cli (and src/server) may import (01#modules).
export { type App, closeApp, openApp } from "./context.ts";
export { drainDeviceConsumers, shutdownDeviceConnections } from "./device-connections.ts";
export { BusyError, LabCaptureError, ModelError, NotFoundError, StaleBaseError, UsageError, ValidationFailedError } from "./errors.ts";
export {
  type ApplyOutcome, type ChangeSetView, applyChange, applyOps, checkChange, editorDraft, listChanges, openProposalsOutsideChat, proposeChange, rejectChange, showChange, undo,
} from "./changes.ts";
export { type ParsedBinding, parseBindingExpression } from "./binding-expression.ts";
export {
  type ExportOutcome, type ImportInput, type ImportOutcome, type LayoutView, exportLayout, getLayout, importLayout, layoutExportDocument, listLayouts,
} from "./layouts.ts";
export {
  type LayoutExportDocument, type LayoutExportProbe, LAYOUT_EXPORT_KIND, LAYOUT_EXPORT_SCHEMA_VERSION, LayoutExportDocumentSchema, buildLayoutExportDocument, probeLayoutExport,
} from "../layout/export-document.ts";
export { type UploadInput, importUpload } from "./import-upload.ts";
export { listRevisions } from "./history.ts";
export {
  type ConfigView, type ListConfigsOptions, type NewConfigInput, archiveConfig, blankDocument, deleteConfig, listConfigs, newBlankConfig, newConfig, newConfigFromImport, newConfigFromUpload, type NewBlankOutcome, renameConfig, restoreConfig, showConfig,
} from "./configs.ts";
export {
  type CompareView, type KeyChange, type RevisionBrief, type VersionHistory, type VersionMilestone, type VersionView, compareRevision, nameVersion, resolveRevision,
  restoreVersion, versionHistory,
} from "./versions.ts";
export { type Board, type CheckResult, boardDevView, checkBoard, listBoardDefinitions, loadUserBoards, regenerateGeometry, showBoard } from "./boards.ts";
export type { GeometryOptions } from "../boards/geometry.ts";
export { type AddDeps, type AddInput, type AddOutcome, type KeyboardPreview, type PreviewBoard, addKeyboard, previewKeyboard } from "./keyboard-add.ts";
export { type CandidateView, type DetectedKeyboard, type KeyboardDeps, detectKeyboards, findCandidate, searchKeyboards } from "./keyboard-detect.ts";
export { type PutInput, type PutOutcome, type PutPreview, type PutProposal, previewPut, putConfig } from "./keyboard-put.ts";
export { renderLayoutText, renderPositionGrid, selectLayers } from "./render.ts";
export { type CredentialOverrides, type DoctorCheck, runCredentialChecks, runDeviceHelperCheck, runDoctor, runKeyboardChecks, runRemapperChecks, runToolchainChecks } from "./doctor.ts";
export {
  type RemapperOverrides, applyToRemapper, confirmExitChord, disableRemapperFor, readRemapper, remapperDoctor, setupRemapper,
} from "./remapper.ts";
export { type HandsFreeDeps, type HandsFreeOverrides, type RebootOutcome, rebootKeyboard } from "./keyboard.ts";
export {
  type BuildOptions, type BuildView, type FlashOptions, type FlashView, type GenerateOutcome, buildAndWait, flashAndWait, generateFirmware,
  drainManualFlashTasks, getBuild, getFlash, startBuild, startFlash,
} from "./firmware.ts";
export {
  type AutoSyncReport, type BoardSyncView, type RunSyncOptions, type SyncDeps, type SyncEngine, type SyncOptions, type SyncOutcome, type SyncSetup, type SyncState,
  autoSyncStatus, createSyncEngine, pauseAutoSync, runSync, runUseConfig, setAutoSync, syncStatus,
} from "./sync.ts";
export { BuildFailedError, EmulateFailedError, FlashFailedError, RebootFailedError, ToolchainUnavailableError } from "./firmware-errors.ts";
export { type AgentConfig, CONFIG_FILE, readAgentConfig, writeAgentConfig } from "./agent-config.ts";
export { type EmulateOptions, type EmulateOutcome, emulateLayout } from "./emulate.ts";
export { SCRIPT_HELP } from "../firmware/emulate/script.ts";
export type { ImportReport } from "../layout/import-report.ts";
export type { Layout } from "../layout/schema.ts";
export { type ChangeOp, ChangeOpSchema } from "../layout/change.ts";
export { describeBinding } from "../layout/functions.ts";
export { type ValidationResult, ValidationResultSchema } from "../validation/result.ts";
export type { ChangeSetSource, ChangeSetStatus } from "../persistence/change-sets.ts";
export type { LayoutRow, RevisionRow } from "../persistence/layouts.ts";
export { dataDir, logsDir } from "../persistence/paths.ts";
export {
  type ChatEvent, type ChatOutcome, type ConversationView, type DisplayMessage, type PriorityCard, type ProposalCard, type SendMessageInput,
  listConversationSummaries, sendMessage, showConversation,
} from "./conversations.ts";
export {
  type DecisionRow, type DecisionStatus, type OutcomeQuestion, type OutcomeStatus, dismissOutcome, editDecision, listDecisions, outcomeQuestions,
  recordOutcome, recordPriority, retireDecision, retirePriority, showDecision,
} from "./decisions.ts";
export {
  type AiStatus, type BoardReview, type FixedItem, type ReviewEvent, type ReviewItem, type ReviewTrigger, type ReviewView, dismissReviewItem, restoreReviewItem, reviewWords, showReview,
} from "./review.ts";
export { ReviewEngine, type ReviewOptions } from "./review-engine.ts";
export { type ProviderStatus, chooseNextProvider, defaultAgentModel, providerStatus } from "./chat-model.ts";
export type { AgentModel } from "../agent/model.ts";
export { PROVIDERS, type ProviderId, isProviderId } from "../agent/provider.ts";
export type { ConversationRow } from "../persistence/conversations.ts";
export { type BackfillOutcome, backfillLayerRefs } from "./layer-ref-backfill.ts";
export { type ConditionalBackfillOutcome, backfillConditionalLayers } from "./conditional-layer-backfill.ts";
export { type UpgradeOffer, type UpgradeOutcome, upgradeLayout, upgradeOffer } from "./upgrade.ts";
export {
  type AnalyseOptions, type LabDeps, type PassageView, type RecordingInProgress, type StoredAnalysis, analyseSession, beginRecording, deleteSession,
  endRecording, labPassages, realLabDeps, incompleteRecording, sessionAnalysis, sessionContent, sessions as labSessions, labReadout, cannotRecord, fingersLead, type LabReadout,
} from "./lab.ts";
