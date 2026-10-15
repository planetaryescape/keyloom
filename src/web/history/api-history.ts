import { RevisionListResponseSchema, type RevisionEntry } from "../../api/http.ts";
import { request } from "../api-write.ts";

export async function fetchRevisions(token: string, ref: string, signal: AbortSignal): Promise<RevisionEntry[]> {
  return (await request("GET", `/api/layouts/${encodeURIComponent(ref)}/revisions`, token, RevisionListResponseSchema, signal)).revisions;
}
