-- docs/blueprint/08-decision-memory.md. Two things a decision's lifecycle needs beyond 0005.
-- status_before: the status a decision had before supersession or an undo took it out of play, so
-- reversing that (undo of the change that superseded it, or redo of the one that was undone) puts it
-- back as it was. NULL for a decision BK retired himself, which nothing restores.
-- outcome_asked_at: when keyloom asked "has this worked out?" and BK answered or dismissed the
-- question, so each hypothesis is asked about once (Q6).
ALTER TABLE decisions ADD COLUMN status_before TEXT NULL;
ALTER TABLE decisions ADD COLUMN outcome_asked_at INTEGER NULL;
