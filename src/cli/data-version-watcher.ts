// Polls SQLite's PRAGMA data_version (blueprint 01#server-and-transport) once a second.
// When another connection (such as a CLI `change apply`) writes to the database,
// data_version changes, and we emit a `layout.updated` event for each layout whose head revision moved.
import type { Database } from "bun:sqlite";
import type { LayoutUpdatedEvent } from "../server/sync-backend.ts";

export interface DataVersionWatcher {
  subscribe(listener: (event: LayoutUpdatedEvent) => void): () => void;
  stop(): void;
}

export function createDataVersionWatcher(db: Database, pollMs = 1000): DataVersionWatcher {
  const listeners = new Set<(event: LayoutUpdatedEvent) => void>();
  let stopped = false;

  const getVersion = (): number => {
    try {
      const row = db.query("PRAGMA data_version").get() as { data_version: number } | null;
      return row?.data_version ?? 0;
    } catch {
      return 0;
    }
  };

  const getHeads = (): Map<string, string> => {
    try {
      const rows = db.query("SELECT id, head_revision_id FROM layouts").all() as Array<{ id: string; head_revision_id: string }>;
      return new Map(rows.map((r) => [r.id, r.head_revision_id]));
    } catch {
      return new Map();
    }
  };

  let lastVersion = getVersion();
  let lastHeads = getHeads();

  const timer = setInterval(() => {
    if (stopped) return;
    try {
      const currentVersion = getVersion();
      if (currentVersion === lastVersion) return;
      lastVersion = currentVersion;

      const currentHeads = getHeads();
      for (const [id, rev] of currentHeads.entries()) {
        if (lastHeads.get(id) !== rev) {
          const event: LayoutUpdatedEvent = { type: "layout.updated", layoutId: id, revisionId: rev };
          for (const listener of listeners) listener(event);
        }
      }
      lastHeads = currentHeads;
    } catch {
      // database busy or closed
    }
  }, pollMs);

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      listeners.clear();
    },
  };
}
