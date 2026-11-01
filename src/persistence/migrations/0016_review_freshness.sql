-- A review covers a particular contract and input snapshot, not just a layout revision.
ALTER TABLE board_reviews ADD COLUMN contract_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE board_reviews ADD COLUMN snapshot_key TEXT;
ALTER TABLE board_reviews ADD COLUMN invalidated_reason TEXT;
ALTER TABLE board_reviews ADD COLUMN ai_run_id TEXT;
CREATE TABLE review_proposals (
  change_set_id TEXT PRIMARY KEY REFERENCES change_sets(id) ON DELETE CASCADE,
  review_id TEXT NOT NULL REFERENCES board_reviews(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  behavior_evidence TEXT
);

-- Old model claims were not grounded by the current contract. Retain deterministic checks,
-- but withdraw the old recommendations without making a model call on upgrade.
-- Legacy runs did not link saved-but-unpublished patches. Conservatively retire all
-- standalone agent proposals; conversation and editor proposals are not affected.
UPDATE change_sets SET status = 'rejected', decided_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE status = 'proposed' AND
  ((source = 'agent' AND conversation_id IS NULL) OR id IN
  (SELECT proposal_id FROM review_items WHERE source = 'agent' AND proposal_id IS NOT NULL));
UPDATE board_reviews SET ai_status = 'failed', ai_reason = 'The review checks have changed. Run a fresh review to get current suggestions.',
  invalidated_reason = 'The review checks have changed. Run a fresh review.'
  WHERE ai_status IN ('running', 'done', 'failed') OR id IN (SELECT review_id FROM review_items WHERE source = 'agent');
DELETE FROM review_items WHERE source = 'agent';
