/** The build did not produce a usable binary; `message` is fit to show a person, and `code` names a cause the UI can act on. */
export class BuildFailure extends Error {
  override name = "BuildFailure";
  constructor(message: string, readonly code: BuildErrorCode | null = null) {
    super(message);
  }
}

/**
 * `docker_unavailable`: Docker is missing, unreachable or wouldn't start; the UI shows its Install or Start button (D-488).
 * `cancelled`: the person stopped the build (R3-10); the UI offers Build firmware again.
 */
export type BuildErrorCode = "docker_unavailable" | "cancelled";
