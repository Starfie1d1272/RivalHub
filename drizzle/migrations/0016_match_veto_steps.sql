CREATE TABLE match_veto_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id),
  step_order integer NOT NULL,
  action_type text NOT NULL,
  map_name text NOT NULL,
  team_id uuid REFERENCES teams(id),
  side text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(match_id, step_order)
);
