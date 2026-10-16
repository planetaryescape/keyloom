-- docs/blueprint/27-board-review.md (D-340). A review is what keyloom found in one revision of a config: the checks' findings at once,
-- the agent's after. One per revision, so a revision is never reviewed twice.
CREATE TABLE board_reviews (
  id TEXT PRIMARY KEY,
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  revision_id TEXT NOT NULL REFERENCES revisions(id),
  trigger TEXT NOT NULL CHECK (trigger IN ('connect', 'apply', 'import', 'manual')),
  checked_at INTEGER NOT NULL,
  -- {layers, keys, combos}: what the checks looked at.
  summary TEXT NOT NULL,
  ai_status TEXT NOT NULL CHECK (ai_status IN ('pending', 'running', 'done', 'unavailable', 'failed')),
  -- In words, for BK: why the agent's part is missing or failed.
  ai_reason TEXT NULL,
  ai_model TEXT NULL,
  -- When a run claimed it, so a run that died with the process can be told from one that is still going.
  ai_started_at INTEGER NULL,
  -- The review of the revision before, and the items it had that this revision no longer produces (JSON array of items).
  previous_review_id TEXT NULL REFERENCES board_reviews(id),
  fixed TEXT NOT NULL DEFAULT '[]',
  UNIQUE (layout_id, revision_id)
);
CREATE INDEX board_reviews_layout ON board_reviews(layout_id, checked_at);

CREATE TABLE review_items (
  review_id TEXT NOT NULL REFERENCES board_reviews(id),
  -- The stable id (code, layers and keys), not a row id: the same finding has the same id in every review.
  id TEXT NOT NULL,
  position INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('check', 'agent')),
  kind TEXT NOT NULL CHECK (kind IN ('problem', 'hint', 'suggestion')),
  severity TEXT NOT NULL CHECK (severity IN ('error', 'warning', 'info')),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  keys TEXT NOT NULL,
  layers TEXT NOT NULL,
  proposal_id TEXT NULL REFERENCES change_sets(id),
  fixes TEXT NOT NULL,
  PRIMARY KEY (review_id, id)
);

-- Hiding a finding is about the finding, not the revision: keyed by the stable id, so it follows the finding to later revisions.
CREATE TABLE review_dismissals (
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  item_id TEXT NOT NULL,
  dismissed_at INTEGER NOT NULL,
  PRIMARY KEY (layout_id, item_id)
);
