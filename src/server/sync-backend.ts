import type { BoardSync, SyncNowResponse } from "../api/http.ts";

// The server's keyboard sync interface (rung 13). Like the other backends, the CLI injects the app-backed
// implementation, so the server knows nothing about USB, builds or the database.
export interface SyncBackend {
  /** Every board that has a layout, with its state, from a fresh look at USB. */
  status(): Promise<BoardSync[]>;
  /** Sync now for a layout; returns as soon as the sync has started. */
  syncNow(layoutId: string): Promise<SyncNowResponse>;
  setAutoSync(boardId: string, enabled: boolean): Promise<BoardSync[]>;
  setPaused(boardId: string, paused: boolean): Promise<BoardSync[]>;
  /** Calls `listener` with every board's state whenever one changes; returns the unsubscribe. */
  subscribe(listener: (boards: BoardSync[]) => void): () => void;
}

/** A failure the browser should see as-is. */
export class SyncError extends Error {
  constructor(
    readonly status: 400 | 404,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SyncError";
  }
}
