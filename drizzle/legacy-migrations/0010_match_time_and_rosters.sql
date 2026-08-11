CREATE TABLE match_time_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id),
  proposed_by uuid NOT NULL REFERENCES users(id),
  force_assigned_by uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending',
  proposed_time timestamptz NOT NULL,
  response_at timestamptz,
  reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE match_rosters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id),
  team_id uuid NOT NULL REFERENCES teams(id),
  submitted_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'submitted',
  locked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(match_id, team_id)
);

CREATE TABLE match_roster_players (
  roster_id uuid NOT NULL REFERENCES match_rosters(id) ON DELETE CASCADE,
  team_member_id uuid NOT NULL REFERENCES team_members(id),
  is_starter boolean NOT NULL DEFAULT true,
  UNIQUE(roster_id, team_member_id)
);
