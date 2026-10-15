-- docs/blueprint/02-layout-model.md#database: change sets, and the foreign key from
-- revisions.change_set_id that 0001 left off because change_sets did not exist yet.
CREATE TABLE change_sets (
  id TEXT PRIMARY KEY,
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  base_revision_id TEXT NOT NULL REFERENCES revisions(id),
  proposal_group TEXT NULL,
  source TEXT NOT NULL CHECK (source IN ('editor','agent')),
  ops TEXT NOT NULL,
  explanation TEXT NOT NULL,
  tradeoffs TEXT NOT NULL,
  decision_draft TEXT NULL,
  validation TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed','applied','rejected','superseded')),
  -- A plain column: conversations arrive in rung 3, and that migration rebuilds this table to add
  -- REFERENCES conversations(id), the way this one rebuilds revisions.
  conversation_id TEXT NULL,
  created_at INTEGER NOT NULL,
  decided_at INTEGER NULL
);
CREATE INDEX change_sets_layout ON change_sets(layout_id, created_at);

-- SQLite cannot add a foreign key to an existing column, so rebuild the table (sqlite.org/lang_altertable.html,
-- "Making Other Kinds Of Table Schema Changes"). migrate() has foreign keys off while this runs and
-- checks them before it commits.
CREATE TABLE revisions_new (
  id TEXT PRIMARY KEY,
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  parent_id TEXT NULL REFERENCES revisions(id),
  document TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('import','editor','agent','undo')),
  change_set_id TEXT NULL REFERENCES change_sets(id),
  undoes_revision_id TEXT NULL REFERENCES revisions(id),
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO revisions_new (id, layout_id, parent_id, document, origin, change_set_id, undoes_revision_id, summary, created_at)
  SELECT id, layout_id, parent_id, document, origin, change_set_id, undoes_revision_id, summary, created_at FROM revisions;
DROP TABLE revisions;
ALTER TABLE revisions_new RENAME TO revisions;
CREATE INDEX revisions_layout ON revisions(layout_id, created_at);
