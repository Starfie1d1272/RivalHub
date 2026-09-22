ALTER TABLE "users" ADD COLUMN "gameplay_style" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "competition_history" text;--> statement-breakpoint
-- Initialize the long-lived profile once from the same deterministic latest approved snapshot.
WITH "ranked_registrations" AS (
  SELECT DISTINCT ON (sr."user_id")
    sr."user_id",
    sr."gameplay_style",
    sr."competition_history"
  FROM "season_registrations" AS sr
  INNER JOIN "seasons" AS s ON s."id" = sr."season_id"
  WHERE sr."status" = 'approved'
  ORDER BY sr."user_id", s."created_at" DESC, sr."created_at" DESC, sr."id" DESC
)
UPDATE "users" AS u
SET
  "gameplay_style" = COALESCE(u."gameplay_style", ranked."gameplay_style"),
  "competition_history" = COALESCE(u."competition_history", ranked."competition_history")
FROM "ranked_registrations" AS ranked
WHERE u."id" = ranked."user_id"
  AND (u."gameplay_style" IS NULL OR u."competition_history" IS NULL);
