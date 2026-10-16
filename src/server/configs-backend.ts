import type { CompareResponse, NewConfigRequest, ApiConfig, VersionHistoryResponse } from "../api/configs.ts";
import type { SyncNowResponse } from "../api/http.ts";
import type { ValidationResult } from "../validation/result.ts";

// The server's configs and versions interface (rung 23, 25). Like the other backends, the CLI injects the app-backed
// implementation, so the server knows nothing about storage or the sync engine.
export interface ConfigsBackend {
  list(opts: { board?: string; includeArchived: boolean }): Promise<ApiConfig[]>;
  create(request: NewConfigRequest): Promise<ApiConfig>;
  rename(ref: string, name: string): Promise<ApiConfig>;
  archive(ref: string): Promise<ApiConfig>;
  restore(ref: string): Promise<ApiConfig>;
  remove(ref: string, name: string): Promise<void>;
  /** Makes the config the one on its board's keyboard and starts one sync; returns as soon as it has started. */
  use(ref: string): Promise<SyncNowResponse>;
  versions(ref: string): Promise<VersionHistoryResponse>;
  nameVersion(ref: string, target: string, name: string): Promise<VersionHistoryResponse["versions"][number]["version"] | null>;
  /** A new revision holding the version's document (D-170). */
  restoreVersion(ref: string, target: string): Promise<{ revisionId: string; restoredRevisionId: string }>;
  compare(ref: string, target: string): Promise<CompareResponse>;
}

/** A failure the browser should see as-is. `validation` is set when a rule refused a restore. */
export class ConfigsError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422,
    readonly code: string,
    message: string,
    readonly validation?: ValidationResult,
  ) {
    super(message);
    this.name = "ConfigsError";
  }
}
