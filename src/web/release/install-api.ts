// The browser side of the install routes (src/api/tool-install.ts) and a build's firmware file (D-488 to D-490).
import { z } from "zod";
import { type InstallState, type InstallableTool, InstallStateSchema } from "../../api/tool-install.ts";
import { failure, request } from "../api-write.ts";
import { ApiError } from "../api.ts";

export function startInstall(token: string, tool: InstallableTool): Promise<InstallState> {
  return request("POST", "/api/system/install", token, InstallStateSchema, undefined, { tool });
}

export function fetchInstall(token: string, tool: InstallableTool, signal?: AbortSignal): Promise<InstallState> {
  return request("GET", `/api/system/install?tool=${encodeURIComponent(tool)}`, token, InstallStateSchema, signal);
}

/** Saves a build's firmware file through the browser: the route needs the token header, so a plain link can't fetch it. */
export async function downloadArtifact(token: string, buildId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/builds/${encodeURIComponent(buildId)}/artifact`, { headers: { "x-keyloom-token": token } });
  } catch {
    throw new ApiError(0, "Can't reach keyloom, so the file couldn't be downloaded.");
  }
  if (!response.ok) throw await failure(response);
  const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? `keyloom-${buildId}.bin`;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function revealArtifact(token: string, buildId: string): Promise<unknown> {
  return request("POST", `/api/builds/${encodeURIComponent(buildId)}/reveal`, token, z.object({}), undefined, {});
}
