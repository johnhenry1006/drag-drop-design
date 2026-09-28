CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pages (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  document jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pages_project_id_idx ON pages(project_id);

CREATE TABLE IF NOT EXISTS page_revisions (
  page_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision >= 1),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, revision)
);

CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename text NOT NULL,
  media_type text NOT NULL,
  byte_length integer NOT NULL CHECK (byte_length > 0),
  sha256 text NOT NULL,
  contents bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_project_id_idx ON assets(project_id);
