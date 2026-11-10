// What the server needs from the computer it runs on (src/api/system.ts lists the routes). The adapter that
// fills this in is src/cli/system-backend.ts, so the server itself never looks for Docker.
import type { DockerReadinessResponse, DockerStartResponse } from "../api/system.ts";

export interface SystemBackend {
  /** The daemon's state, and what would fix it. */
  docker: () => Promise<DockerReadinessResponse>;
  /** Starts the engine and waits for it. Repeated calls share one attempt. */
  startDocker: () => Promise<DockerStartResponse>;
}
