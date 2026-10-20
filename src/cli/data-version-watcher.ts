// Polls SQLite's PRAGMA data_version (blueprint 01#server-and-transport) once a second.
// data_version sees other connections; total_changes sees this server's own writes. Subscribers also
// receive the current heads on connection, so a reconnect recovers any events missed while offline.
import type { Database } from "bun:sqlite";
import type { LayoutUpdatedEvent } from "../server/sync-backend.ts";

export interface DataVersionWatcher {
  subscribe(listener: (event: LayoutUpdatedEvent) => void): () => void;
  stop(): void;
}

export function createDataVersionWatcher(db: Database, pollMs = 1000): DataVersionWatcher {
  const listeners = new Set<(event: LayoutUpdatedEvent) => void>();
  let stopped = false;

  // SAFETY: SQLite defines both PRAGMA data_version and total_changes() as one integer row.
  const getVersion = (): number => (db.query("PRAGMA data_version").get() as { data_version: number }).data_version;
  // SAFETY: SELECT total_changes() always returns exactly the named integer column.
  const getChanges = (): number => (db.query("SELECT total_changes() AS n").get() as { n: number }).n;

  const getHeads = (): Map<string, string> => {
    // SAFETY: migrations define both selected layouts columns as non-null text.
    const rows = db.query("SELECT id, head_revision_id FROM layouts").all() as Array<{ id: string; head_revision_id: string }>;
    return new Map(rows.map((r) => [r.id, r.head_revision_id]));
  };

  let lastVersion = getVersion();
  let lastChanges = getChanges();
  let lastHeads = getHeads();

  const send = (listener: (event: LayoutUpdatedEvent) => void, layoutId: string, revisionId: string) => {
    try {
      listener({ type: "layout.updated", layoutId, revisionId });
    } catch {
      // One closed subscriber must not prevent the others from seeing a committed head.
    }
  };

  const timer = setInterval(() => {
    if (stopped) return;
    try {
      const currentVersion = getVersion();
      const currentChanges = getChanges();
      if (currentVersion === lastVersion && currentChanges === lastChanges) return;

      const currentHeads = getHeads();
      for (const [id, rev] of currentHeads.entries()) {
        if (lastHeads.get(id) !== rev) {
          for (const listener of listeners) send(listener, id, rev);
        }
      }
      // Only advance the cursor after a successful read; a busy DB is retried at the next poll.
      lastVersion = currentVersion;
      lastChanges = currentChanges;
      lastHeads = currentHeads;
    } catch {
      // database busy or closed
    }
  }, pollMs);
  timer.unref();

  return {
    subscribe(listener) {
      if (stopped) return () => {};
      listeners.add(listener);
      for (const [id, rev] of getHeads()) send(listener, id, rev);
      return () => listeners.delete(listener);
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      listeners.clear();
    },
  };
}
