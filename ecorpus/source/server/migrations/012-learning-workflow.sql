--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------
-- Private review correspondence never goes in downloadable scene files.
CREATE TABLE learning_reviews (
  scene_id BIGINT PRIMARY KEY REFERENCES scenes(scene_id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('draft','pending','changes','published')),
  revision INTEGER NOT NULL DEFAULT 1,
  message TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX learning_reviews_state ON learning_reviews(state, updated_at);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------
DO $$ BEGIN RAISE EXCEPTION 'Preserve review history; use the documented rollback procedure'; END $$;
