CREATE TABLE review_workload_profiles (
  layout_id TEXT PRIMARY KEY REFERENCES layouts(id) ON DELETE CASCADE,
  activities TEXT NOT NULL
);
CREATE TABLE review_workloads (
  review_id TEXT PRIMARY KEY REFERENCES board_reviews(id) ON DELETE CASCADE,
  evidence TEXT NOT NULL
);
