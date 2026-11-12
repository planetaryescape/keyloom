// The browser side of the system routes (src/api/system.ts): whether the Docker a build needs is up, and starting it.
import { DockerReadinessResponseSchema, DockerStartResponseSchema, type DockerReadinessResponse, type DockerStartResponse } from "../api/system.ts";
import { ApiError } from "./api.ts";
import { request } from "./api-write.ts";

const DOCKER_PATH = "/api/system/docker";

/** Null when this server has no system routes: an older server, or the dev editor over a fake backend. */
export async function fetchDockerReadiness(token: string, signal?: AbortSignal): Promise<DockerReadinessResponse | null> {
  let readiness: DockerReadinessResponse;
  try {
    readiness = await request("GET", DOCKER_PATH, token, DockerReadinessResponseSchema, signal);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
  return readiness;
}

/** Starts the engine and waits for it; the server answers within about two minutes. */
export function startDockerEngine(token: string, signal?: AbortSignal): Promise<DockerStartResponse> {
  return request("POST", `${DOCKER_PATH}/start`, token, DockerStartResponseSchema, signal, {});
}

/**
 * Quits and reopens the Mac app that runs Docker, for a socket it refuses this account (R2-07); answers like a start. `force` restarts an
 * engine that answers, for a build that failed with `stale_mount` or `stuck_container` (R6-09).
 */
export function restartDockerApp(token: string, signal?: AbortSignal, force = false): Promise<DockerStartResponse> {
  return request("POST", `${DOCKER_PATH}/restart`, token, DockerStartResponseSchema, signal, force ? { force: true } : {});
}

/** Fix Colima's files (D-533): the server asks macOS for the password, gives ~/.colima back and starts Colima; answers like a start. */
export function fixColimaFiles(token: string, signal?: AbortSignal): Promise<DockerStartResponse> {
  return request("POST", `${DOCKER_PATH}/fix-colima-files`, token, DockerStartResponseSchema, signal, {});
}
