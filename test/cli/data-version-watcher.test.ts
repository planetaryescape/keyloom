import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { createDataVersionWatcher } from "../../src/cli/data-version-watcher.ts";
import type { LayoutUpdatedEvent } from "../../src/api/http.ts";
import { tempDir } from "../helpers/tmp.ts";

async function fixture(run: (db: Database, other: Database, watcher: ReturnType<typeof createDataVersionWatcher>) => Promise<void>) {
  const file = join(tempDir(), "watcher.sqlite");
  const db = new Database(file);
  db.run("CREATE TABLE layouts (id TEXT PRIMARY KEY, head_revision_id TEXT NOT NULL)");
  db.run("INSERT INTO layouts VALUES ('lay_1', 'rev_1')");
  const other = new Database(file);
  const watcher = createDataVersionWatcher(db, 5);
  try {
    await run(db, other, watcher);
  } finally {
    watcher.stop();
    other.close();
    db.close();
  }
}

function updated(watcher: ReturnType<typeof createDataVersionWatcher>, revisionId: string): Promise<LayoutUpdatedEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error(`no update for ${revisionId}`)); }, 2000);
    const unsubscribe = watcher.subscribe((event) => {
      if (event.revisionId === revisionId) {
        clearTimeout(timer);
        resolve(event);
      }
    });
  });
}

describe("layout head watcher", () => {
  test("a separate CLI connection's committed write is published", async () => {
    await fixture(async (_db, other, watcher) => {
      const next = updated(watcher, "rev_2");
      other.run("UPDATE layouts SET head_revision_id = 'rev_2'");
      expect(await next).toEqual({ type: "layout.updated", layoutId: "lay_1", revisionId: "rev_2" });
    });
  });

  test("writes made through the server's own connection also reach other tabs", async () => {
    await fixture(async (db, _other, watcher) => {
      const next = updated(watcher, "rev_2");
      db.run("UPDATE layouts SET head_revision_id = 'rev_2'");
      expect((await next).revisionId).toBe("rev_2");
    });
  });

  test("reconnection snapshots recover writes made while no subscriber was listening", async () => {
    await fixture(async (_db, other, watcher) => {
      other.run("UPDATE layouts SET head_revision_id = 'rev_offline'");
      const seen: LayoutUpdatedEvent[] = [];
      const unsubscribe = watcher.subscribe((event) => seen.push(event));
      expect(seen).toEqual([{ type: "layout.updated", layoutId: "lay_1", revisionId: "rev_offline" }]);
      unsubscribe();
    });
  });

  test("one broken listener does not hide updates from another; stopping unsubscribes all", async () => {
    await fixture(async (_db, other, watcher) => {
      watcher.subscribe(() => { throw new Error("closed subscriber"); });
      const next = updated(watcher, "rev_2");
      other.run("UPDATE layouts SET head_revision_id = 'rev_2'");
      await next;
      watcher.stop();
      const seen: LayoutUpdatedEvent[] = [];
      watcher.subscribe((event) => seen.push(event));
      expect(seen).toEqual([]);
    });
  });
});
