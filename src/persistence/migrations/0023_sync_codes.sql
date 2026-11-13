-- Codes a sync carries itself, so the page offers the fix without reading a sentence (R9-01, R9-10).
-- `instruction_code`: why the keyboard needs a hand, when a permission would let keyloom do it next time, such as
-- "permission_input_monitoring" (the Moonlander's restart). Kept with the instruction while the step is needs_hand.
-- `error_code`: a failure's code when the sync has no build or flash row to carry it, such as "flash_tool_missing" (the flash tool
-- isn't installed, found before a flash row exists). Null otherwise, and for syncs from before this column.
ALTER TABLE syncs ADD COLUMN instruction_code TEXT;
ALTER TABLE syncs ADD COLUMN error_code TEXT;
