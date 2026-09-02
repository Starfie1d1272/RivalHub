CREATE TYPE "public"."competitive_fact_status" AS ENUM('ranked', 'unranked');--> statement-breakpoint
ALTER TABLE "competitive_rank_facts" ALTER COLUMN "rank" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "competitive_rank_facts" ALTER COLUMN "rating" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "competitive_rank_facts" ADD COLUMN "status" "competitive_fact_status" DEFAULT 'ranked' NOT NULL;--> statement-breakpoint
ALTER TABLE "competitive_rank_facts" ADD COLUMN "achieved_season_key" text;--> statement-breakpoint
ALTER TABLE "competitive_rank_facts" ADD CONSTRAINT "competitive_rank_facts_valid_fact_shape" CHECK (
    (
      "competitive_rank_facts"."kind" = 'historical_peak'
      AND "competitive_rank_facts"."status" = 'ranked'
      AND "competitive_rank_facts"."platform_season_key" IS NULL
      AND "competitive_rank_facts"."rank" IS NOT NULL
      AND "competitive_rank_facts"."rating" IS NOT NULL
    ) OR (
      "competitive_rank_facts"."kind" = 'season_peak'
      AND "competitive_rank_facts"."platform_season_key" IS NOT NULL
      AND (
        ("competitive_rank_facts"."status" = 'ranked' AND "competitive_rank_facts"."rank" IS NOT NULL AND "competitive_rank_facts"."rating" IS NOT NULL)
        OR ("competitive_rank_facts"."status" = 'unranked' AND "competitive_rank_facts"."rank" IS NULL AND "competitive_rank_facts"."stars" IS NULL)
      )
    )
  );--> statement-breakpoint
ALTER TABLE "competitive_rank_facts" ADD CONSTRAINT "competitive_rank_facts_achieved_season_shape" CHECK (
    ("competitive_rank_facts"."kind" = 'historical_peak') OR "competitive_rank_facts"."achieved_season_key" IS NULL
  );