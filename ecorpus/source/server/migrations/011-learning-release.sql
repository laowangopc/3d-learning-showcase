--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------
CREATE TABLE learning_catalog (
  scene_id BIGINT PRIMARY KEY REFERENCES scenes(scene_id) ON DELETE CASCADE,
  metadata JSONB NOT NULL,
  generation BIGINT NOT NULL CHECK (generation > 0)
);
CREATE INDEX learning_catalog_kind ON learning_catalog ((metadata->>'kind'));
CREATE INDEX learning_catalog_category ON learning_catalog ((metadata->>'category'));

CREATE TABLE learning_events (
  event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  scene_id BIGINT REFERENCES scenes(scene_id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX learning_events_scene_time ON learning_events(scene_id, event_id DESC);

CREATE TABLE learning_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------
-- Audit history must not be silently discarded. Restore a verified pre-release
-- backup to an isolated instance before selecting an earlier application image.
DO $$ BEGIN RAISE EXCEPTION 'Use a verified pre-release database backup to downgrade'; END $$;
