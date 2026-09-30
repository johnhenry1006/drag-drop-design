CREATE TABLE sample_seed_state (
  sample_page_id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('present', 'absent', 'deleted')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
