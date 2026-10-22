export type HelperFailureCode = "helper_unavailable" | "version_mismatch" | "integrity_error" | "unsafe_cache" | "protocol_error" | "timeout" | "helper_exited";

export class HelperFailure extends Error {
  /** `detail` says which check refused, for doctor and logs; callers match on `code`. */
  constructor(readonly code: HelperFailureCode, readonly detail?: string) {
    super(code);
    this.name = "HelperFailure";
  }
}
