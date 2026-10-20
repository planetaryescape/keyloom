import type { BoardSync, LayoutUpdatedEvent, SyncNowResponse } from "../api/http.ts";
export type { LayoutUpdatedEvent };
import type { DetectedKeyboard } from "../api/detected-keyboards.ts";
import type { ReviewEvent } from "../api/review.ts";

// The server's keyboard sync interface (rung 13). Like the other backends, the CLI injects the app-backed
// implementation, so the server knows nothing about USB, builds or the database.
export interface SyncBackend {
  /** Every board that has a layout, with its state, from a fresh look at USB. */
  status(): Promise<BoardSync[]>;
  /** Sync now for a layout; returns as soon as the sync has started. */
  syncNow(layoutId: string): Promise<SyncNowResponse>;
  setAutoSync(boardId: string, enabled: boolean): Promise<BoardSync[]>;
  setPaused(boardId: string, paused: boolean): Promise<BoardSync[]>;
  /** "Disable remapping": loads the identity map on a software-remapper board, with no sudo (21). */
  disableRemapping(boardId: string): Promise<BoardSync[]>;
  /** Calls `listener` with every board's state, and the keyboards keyloom has no board for, whenever one changes; returns the unsubscribe. */
  subscribe(listener: (boards: BoardSync[], newKeyboards: DetectedKeyboard[]) => void): () => void;
  /** The keyboards on USB keyloom has no board for, as of the engine's last read (D-336). */
  newKeyboards(): DetectedKeyboard[];
  /** Calls `listener` whenever a board review is made or its agent part changes (D-340), so the events stream carries it beside the sync state. */
  subscribeReviews?(listener: (event: ReviewEvent) => void): () => void;
  /** Calls `listener` whenever a layout's head revision changes (e.g. via CLI write detected by data_version polling). */
  subscribeLayoutUpdated?(listener: (event: LayoutUpdatedEvent) => void): () => void;
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
