CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS projects_owner_id_idx ON projects(owner_id);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS object_key text;
ALTER TABLE assets ALTER COLUMN contents DROP NOT NULL;
ALTER TABLE assets ADD CONSTRAINT assets_have_bytes CHECK (contents IS NOT NULL OR object_key IS NOT NULL);
