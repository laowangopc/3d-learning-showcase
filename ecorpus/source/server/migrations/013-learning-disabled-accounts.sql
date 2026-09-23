--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------
-- UserRoles already defines NONE=0; the original schema excluded it.
ALTER TABLE users DROP CONSTRAINT users_level_check;
ALTER TABLE users ADD CONSTRAINT users_level_check CHECK (0 <= level AND level <= 4);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------
DO $$ BEGIN RAISE EXCEPTION 'Do not reactivate disabled accounts by downgrading the schema'; END $$;
