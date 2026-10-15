import type {
  ApplyRequest, ApplyResponse, Build, BuildRequest, CheckRequest, Flash, UndoRequest, UndoResponse,
} from "../api/http.ts";
import type { ValidationResult } from "../validation/result.ts";

// The server's write interface (rung 2). Like LayoutSource, the CLI injects the app-backed
// implementation, so the server knows nothing about storage, Docker or Zapp.
export interface EditorBackend {
  check(ref: string, request: CheckRequest): Promise<ValidationResult>;
  apply(ref: string, request: ApplyRequest): Promise<ApplyResponse>;
  undo(ref: string, request: UndoRequest): Promise<UndoResponse>;
  startBuild(ref: string, request: BuildRequest): Promise<Build>;
  getBuild(id: string): Promise<Build | null>;
  startFlash(buildId: string): Promise<Flash>;
  getFlash(id: string): Promise<Flash | null>;
}

/** A failure the browser should see as-is: the status and code go into ApiErrorBody. */
export class EditorError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 503,
    readonly code: string,
    message: string,
    readonly validation?: ValidationResult,
  ) {
    super(message);
    this.name = "EditorError";
  }
}
