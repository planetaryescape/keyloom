// What the server needs from the computer it runs on (src/api/system.ts lists the routes). The adapter that
// fills this in is src/cli/system-backend.ts, so the server itself never looks for Docker.
import type { DockerPruneResponse, DockerReadinessResponse, DockerRestartLogResponse, DockerStartResponse } from "../api/system.ts";
import type { KarabinerConfig } from "../app/karabiner-config.ts";
import type { InstallState, InstallableTool } from "../api/tool-install.ts";

export interface SystemBackend {
  /** The daemon's state, and what would fix it. */
  docker: () => Promise<DockerReadinessResponse>;
  /** Starts the engine and waits for it. Repeated calls share one attempt. */
  startDocker: () => Promise<DockerStartResponse>;
  /**
   * Starts installing a tool and returns at once; a second call joins the install already running (D-488, D-489). `via: "download"` gets
   * Zapp's pinned release even where Homebrew is, after a failed Homebrew install (R12-01).
   */
  install: (tool: InstallableTool, via?: "download") => Promise<InstallState>;
  /** Where an install of the tool has got to. */
  installState: (tool: InstallableTool) => Promise<InstallState>;
  /** Karabiner-Elements' config from its fixed place, for the MacBook's import card. Absent where the server can't read it. */
  karabinerConfig?: () => Promise<KarabinerConfig>;
  /** Stops a running install of the tool (R2-08); returns where it has got to. */
  cancelInstall: (tool: InstallableTool) => Promise<InstallState>;
  /**
   * Quits and reopens the Mac app that runs Docker, for a socket it refuses this account (R2-07). Repeated calls share one attempt.
   * `force` restarts an engine that answers, for a build that failed on its state (R6-09); it is refused while a build or flash runs.
   */
  restartDocker: (opts?: { force?: boolean }) => Promise<DockerStartResponse>;
  /** The forced restart's progress lines, for the build log tail (R7-04). Absent where the server doesn't keep them. */
  restartLog?: () => Promise<DockerRestartLogResponse>;
  /**
   * Fix Colima's files (D-533): the administrator password dialog, then root gives ~/.colima back, and Colima stops and starts as this
   * account. Refused while a build or flash runs; repeated calls share one attempt.
   */
  fixColimaFiles: () => Promise<DockerStartResponse>;
  /**
   * Frees Docker's build cache, for a build that ran out of disk (R8-04). Refused while a build, flash or container run is under way, and
   * while keyloom starts, restarts or fixes the engine; repeated calls share one attempt. Absent where the server can't.
   */
  pruneBuildCache?: () => Promise<DockerPruneResponse>;
}
