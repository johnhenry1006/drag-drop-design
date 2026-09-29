ALTER TABLE projects ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version >= 1);

CREATE TABLE IF NOT EXISTS asset_object_deletions (
  id bigserial PRIMARY KEY,
  object_bucket text NOT NULL,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (object_bucket, object_key)
);
