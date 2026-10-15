import type { z } from "zod";
import type { ValidationResult } from "../validation/result.ts";
import {
  LayoutDetailSchema,
  LayoutListResponseSchema,
  type LayoutDetail,
  type LayoutSummary,
} from "../api/http.ts";

export class ApiError extends Error {
  readonly status: number;
  /** The server's ApiErrorBody code, such as "stale_base"; absent for transport failures and reads. */
  readonly code: string | undefined;
  /** Present when a change was refused for validation errors, so the editor can point at the slots. */
  readonly validation: ValidationResult | undefined;

  constructor(status: number, message: string, detail: { code?: string; validation?: ValidationResult } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = detail.code;
    this.validation = detail.validation;
  }
}

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
  const response = await fetch(path, { headers: { "x-keyloom-token": token }, signal });
  if (!response.ok) {
    throw new ApiError(response.status, `keyloom server returned ${response.status} for ${path}`);
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    // The detail is for whoever is debugging; the page gets a sentence it can show.
    console.error(`keyloom: unreadable response from ${path}`, parsed.error);
    throw new Error("keyloom sent a layout this page can't read. Restart keyloom and reload.");
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
