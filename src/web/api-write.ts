// The browser side of the rung 2 routes (src/api/http.ts). Every call sends the session token
// and a JSON body, and turns an ApiErrorBody into an ApiError the UI can read.
import { z } from "zod";
import {
  ApiErrorBodySchema,
  ApplyResponseSchema,
  BuildSchema,
  CheckResponseSchema,
  FlashSchema,
  ParseBindingResponseSchema,
  UndoResponseSchema,
  UpgradeResponseSchema,
  type ApplyRequest,
  type ApplyResponse,
  type Build,
  type BuildRequest,
  type CheckRequest,
  type Flash,
  type ParseBindingRequest,
  type ParseBindingResponse,
  type UndoRequest,
  type UndoResponse,
  type UpgradeResponse,
} from "../api/http.ts";
import type { ValidationResult } from "../validation/result.ts";
import { ApiError, TOKEN_REJECTED, UNREACHABLE, unreadableError } from "./api.ts";
import { failureCode, failureWords } from "./shell/unexpected.ts";

export async function request<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
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
    throw new ApiError(0, UNREACHABLE, { code: "unreachable" });
  }
  if (!response.ok) throw await failure(response);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    console.error(`keyloom: unreadable response from ${path}`, parsed.error);
    throw unreadableError(response.status);
  }
  return parsed.data;
}

export async function failure(response: Response): Promise<ApiError> {
  if (response.status === 401) {
    return new ApiError(401, TOKEN_REJECTED, { code: "token" });
  }
  try {
    const parsed = ApiErrorBodySchema.safeParse(await response.json());
    if (parsed.success) {
      // A server exception or the catch-all for an unknown address gets the page's own words (R7-01); every other code, a route's own
      // `not_found` included, keeps the server's sentence.
      const { code, message, generic } = parsed.data.error;
      return new ApiError(response.status, failureWords(code, generic === true ? null : message), {
        code,
        ...(parsed.data.validation === undefined ? {} : { validation: parsed.data.validation }),
        ...(parsed.data.error.board === undefined ? {} : { board: parsed.data.error.board }),
        ...(parsed.data.error.boardName === undefined ? {} : { boardName: parsed.data.error.boardName }),
      });
    }
  } catch {
    // Not JSON: fall through to the code the status gives.
  }
  // No code from the server: the page gives one, so no screen shows a status number (R7-01).
  const code = failureCode(response.status, undefined);
  return new ApiError(response.status, failureWords(code, null), { code });
}

/**
 * Removes something the person asked to drop, such as a priority or a decision. One that is already gone (`not_found`: another tab or the
 * CLI removed it) counts as removed, so its row leaves the list instead of showing an error whose Try again fails the same way (D-534).
 */
export async function removeOrGone(remove: () => Promise<void>): Promise<void> {
  try {
    await remove();
  } catch (error) {
    if (!isGone(error)) throw error;
  }
}

/** keyloom no longer has the thing a request named (`not_found`), so the same request fails the same way on a repeat. */
export const isGone = (error: unknown): boolean => error instanceof ApiError && error.code === "not_found";

const layoutPath = (ref: string, action: string) => `/api/layouts/${encodeURIComponent(ref)}/${action}`;

export async function checkChange(
  token: string, ref: string, body: CheckRequest, signal: AbortSignal,
): Promise<ValidationResult> {
  return (await request("POST", layoutPath(ref, "check"), token, CheckResponseSchema, signal, body)).validation;
}

// Reads a QMK or ZMK expression the person typed; nothing is written.
export function parseBinding(token: string, ref: string, body: ParseBindingRequest, signal: AbortSignal): Promise<ParseBindingResponse> {
  return request("POST", layoutPath(ref, "parse-binding"), token, ParseBindingResponseSchema, signal, body);
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

const Opened = z.object({});

/** Tells keyloom the editor opened this layout, so the home wall hangs its board first next time (D-476). */
export async function markOpened(token: string, ref: string): Promise<void> {
  await request("POST", layoutPath(ref, "opened"), token, Opened, undefined, {});
}

export function upgradeStoredLayout(token: string, ref: string): Promise<UpgradeResponse> {
  return request("POST", layoutPath(ref, "upgrade"), token, UpgradeResponseSchema, undefined, {});
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
