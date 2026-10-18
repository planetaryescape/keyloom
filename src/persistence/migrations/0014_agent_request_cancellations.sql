CREATE TABLE agent_request_cancellations (
  request_id TEXT PRIMARY KEY CHECK(length(request_id) BETWEEN 1 AND 128),
  created_at INTEGER NOT NULL
);
