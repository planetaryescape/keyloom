-- docs/blueprint/19-model-providers.md (D-111). A conversation is pinned to the provider and model
-- that started it. Every conversation before this was answered by Anthropic's API, the only provider
-- there was, so existing rows default to 'anthropic'. Their model is left NULL: it was whatever the
-- default was at the time, and the pin then falls back to the provider's default model.
ALTER TABLE conversations ADD COLUMN provider TEXT NOT NULL DEFAULT 'anthropic' CHECK (provider IN ('anthropic','openrouter','codex'));
ALTER TABLE conversations ADD COLUMN model TEXT NULL;
