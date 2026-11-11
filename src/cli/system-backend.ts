// The server's system interface over the app (rung 25). Starting Docker takes up to about two minutes, and a
// second click should join the attempt already running rather than launch a second engine.
import { dockerReadiness, restartDocker, startDocker } from "../app/toolchain.ts";
import { type InstallDeps, installJobs } from "../app/tool-install.ts";
import type { DockerStartResponse } from "../api/system.ts";
import type { SystemBackend } from "../server/system-backend.ts";

const response = (r: Awaited<ReturnType<typeof startDocker>>): DockerStartResponse => (r.ok ? { ok: true, version: r.version, engine: r.engine, waitedMs: r.waitedMs } : { ok: false, reason: r.reason, engine: r.engine });

export function appSystemBackend(installDeps: InstallDeps = {}, docker: { restart?: typeof restartDocker } = {}): SystemBackend {
  let starting: Promise<DockerStartResponse> | null = null;
  let restarting: Promise<DockerStartResponse> | null = null;
  const installs = installJobs(installDeps);
  return {
    docker: () => dockerReadiness(),
    startDocker: () => {
      starting ??= startDocker().then(response).finally(() => { starting = null; });
      return starting;
    },
    install: async (tool) => installs.start(tool),
    installState: async (tool) => installs.get(tool),
    cancelInstall: async (tool) => installs.cancel(tool),
    restartDocker: () => {
      restarting ??= (docker.restart ?? restartDocker)().then(response).finally(() => { restarting = null; });
      return restarting;
    },
  };
}
