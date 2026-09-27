UPDATE "competition_entries" AS entry
SET
  "name" = team."name",
  "updated_at" = NOW()
FROM "teams" AS team, "seasons" AS season
WHERE entry."team_id" = team."id"
  AND entry."competition_id" = season."id"
  AND season."status" NOT IN ('finished', 'archived')
  AND entry."name" IS DISTINCT FROM team."name";
