// The server's system interface over the app (rung 25). Starting Docker takes up to about two minutes, and a
// second click should join the attempt already running rather than launch a second engine.
import { readKarabinerConfig } from "../app/karabiner-config.ts";
import { dockerReadiness, fixColimaFiles, reasonWithHint, restartDocker, startDocker } from "../app/toolchain.ts";
import { type InstallDeps, installJobs } from "../app/tool-install.ts";
import type { DockerStartResponse } from "../api/system.ts";
import type { SystemBackend } from "../server/system-backend.ts";

// The page offers Restart for an engine keyloom can restart, so that engine's terminal hint is left out; any other keeps it (R3-04).
const response = (r: Awaited<ReturnType<typeof startDocker>>): DockerStartResponse => (r.ok ? { ok: true, version: r.version, engine: r.engine, waitedMs: r.waitedMs } : { ok: false, reason: r.restartEngine === undefined ? reasonWithHint(r) : r.reason, engine: r.engine });
// A restart that failed has already done what the hint says; the page offers the engine's guide and Check again instead.
const restartResponse = (r: Awaited<ReturnType<typeof restartDocker | typeof fixColimaFiles>>): DockerStartResponse => (r.ok ? response(r) : { ok: false, reason: r.reason, engine: r.engine, ...(r.code === undefined ? {} : { code: r.code }) });

/**
 * `restartBlocker` says why a forced restart can't run now (a build or flash would stop), or null; serve passes `engineRestartBlocker`.
 * Without one, a forced restart is refused, so no caller can stop a build by leaving it out.
 */
export function appSystemBackend(
  installDeps: InstallDeps = {},
  docker: { restart?: typeof restartDocker; start?: typeof startDocker; fixFiles?: typeof fixColimaFiles; restartBlocker?: () => string | null } = {},
): SystemBackend & { stopInstalls: () => Promise<void> } {
  let starting: Promise<DockerStartResponse> | null = null;
  let restarting: Promise<DockerStartResponse> | null = null;
  let forcing: Promise<DockerStartResponse> | null = null;
  let fixing: Promise<DockerStartResponse> | null = null;
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
      const blocked = docker.restartBlocker === undefined ? "keyloom can't tell whether a build is running here, so it didn't restart Docker." : docker.restartBlocker();
      if (blocked !== null) return { ok: false, reason: blocked, engine: null, code: "build_running" };
      forcing = (docker.restart ?? restartDocker)({ force: true }).then(restartResponse).finally(() => { forcing = null; });
      return forcing;
    },
    // Stopping the other copy of Colima ends whatever it runs, so this waits for builds and flashes like a forced restart (D-533).
    fixColimaFiles: async () => {
      if (fixing !== null) return fixing;
      const blocked = docker.restartBlocker === undefined ? "keyloom can't tell whether a build is running here, so it didn't change Colima." : docker.restartBlocker();
      if (blocked !== null) return { ok: false, reason: blocked, engine: null, code: "build_running" };
      fixing = (docker.fixFiles ?? fixColimaFiles)().then(restartResponse).finally(() => { fixing = null; });
      return fixing;
    },
  };
}
