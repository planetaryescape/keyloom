-- docs/blueprint/08-decision-memory.md. The whole table is created now, though only kind
-- 'priority' is written until choice decisions arrive, so that later rungs add rows and no
-- migration. Nothing else is rebuilt, so existing rows and foreign keys are untouched.
CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  kind TEXT NOT NULL CHECK (kind IN ('choice','priority')),
  priority_kind TEXT NULL CHECK (priority_kind IN ('pinned','rarely_used','frequent','willing_to_relearn')),
  subject TEXT NOT NULL,
  goal TEXT NOT NULL,
  choice TEXT NOT NULL,
  reason TEXT NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('hypothesis','tried_helpful','tried_unhelpful','superseded','retired')),
  outcome_note TEXT NULL,
  change_set_id TEXT NULL REFERENCES change_sets(id),
  conversation_id TEXT NULL REFERENCES conversations(id),
  source_message_ids TEXT NOT NULL,
  superseded_by TEXT NULL REFERENCES decisions(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX decisions_layout ON decisions(layout_id, status);
