import type {
  ApplyRequest, ApplyResponse, BoardChoice, Build, BuildRequest, FittingRevisionResponse, FlashCheckResponse, ImportResponse, LayoutExportDocument, RevisionEntry, CheckRequest, Flash, ParseBindingRequest, ParseBindingResponse, UndoRequest, UndoResponse, UpgradeResponse,
} from "../api/http.ts";
import type { ValidationResult } from "../validation/result.ts";
import type { ReviewActivity } from "../api/review.ts";

// The server's write interface (rung 2). Like LayoutSource, the CLI injects the app-backed
// implementation, so the server knows nothing about storage, Docker or Zapp.
export interface EditorBackend {
  check(ref: string, request: CheckRequest): Promise<ValidationResult>;
  /** Reads a firmware expression typed in the editor's Any field; it writes nothing. */
  parseBinding(ref: string, request: ParseBindingRequest): Promise<ParseBindingResponse>;
  apply(ref: string, request: ApplyRequest): Promise<ApplyResponse>;
  /** Applies a stored proposal by id, re-validating it against the head. */
  applyChangeSet(changeSetId: string): Promise<ApplyResponse>;
  undo(ref: string, request: UndoRequest): Promise<UndoResponse>;
  /** Reads the Oryx colours and tap dances a stored layout still holds as code into the model: one revision, only when asked (D-193). */
  upgrade(ref: string): Promise<UpgradeResponse>;
  /** The layout's revisions, newest first. */
  revisions(ref: string): Promise<RevisionEntry[]>;
  /** The layout as the portable document `keyloom layout export` writes; the head unless a revision is named. */
  exportLayout(ref: string, revisionId?: string): Promise<LayoutExportDocument>;
  /** Records that the editor opened the layout, for the home wall's order (D-476). */
  markOpened(ref: string): Promise<void>;
  /** The boards keyloom can import a layout for. */
  boards(): Promise<BoardChoice[]>;
  /** Imports an uploaded export (a .zip or a .keymap); the same use case as `keyloom import`. */
  importUpload(request: { board: string; filename: string; bytes: Uint8Array; name?: string | undefined; reviewActivities?: ReviewActivity[] }): Promise<ImportResponse>;
  startBuild(ref: string, request: BuildRequest): Promise<Build>;
  getBuild(id: string): Promise<Build | null>;
  startFlash(buildId: string): Promise<Flash>;
  getFlash(id: string): Promise<Flash | null>;
  /** A successful build's firmware file, for a board keyloom can't flash (D-490); null when there is none. */
  buildArtifact(id: string): Promise<{ path: string; filename: string } | null>;
  /** Shows a build's firmware file in Finder (D-490). */
  revealBuild(id: string): Promise<void>;
  /** Stops a flash still waiting for the bootloader, before any write (D-501). Optional: a backend without it answers 404. */
  cancelFlash?(id: string): Promise<Flash>;
  /** Stops a running build and answers once it has stopped (R3-10). A build never flashes. Optional: a backend without it answers 404. */
  cancelBuild?(id: string): Promise<Build>;
  /** Reads what the keyboard runs now, for a flash keyloom couldn't confirm. Never builds or flashes (D-501). */
  checkFlash?(id: string): Promise<FlashCheckResponse>;
  /** The newest earlier revision whose layers fit the board, for a layout the editor can't draw (D-502). */
  fittingRevision?(ref: string): Promise<FittingRevisionResponse["revision"]>;
}

/** A failure the browser should see as-is: the status and code go into ApiErrorBody. */
export class EditorError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 413 | 503,
    readonly code: string,
    message: string,
    readonly validation?: ValidationResult,
    /** The board the refusal names (R6-18). */
    readonly board?: string,
  ) {
    super(message);
    this.name = "EditorError";
  }
}
