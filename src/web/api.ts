import type { z } from "zod";
import { BoardDevViewSchema, type BoardDevView } from "../boards/dev.ts";
import type { ValidationResult } from "../validation/result.ts";
import {
  ApiErrorBodySchema,
  LayoutDetailSchema,
  LayoutListResponseSchema,
  type LayoutDetail,
  type LayoutSummary,
} from "../api/http.ts";
import { UNREADABLE_WORDS, failureCode, failureWords } from "./shell/unexpected.ts";

export class ApiError extends Error {
  readonly status: number;
  /** The server's ApiErrorBody code, such as "stale_base"; absent for transport failures and reads. */
  readonly code: string | undefined;
  /** Present when a change was refused for validation errors, so the editor can point at the slots. */
  readonly validation: ValidationResult | undefined;
  /** The keyboard the refusal names, for the button that fixes it (R6-07, R6-18). */
  readonly board: string | undefined;
  /** keyloom's own name for `board`, when the server sends it. */
  readonly boardName: string | undefined;

  constructor(status: number, message: string, detail: { code?: string; validation?: ValidationResult; board?: string; boardName?: string } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = detail.code;
    this.validation = detail.validation;
    this.board = detail.board;
    this.boardName = detail.boardName;
  }
}

/** An answer this page can't read: keyloom and the page are different versions, so the answer is the same until a restart (R7-09). */
export const unreadableError = (status: number): ApiError => new ApiError(status, UNREADABLE_WORDS, { code: "unreadable" });

/** A request that never reached keyloom (D-494). The page reconnects by itself, so the sentence names no terminal. */
export const UNREACHABLE = "keyloom stopped answering. This page reconnects by itself when it is back.";
/** keyloom answered 401: it restarted with a new link, so this page's token is no longer its. */
export const TOKEN_REJECTED = "keyloom restarted, so this page's link no longer works. Open keyloom again from its app, or open the new link it printed.";

// The token lives in memory only: it's read from the launch URL and passed to each request.
export function tokenFromSearch(search: string): string | null {
  return new URLSearchParams(search).get("t") || null;
}

async function getJson<T>(
  path: string,
  token: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { "x-keyloom-token": token }, signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError(0, UNREACHABLE, { code: "unreachable" });
  }
  // Codes, not the server's words, so the page offers the way out that fits (R1-08).
  if (response.status === 401) throw new ApiError(401, TOKEN_REJECTED, { code: "token" });
  if (response.status === 404) throw new ApiError(404, "keyloom has no layout here. It was deleted, or the link is old.", { code: "not_found" });
  if (!response.ok) {
    const body = ApiErrorBodySchema.safeParse(await response.json().catch(() => null));
    const code = failureCode(response.status, body.success ? body.data.error.code : undefined);
    throw new ApiError(response.status, failureWords(code, body.success && body.data.error.generic !== true ? body.data.error.message : null), { code });
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    // The detail is for whoever is debugging; the page gets a sentence it can show.
    console.error(`keyloom: unreadable response from ${path}`, parsed.error);
    throw unreadableError(response.status);
  }
  return parsed.data;
}

export async function fetchLayouts(token: string, signal: AbortSignal): Promise<LayoutSummary[]> {
  const body = await getJson("/api/layouts", token, LayoutListResponseSchema, signal);
  return body.layouts;
}

export function fetchLayout(token: string, ref: string, signal: AbortSignal): Promise<LayoutDetail> {
  return getJson(`/api/layouts/${encodeURIComponent(ref)}`, token, LayoutDetailSchema, signal);
}

export function fetchBoardDev(token: string, signal: AbortSignal): Promise<BoardDevView> {
  return getJson("/api/board-dev", token, BoardDevViewSchema, signal);
}
