// The server's system interface over the app (rung 25). Starting Docker takes up to about two minutes, and a
// second click should join the attempt already running rather than launch a second engine.
import { dockerReadiness, startDocker } from "../app/toolchain.ts";
import type { DockerStartResponse } from "../api/system.ts";
import type { SystemBackend } from "../server/system-backend.ts";

export function appSystemBackend(): SystemBackend {
  let starting: Promise<DockerStartResponse> | null = null;
  return {
    docker: () => dockerReadiness(),
    startDocker: () => {
      starting ??= startDocker()
        .then((r) => (r.ok ? { ok: true as const, version: r.version, engine: r.engine, waitedMs: r.waitedMs } : { ok: false as const, reason: r.reason, engine: r.engine }))
        .finally(() => { starting = null; });
      return starting;
    },
  };
}
