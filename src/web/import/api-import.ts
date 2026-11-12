import { BoardListResponseSchema, IMPORT_TOO_LARGE, ImportResponseSchema, type BoardChoice, type ImportResponse } from "../../api/http.ts";
import { KarabinerConfigResponseSchema } from "../../api/system.ts";
import { ApiError, UNREACHABLE } from "../api.ts";
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
    throw new ApiError(0, UNREACHABLE, { code: "unreachable" });
  }
  if (!response.ok) {
    const refused = await failure(response);
    // A file over the server's cap is refused by Bun with a bare 413 before the import route runs, so the page says the route's words.
    throw refused.code === "too_large" ? new ApiError(refused.status, IMPORT_TOO_LARGE, { code: "too_large" }) : refused;
  }
  const parsed = ImportResponseSchema.safeParse(await response.json());
  // The layout is saved: the card offers Reload by this code (R2-17), and takes no second drop, which would import it again.
  if (!parsed.success) throw new ApiError(response.status, "keyloom imported the file but sent an answer this page can't read. Reload the page to see it.", { code: IMPORTED_UNREADABLE });
  return parsed.data;
}

export const IMPORTED_UNREADABLE = "imported_unreadable";

/** Karabiner's settings from their fixed place on this Mac, as a file the import takes like a dropped one (R1-24). */
export async function readKarabinerConfig(token: string): Promise<File> {
  const read = await request("GET", "/api/system/karabiner-config", token, KarabinerConfigResponseSchema);
  return new File([read.content], read.filename, { type: "application/json" });
}
