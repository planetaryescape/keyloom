// What the server needs from the computer it runs on (src/api/system.ts lists the routes). The adapter that
// fills this in is src/cli/system-backend.ts, so the server itself never looks for Docker.
import type { DockerReadinessResponse, DockerStartResponse } from "../api/system.ts";
import type { KarabinerConfig } from "../app/karabiner-config.ts";
import type { InstallState, InstallableTool } from "../api/tool-install.ts";

export interface SystemBackend {
  /** The daemon's state, and what would fix it. */
  docker: () => Promise<DockerReadinessResponse>;
  /** Starts the engine and waits for it. Repeated calls share one attempt. */
  startDocker: () => Promise<DockerStartResponse>;
  /** Starts installing a tool and returns at once; a second call joins the install already running (D-488, D-489). */
  install: (tool: InstallableTool) => Promise<InstallState>;
  /** Where an install of the tool has got to. */
  installState: (tool: InstallableTool) => Promise<InstallState>;
  /** Karabiner-Elements' config from its fixed place, for the MacBook's import card. Absent where the server can't read it. */
  karabinerConfig?: () => Promise<KarabinerConfig>;
}
