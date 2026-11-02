-- When each config was last opened in the editor, for the home wall's most-recent boards (D-476). Null until it is opened once.
ALTER TABLE layouts ADD COLUMN opened_at INTEGER;
