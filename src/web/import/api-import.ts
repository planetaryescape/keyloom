import { BoardListResponseSchema, ImportResponseSchema, type BoardChoice, type ImportResponse } from "../../api/http.ts";
import { ApiError } from "../api.ts";
import { failure, request } from "../api-write.ts";
import type { ReviewActivity } from "../../api/review.ts";

export async function fetchBoards(token: string, signal: AbortSignal): Promise<BoardChoice[]> {
  return (await request("GET", "/api/boards", token, BoardListResponseSchema, signal)).boards;
}

// The file is the body (not a form field), so the browser sends it as it is and the server reads the bytes it was given.
export async function uploadLayout(token: string, boardId: string, file: File, activities: ReviewActivity[] = []): Promise<ImportResponse> {
  const query = new URLSearchParams({ board: boardId, filename: file.name });
  if (activities.length) query.set("activities", activities.join(","));
  let response: Response;
  try {
    response = await fetch(`/api/import?${query}`, {
      method: "POST",
      headers: { "x-keyloom-token": token, "content-type": "application/octet-stream" },
      body: file,
    });
  } catch {
    throw new ApiError(0, "Can't reach keyloom. Is it still running in your terminal?");
  }
  if (!response.ok) throw await failure(response);
  const parsed = ImportResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new ApiError(response.status, "keyloom imported the file but sent an answer this page can't read. Reload to see it.");
  return parsed.data;
}
