CREATE TYPE "public"."competition_template" AS ENUM('rivals', 'major', 'custom');--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_season_id_seasons_id_fk";
--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "competition_template" "competition_template" DEFAULT 'custom' NOT NULL;--> statement-breakpoint
UPDATE "seasons"
SET "competition_template" = 'rivals'
WHERE "slug" = '2026-nju-rivals';--> statement-breakpoint
UPDATE "seasons"
SET "competition_template" = 'major'
WHERE "kind" = 'Major'
  AND "registration_mode" = 'team'
  AND NOT "has_captain_voting"
  AND NOT "has_draft"
  AND jsonb_array_length("stage_plan"::jsonb) = 4;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
WITH ordered AS (
  SELECT "id", row_number() OVER (PARTITION BY "platform" ORDER BY "sort_order", "created_at", "id") - 1 AS "next_sort_order"
  FROM "competitive_platform_seasons"
)
UPDATE "competitive_platform_seasons" AS catalog
SET "sort_order" = ordered."next_sort_order"
FROM ordered
WHERE catalog."id" = ordered."id";--> statement-breakpoint
CREATE UNIQUE INDEX "competitive_platform_seasons_platform_sort_order_unique" ON "competitive_platform_seasons" USING btree ("platform","sort_order");--> statement-breakpoint
ALTER TABLE "competitive_platform_seasons" ADD CONSTRAINT "competitive_platform_seasons_current_must_be_active" CHECK (NOT "competitive_platform_seasons"."is_current" OR "competitive_platform_seasons"."active");
