ALTER TABLE "season_registrations"
ADD COLUMN "map_preferences" jsonb DEFAULT '[]'::jsonb NOT NULL;
