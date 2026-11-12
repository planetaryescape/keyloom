// The server's system interface over the app (rung 25). Starting Docker takes up to about two minutes, and a
// second click should join the attempt already running rather than launch a second engine.
import { readKarabinerConfig } from "../app/karabiner-config.ts";
import { FORCED_RESTART_UNGUARDED, dockerReadiness, engineActionNow, reasonWithHint, restartDocker, startDocker } from "../app/toolchain.ts";
import { type InstallDeps, installJobs } from "../app/tool-install.ts";
import type { DockerStartResponse } from "../api/system.ts";
import type { SystemBackend } from "../server/system-backend.ts";

// How many of a forced restart's progress lines the page's log tail gets (R7-04).
const RESTART_LOG_LINES = 30;

// The page offers Restart for an engine keyloom can restart, so that engine's terminal hint is left out; any other keeps it (R3-04).
const response = (r: Awaited<ReturnType<typeof startDocker>>): DockerStartResponse => (r.ok ? { ok: true, version: r.version, engine: r.engine, waitedMs: r.waitedMs } : { ok: false, reason: r.restartEngine === undefined ? reasonWithHint(r) : r.reason, engine: r.engine });
// A restart that failed has already done what the hint says; the page offers the engine's guide and Check again instead.
const restartResponse = (r: Awaited<ReturnType<typeof restartDocker>>): DockerStartResponse => (r.ok ? response(r) : { ok: false, reason: r.reason, engine: r.engine, ...(r.code === undefined ? {} : { code: r.code }) });

/**
 * `restartBlocker` says why a forced restart can't run now (a build, flash or container run would stop), or null; serve passes
 * `engineRestartBlocker`. The restart asks it inside the engine lock, right before the stop. Without one, a forced restart is refused, so
 * no caller can stop a build by leaving it out.
 */
export function appSystemBackend(
  installDeps: InstallDeps = {},
  docker: {
    restart?: typeof restartDocker; start?: typeof startDocker; restartBlocker?: () => string | null;
    /** What a forced restart waits for, named for the person; serve passes `engineRestartWork` (R7-04). */
    restartWork?: () => string[];
  } = {},
): SystemBackend & { stopInstalls: () => Promise<void> } {
  let starting: Promise<DockerStartResponse> | null = null;
  let restarting: Promise<DockerStartResponse> | null = null;
  let forcing: Promise<DockerStartResponse> | null = null;
  // The forced restart's progress, for the page's build log tail (R7-04): this restart's lines, kept after it ends until the next one.
  let forcedLines: string[] = [];
  // A start or restart holding the engine refuses a forced restart as engine_busy, so it is waited for like the work the blocker names.
  const waitingFor = (): string[] => {
    const action = engineActionNow();
    return [...(action === null ? [] : [action === "start" ? "a Docker start" : "a Docker restart"]), ...(docker.restartWork?.() ?? [])];
  };
  const installs = installJobs(installDeps);
  return {
    docker: () => dockerReadiness(),
    startDocker: () => {
      starting ??= (docker.start ?? startDocker)().then(response).finally(() => { starting = null; });
      return starting;
    },
    install: async (tool) => installs.start(tool),
    stopInstalls: () => installs.cancelAll(),
    installState: async (tool) => installs.get(tool),
    karabinerConfig: () => readKarabinerConfig(),
    cancelInstall: async (tool) => installs.cancel(tool),
    restartDocker: async (opts = {}) => {
      if (opts.force !== true) {
        restarting ??= (docker.restart ?? restartDocker)().then(restartResponse).finally(() => { restarting = null; });
        return restarting;
      }
      if (forcing !== null) return forcing;
      const blocker = docker.restartBlocker;
      if (blocker === undefined) return { ok: false, reason: FORCED_RESTART_UNGUARDED, engine: null, code: "build_running" };
      let started = false;
      const onProgress = (line: string) => {
        // A refused restart prints nothing, so the last restart's lines stay until this one says something.
        forcedLines = [...(started ? forcedLines : []), line].slice(-RESTART_LOG_LINES);
        started = true;
      };
      forcing = (docker.restart ?? restartDocker)({ force: true, blocker, onProgress }).then(restartResponse).finally(() => { forcing = null; });
      return forcing;
    },
    // Without `restartWork` the server names only an engine action. The restart's own check still refuses, and a refusal with nothing
    // named to wait for shows its reason and button on the page instead of a wait (R7-04).
    restartLog: async () => ({ running: forcing !== null, lines: forcedLines, waitingFor: forcing !== null ? [] : waitingFor() }),
  };
}
