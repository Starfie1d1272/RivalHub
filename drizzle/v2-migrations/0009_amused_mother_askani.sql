ALTER TABLE "match_rosters" ALTER COLUMN "submitted_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "match_rosters" ADD COLUMN "source" text DEFAULT 'participant' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_rosters" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "match_rosters" ADD COLUMN "confirmed_by" text;