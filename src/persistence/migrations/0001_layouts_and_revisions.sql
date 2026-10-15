-- docs/blueprint/02-layout-model.md#database. change_sets and later tables arrive with the
-- features that use them; revisions.change_set_id is a plain column until then and the
-- migration that creates change_sets rebuilds this table to add its foreign key.
CREATE TABLE layouts (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  name TEXT NOT NULL,
  head_revision_id TEXT NOT NULL REFERENCES revisions(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- A layout is referenced by ID or by name, so a name must identify one layout.
CREATE UNIQUE INDEX layouts_name ON layouts(name);

CREATE TABLE revisions (
  id TEXT PRIMARY KEY,
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  parent_id TEXT NULL REFERENCES revisions(id),
  document TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('import','editor','agent','undo')),
  change_set_id TEXT NULL,
  undoes_revision_id TEXT NULL REFERENCES revisions(id),
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX revisions_layout ON revisions(layout_id, created_at);
