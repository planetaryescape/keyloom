-- Removal is a reversible collection choice, independent of configs and installed firmware.
CREATE TABLE keyboard_collection (
  board_id TEXT PRIMARY KEY,
  removed_at INTEGER
);
