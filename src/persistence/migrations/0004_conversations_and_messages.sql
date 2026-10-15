-- docs/blueprint/02-layout-model.md#database. Conversations belong to a layout; a message holds
-- the Anthropic content blocks exactly as sent and received, so a conversation resumes append-only.
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX conversations_layout ON conversations(layout_id, created_at);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  selection TEXT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_conv ON messages(conversation_id, created_at, id);

-- change_sets.conversation_id has been a plain column since 0002, waiting for this table. SQLite
-- cannot add a foreign key in place, so rebuild it the way 0002 rebuilt revisions (migrate() has
-- foreign keys off and checks them before commit). The rebuild also adds the title a proposal
-- card shows ("Plain Option on the symbol layer").
CREATE TABLE change_sets_new (
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
  conversation_id TEXT NULL REFERENCES conversations(id),
  created_at INTEGER NOT NULL,
  decided_at INTEGER NULL,
  title TEXT NULL
);
INSERT INTO change_sets_new (id, layout_id, base_revision_id, proposal_group, source, ops, explanation, tradeoffs, decision_draft, validation, status, conversation_id, created_at, decided_at)
  SELECT id, layout_id, base_revision_id, proposal_group, source, ops, explanation, tradeoffs, decision_draft, validation, status, conversation_id, created_at, decided_at FROM change_sets;
DROP TABLE change_sets;
ALTER TABLE change_sets_new RENAME TO change_sets;
CREATE INDEX change_sets_layout ON change_sets(layout_id, created_at);
CREATE INDEX change_sets_conversation ON change_sets(conversation_id, created_at);
