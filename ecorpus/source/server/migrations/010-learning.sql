--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------
ALTER TABLE scenes DROP CONSTRAINT scene_type_values;
ALTER TABLE scenes ADD CONSTRAINT scene_type_values CHECK (scene_type IN ('voyager', 'html', 'panorama'));

CREATE OR REPLACE FUNCTION set_scene_type() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM current_files WHERE fk_scene_id = NEW.fk_scene_id AND name = 'panorama.json') THEN
    UPDATE scenes SET scene_type = 'panorama' WHERE scene_id = NEW.fk_scene_id;
  ELSIF EXISTS (SELECT 1 FROM current_files WHERE fk_scene_id = NEW.fk_scene_id AND name = 'scene.svx.json') THEN
    UPDATE scenes SET scene_type = 'voyager' WHERE scene_id = NEW.fk_scene_id;
  ELSIF EXISTS (SELECT 1 FROM current_files WHERE fk_scene_id = NEW.fk_scene_id AND name = 'index.html') THEN
    UPDATE scenes SET scene_type = 'html' WHERE scene_id = NEW.fk_scene_id;
  END IF;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER update_scene_type_on_file_update ON files;
CREATE CONSTRAINT TRIGGER update_scene_type_on_file_update
AFTER INSERT ON files DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (NEW.name IN ('scene.svx.json', 'index.html', 'panorama.json')) EXECUTE FUNCTION set_scene_type();

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------
-- A downgrade with panorama resources would lose type information. Restore the
-- pre-upgrade database backup instead of silently rewriting existing records.
DO $$ BEGIN RAISE EXCEPTION 'Restore the pre-learning database backup to downgrade safely'; END $$;
