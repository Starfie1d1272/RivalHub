ALTER TABLE "season_registrations" ALTER COLUMN "peak_rank" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "season_registrations" ALTER COLUMN "peak_rank_season" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "season_registrations" ALTER COLUMN "peak_rating" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "season_registrations" ALTER COLUMN "current_season_peak_rank" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "season_registrations" ALTER COLUMN "current_rating" DROP NOT NULL;