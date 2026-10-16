-- docs/blueprint/24-typing-lab.md (D-280). One row per recorded stretch of typing BK started himself. It stays in this database and
-- is deleted with `keyloom lab delete`; the trace and the typed text never go to a model provider. `events` is the physical trace
-- (position, press or release, milliseconds), `typed_text` what the computer received while it was recorded, and `analysis` the
-- findings of the last analysis, or NULL before one has run.
CREATE TABLE typing_sessions (
  id TEXT PRIMARY KEY,
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  revision_id TEXT NOT NULL REFERENCES revisions(id),
  board_id TEXT NOT NULL,
  board_revision TEXT NULL,
  firmware TEXT NOT NULL CHECK (firmware IN ('qmk', 'zmk')),
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  passage_id TEXT NOT NULL,
  passage TEXT NOT NULL,
  typed_text TEXT NOT NULL,
  events TEXT NOT NULL,
  warnings TEXT NOT NULL,
  analysis TEXT NULL,
  analysed_at INTEGER NULL
);
CREATE INDEX typing_sessions_layout ON typing_sessions(layout_id, started_at);
