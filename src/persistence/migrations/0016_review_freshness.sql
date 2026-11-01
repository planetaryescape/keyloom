-- A review covers a particular contract and input snapshot, not just a layout revision.
ALTER TABLE board_reviews ADD COLUMN contract_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE board_reviews ADD COLUMN snapshot_key TEXT;
ALTER TABLE board_reviews ADD COLUMN invalidated_reason TEXT;
ALTER TABLE board_reviews ADD COLUMN ai_run_id TEXT;
CREATE TABLE review_proposals (
  change_set_id TEXT PRIMARY KEY REFERENCES change_sets(id),
  review_id TEXT NOT NULL REFERENCES board_reviews(id),
  run_id TEXT NOT NULL,
  behavior_evidence TEXT
);

-- Old model claims were not grounded by the current contract. Retain deterministic checks,
-- but withdraw the old recommendations without making a model call on upgrade.
UPDATE change_sets SET status = 'rejected', decided_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE status = 'proposed' AND id IN
  (SELECT proposal_id FROM review_items WHERE source = 'agent' AND proposal_id IS NOT NULL);
DELETE FROM review_items WHERE source = 'agent';
UPDATE board_reviews SET ai_status = 'failed', ai_reason = 'The review checks have changed. Run a fresh review to get current suggestions.',
  invalidated_reason = 'The review checks have changed. Run a fresh review.';
