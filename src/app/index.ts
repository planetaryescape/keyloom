// The only module src/cli (and src/server) may import (01#modules).
export { type App, closeApp, openApp } from "./context.ts";
export { NotFoundError, StaleBaseError, UsageError, ValidationFailedError } from "./errors.ts";
export {
  type ApplyOutcome, type ChangeSetView, applyChange, applyOps, checkChange, listChanges, proposeChange, rejectChange, showChange, undo,
} from "./changes.ts";
export { type ImportInput, type ImportOutcome, type LayoutView, getLayout, importLayout, listLayouts } from "./layouts.ts";
export { type Board, type CheckResult, checkBoard, listBoardDefinitions, regenerateGeometry, showBoard } from "./boards.ts";
export { renderLayoutText, renderPositionGrid, selectLayers } from "./render.ts";
export { type DoctorCheck, runDoctor, runToolchainChecks } from "./doctor.ts";
export {
  type BuildOptions, type BuildView, type FlashOptions, type FlashView, type GenerateOutcome, buildAndWait, flashAndWait, generateFirmware,
  getBuild, getFlash, startBuild, startFlash,
} from "./firmware.ts";
export { BuildFailedError, FlashFailedError } from "./firmware-errors.ts";
export type { ImportReport } from "../firmware/qmk/import.ts";
export type { Layout } from "../layout/schema.ts";
export { type ChangeOp, ChangeOpSchema } from "../layout/change.ts";
export { describeBinding } from "../layout/functions.ts";
export { type ValidationResult, ValidationResultSchema } from "../validation/result.ts";
export type { ChangeSetSource, ChangeSetStatus } from "../persistence/change-sets.ts";
export type { LayoutRow, RevisionRow } from "../persistence/layouts.ts";
export { logsDir } from "../persistence/paths.ts";
