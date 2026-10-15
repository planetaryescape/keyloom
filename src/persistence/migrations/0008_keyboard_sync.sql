-- docs/blueprint/17-keyboard-sync.md (D-160 to D-169). One row per sync of a layout's head revision to a keyboard,
-- and one row per board for what BK chose about auto-sync.
--
-- board_sync.auto_sync is NULL until BK chooses: auto-sync then follows the proof (on once one flash has gone through
-- the hands-free path and been verified, Q16). 0 and 1 are his choice. paused is separate so that "off" and
-- "paused for now" stay different things in the header.
CREATE TABLE board_sync (
  board_id TEXT PRIMARY KEY,
  auto_sync INTEGER NULL CHECK (auto_sync IN (0, 1)),
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  proven_at INTEGER NULL,
  proven_build_id TEXT NULL
);

-- owner is the engine instance that is running the sync, so a restarted engine can tell its own rows from ones a
-- stopped engine left behind even when the process ID was reused. failure names why a sync did not finish, which
-- decides whether the same revision is tried again by itself (see src/app/sync-state.ts).
CREATE TABLE syncs (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  revision_id TEXT NOT NULL REFERENCES revisions(id),
  board_revision TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('auto', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('building', 'flashing', 'succeeded', 'failed', 'cancelled')),
  step TEXT NOT NULL,
  instruction TEXT NULL,
  failure TEXT NULL,
  error TEXT NULL,
  build_id TEXT NULL REFERENCES builds(id),
  flash_id TEXT NULL REFERENCES flashes(id),
  log_path TEXT NOT NULL,
  pid INTEGER NOT NULL,
  owner TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  built_at INTEGER NULL,
  flash_started_at INTEGER NULL,
  finished_at INTEGER NULL
);
CREATE INDEX syncs_board ON syncs(board_id, started_at);
CREATE INDEX syncs_active ON syncs(status);
