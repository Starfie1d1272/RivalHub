ALTER TABLE seasons ADD COLUMN registration_deadline timestamptz;

CREATE TABLE registration_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  email text NOT NULL,
  payload json NOT NULL DEFAULT '{}'::json,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(season_id, email)
);
