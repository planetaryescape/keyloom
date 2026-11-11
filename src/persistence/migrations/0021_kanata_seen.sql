-- When keyloom last saw kanata running a config keyloom wrote (keyloom.kbd or safe.kbd) on this board (D-509). The exit-chord proof
-- is recorded only within a window after this, so a kanata that never started, or stopped long ago, can't stand in for the chord.
-- Null until keyloom has seen it; written only while the board is unproven.
ALTER TABLE board_sync ADD COLUMN kanata_seen_at INTEGER;
