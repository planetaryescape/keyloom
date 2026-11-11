-- Why a build failed, as a code the UI maps to an action (D-488): "docker_unavailable" renders the Docker callout with
-- its Install or Start button instead of the sentence. Null for builds that succeeded or failed for any other reason.
ALTER TABLE builds ADD COLUMN error_code TEXT;
