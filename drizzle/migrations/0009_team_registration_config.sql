-- Rename team_size to max_team_size (preserve existing data)
ALTER TABLE seasons RENAME COLUMN team_size TO max_team_size;

-- Add min_team_size (minimum players per team)
ALTER TABLE seasons ADD COLUMN min_team_size integer NOT NULL DEFAULT 5;

-- Add team_registration_config (flexible team registration settings)
ALTER TABLE seasons ADD COLUMN team_registration_config json NOT NULL DEFAULT '{}'::json;
