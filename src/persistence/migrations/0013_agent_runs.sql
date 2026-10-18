CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL,
  layout_id TEXT NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  owner_token TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','waiting_user','completed','failed','cancelled','interrupted')),
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  outcome_json TEXT
);
CREATE UNIQUE INDEX agent_runs_foreground ON agent_runs(conversation_id) WHERE status = 'running';
CREATE TABLE agent_effects (
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  input_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY (run_id, operation_id)
);
