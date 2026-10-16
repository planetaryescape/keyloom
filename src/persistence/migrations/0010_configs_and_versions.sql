-- docs/blueprint/25-configs-and-versions.md (D-300, D-301). A config is a layout; this adds which one is on each
-- keyboard, the archive and copy links, and the versions (revisions that went onto a keyboard).
--
-- copied_from_* are plain columns, not foreign keys: deleting the config a copy came from must not be blocked by the copy.
ALTER TABLE layouts ADD COLUMN archived_at INTEGER NULL;
ALTER TABLE layouts ADD COLUMN copied_from_layout_id TEXT NULL;
ALTER TABLE layouts ADD COLUMN copied_from_revision_id TEXT NULL;

-- One row per board: the config the sync engine keeps on that keyboard. Only this config auto-syncs (D-300).
CREATE TABLE board_config (
  board_id TEXT PRIMARY KEY,
  layout_id TEXT NOT NULL REFERENCES layouts(id)
);

-- Migration keeps what the engine did before: it tracked the layout its keyboard's running build came from, else the newest edited.
-- The last verified sync is the stored form of "the running build", so that layout wins; a board never synced gets its newest layout
-- (the highest ID on a tie, as the engine sorted).
INSERT INTO board_config (board_id, layout_id)
SELECT l.board_id, COALESCE(
  (SELECT s.layout_id FROM syncs s JOIN layouts sl ON sl.id = s.layout_id
    WHERE s.board_id = l.board_id AND sl.board_id = l.board_id AND s.status = 'succeeded'
    ORDER BY s.finished_at DESC, s.id DESC LIMIT 1),
  (SELECT n.id FROM layouts n WHERE n.board_id = l.board_id ORDER BY n.updated_at DESC, n.id DESC LIMIT 1))
FROM layouts l GROUP BY l.board_id;

-- A version is a revision that went onto a keyboard (put_on_at set when a sync verified), or a revision BK named without flashing
-- it (put_on_at NULL). One row per revision: a revision put on again moves put_on_at forward and reopens ended_at.
CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  revision_id TEXT NOT NULL REFERENCES revisions(id),
  board_id TEXT NOT NULL,
  name TEXT NULL,
  put_on_at INTEGER NULL,
  ended_at INTEGER NULL,
  sync_id TEXT NULL REFERENCES syncs(id),
  created_at INTEGER NOT NULL,
  UNIQUE (layout_id, revision_id)
);
CREATE INDEX versions_board ON versions(board_id, put_on_at);

-- Past verified syncs become versions, so history is not empty on first run. A stay ends at the next verified sync of something else.
INSERT INTO versions (id, layout_id, revision_id, board_id, put_on_at, ended_at, sync_id, created_at)
SELECT 'ver_' || substr(s.id, 5), s.layout_id, s.revision_id, s.board_id, s.finished_at,
  (SELECT MIN(n.finished_at) FROM syncs n
    WHERE n.board_id = s.board_id AND n.status = 'succeeded' AND n.finished_at > s.finished_at
      AND NOT (n.layout_id = s.layout_id AND n.revision_id = s.revision_id)),
  s.id, s.finished_at
FROM syncs s
WHERE s.status = 'succeeded' AND s.finished_at IS NOT NULL
  AND s.id = (SELECT x.id FROM syncs x WHERE x.board_id = s.board_id AND x.layout_id = s.layout_id AND x.revision_id = s.revision_id AND x.status = 'succeeded'
              ORDER BY x.finished_at DESC, x.id DESC LIMIT 1);
