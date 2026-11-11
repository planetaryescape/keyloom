-- Why a flash failed, as a code the UI maps to an action (D-501): "permission_files_and_folders" and
-- "permission_input_monitoring" open the matching System Settings pane, "cancelled" offers the flash again. Null for
-- flashes that succeeded or failed for any other reason.
ALTER TABLE flashes ADD COLUMN error_code TEXT;
