// The browser side of the rung 2 routes (src/api/http.ts). Every call sends the session token
// and a JSON body, and turns an ApiErrorBody into an ApiError the UI can read.
import type { z } from "zod";
import {
  ApiErrorBodySchema,
  ApplyResponseSchema,
  BuildSchema,
  CheckResponseSchema,
  FlashSchema,
  UndoResponseSchema,
  type ApplyRequest,
  type ApplyResponse,
  type Build,
  type BuildRequest,
  type CheckRequest,
  type Flash,
  type UndoRequest,
  type UndoResponse,
} from "../api/http.ts";
import type { ValidationResult } from "../validation/result.ts";
import { ApiError } from "./api.ts";

export async function request<T>(
  method: "GET" | "POST",
  path: string,
  token: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        "x-keyloom-token": token,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, "Can't reach keyloom. Is it still running in your terminal?");
  }
  if (!response.ok) throw await failure(response);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    console.error(`keyloom: unreadable response from ${path}`, parsed.error);
    throw new ApiError(response.status, "keyloom sent an answer this page can't read. Restart keyloom and reload.");
  }
  return parsed.data;
}

export async function failure(response: Response): Promise<ApiError> {
  if (response.status === 401) {
    return new ApiError(401, "keyloom rejected this page's token. Open the link keyloom printed again.");
  }
  try {
    const parsed = ApiErrorBodySchema.safeParse(await response.json());
    if (parsed.success) {
      return new ApiError(response.status, parsed.data.error.message, {
        code: parsed.data.error.code,
        ...(parsed.data.validation === undefined ? {} : { validation: parsed.data.validation }),
      });
    }
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return new ApiError(response.status, `keyloom answered ${response.status}.`);
}

const layoutPath = (ref: string, action: string) => `/api/layouts/${encodeURIComponent(ref)}/${action}`;

export async function checkChange(
  token: string, ref: string, body: CheckRequest, signal: AbortSignal,
): Promise<ValidationResult> {
  return (await request("POST", layoutPath(ref, "check"), token, CheckResponseSchema, signal, body)).validation;
}

export function applyChange(token: string, ref: string, body: ApplyRequest): Promise<ApplyResponse> {
  return request("POST", layoutPath(ref, "apply"), token, ApplyResponseSchema, undefined, body);
}

// Applies a proposal the agent stored. The server re-validates it against the head, so a stale one is a 409 stale_base.
export function applyChangeSet(token: string, changeSetId: string): Promise<ApplyResponse> {
  return request("POST", `/api/change-sets/${encodeURIComponent(changeSetId)}/apply`, token, ApplyResponseSchema, undefined, {});
}

export function undoChange(token: string, ref: string, body: UndoRequest): Promise<UndoResponse> {
  return request("POST", layoutPath(ref, "undo"), token, UndoResponseSchema, undefined, body);
}

export function startBuild(token: string, ref: string, revisionId: string, boardRevision?: string): Promise<Build> {
  const body: BuildRequest = { revisionId, ...(boardRevision === undefined ? {} : { boardRevision }) };
  return request("POST", layoutPath(ref, "builds"), token, BuildSchema, undefined, body);
}

export function fetchBuild(token: string, id: string, signal: AbortSignal): Promise<Build> {
  return request("GET", `/api/builds/${encodeURIComponent(id)}`, token, BuildSchema, signal);
}

export function startFlash(token: string, buildId: string): Promise<Flash> {
  return request("POST", `/api/builds/${encodeURIComponent(buildId)}/flashes`, token, FlashSchema, undefined, {});
}

export function fetchFlash(token: string, id: string, signal: AbortSignal): Promise<Flash> {
  return request("GET", `/api/flashes/${encodeURIComponent(id)}`, token, FlashSchema, signal);
}
