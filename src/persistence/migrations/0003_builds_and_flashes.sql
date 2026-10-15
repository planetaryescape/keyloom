-- docs/blueprint/02-layout-model.md#database. Builds and flashes belong to a revision; the
-- artifact and log paths are relative to the data directory, so moving it doesn't break them.
-- pid is the keyloom process that is running the build or flash, so another process can tell a
-- row that is still running from one whose process died.
CREATE TABLE builds (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES revisions(id),
  board_revision TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  artifact_path TEXT NULL,
  log_path TEXT NOT NULL,
  error TEXT NULL,
  pid INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NULL
);
CREATE INDEX builds_revision ON builds(revision_id, started_at);

CREATE TABLE flashes (
  id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL REFERENCES builds(id),
  status TEXT NOT NULL CHECK (status IN ('waiting_for_bootloader','writing','succeeded','failed')),
  error TEXT NULL,
  log_path TEXT NOT NULL,
  pid INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NULL
);
CREATE INDEX flashes_build ON flashes(build_id, started_at);
