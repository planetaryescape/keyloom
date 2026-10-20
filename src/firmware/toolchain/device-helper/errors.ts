export type HelperFailureCode = "helper_unavailable" | "version_mismatch" | "integrity_error" | "unsafe_cache" | "protocol_error" | "timeout" | "helper_exited";

export class HelperFailure extends Error {
  constructor(readonly code: HelperFailureCode) {
    super(code);
    this.name = "HelperFailure";
  }
}
