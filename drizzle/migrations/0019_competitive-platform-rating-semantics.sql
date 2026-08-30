-- Catalog metadata makes the user-facing meaning of `rating` explicit. It is
-- the platform's canonical performance Rating, never a matchmaking score.
ALTER TABLE "competitive_platforms" ADD COLUMN "rating_label" text NOT NULL DEFAULT 'Rating';--> statement-breakpoint
UPDATE "competitive_platforms" SET "rating_label" = 'Rating Pro' WHERE "key" = 'perfect_world';--> statement-breakpoint
ALTER TABLE "competitive_platforms" ALTER COLUMN "rating_label" DROP DEFAULT;
