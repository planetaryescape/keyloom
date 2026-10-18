CREATE TABLE chat_presentations (
  user_message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  payload TEXT NOT NULL CHECK (length(CAST(payload AS BLOB)) <= 65536)
);
CREATE INDEX chat_presentations_conversation ON chat_presentations(conversation_id, user_message_id);
