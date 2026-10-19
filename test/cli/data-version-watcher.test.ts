import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createDataVersionWatcher } from "../../src/cli/data-version-watcher.ts";
import type { LayoutUpdatedEvent } from "../../src/api/http.ts";

describe("createDataVersionWatcher", () => {
  test("polls PRAGMA data_version and emits layout.updated when another connection writes", async () => {
    const file = `/tmp/keyloom-data-version-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`;
    const db1 = new Database(file);
    db1.run("CREATE TABLE layouts (id TEXT PRIMARY KEY, head_revision_id TEXT);");
    db1.run("INSERT INTO layouts (id, head_revision_id) VALUES ('layout_1', 'rev_1');");

    const events: LayoutUpdatedEvent[] = [];
    const watcher = createDataVersionWatcher(db1, 20); // poll every 20ms for fast test
    const unsub = watcher.subscribe((e) => events.push(e));

    // Open connection 2 and modify layouts table
    const db2 = new Database(file);
    db2.run("UPDATE layouts SET head_revision_id = 'rev_2' WHERE id = 'layout_1';");

    // Wait for poll
    await new Promise((r) => setTimeout(r, 80));

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toEqual({ type: "layout.updated", layoutId: "layout_1", revisionId: "rev_2" });

    unsub();
    watcher.stop();
    db1.close();
    db2.close();
  });
});
