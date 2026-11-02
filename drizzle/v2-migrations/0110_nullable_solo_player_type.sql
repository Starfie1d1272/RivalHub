ALTER TABLE "season_registrations" ALTER COLUMN "player_type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "season_registrations" ALTER COLUMN "player_type" DROP NOT NULL;