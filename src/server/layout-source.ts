import type { BoardDefinition, Geometry } from "../boards/schema.ts";
import type { Layout } from "../layout/schema.ts";
import type { LayoutSummary, RevisionInfo } from "../api/http.ts";

// The server reads layouts through this interface. The CLI injects the storage-backed
// implementation; the server knows nothing about where layouts live.
export interface LayoutSource {
  list(): Promise<LayoutSummary[]>;
  get(ref: string): Promise<{ revision: RevisionInfo; document: Layout; board: BoardDefinition; geometry: Geometry; upgrade?: { colours: boolean; tapDances: boolean } | null } | null>;
}
