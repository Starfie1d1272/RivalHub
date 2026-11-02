-- PR1: Canonical Team Identity Bridge
-- teams.captain_user_id / team_members.user_id / team_members.season_id
-- 安全顺序：nullable ADD → backfill → fail-closed validation → NOT NULL → constraints
-- 最终 schema 与 0001_snapshot.json 等价（NOT NULL + FK + UNIQUE）
ALTER TABLE "team_members" ADD COLUMN "season_id" uuid;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "captain_user_id" uuid;--> statement-breakpoint
-- backfill teams.captain_user_id ← season_registrations.user_id
UPDATE "teams" AS t
SET "captain_user_id" = sr."user_id"
FROM "season_registrations" AS sr
WHERE t."captain_registration_id" = sr."id";--> statement-breakpoint
-- backfill team_members.user_id ← season_registrations.user_id
UPDATE "team_members" AS tm
SET "user_id" = sr."user_id"
FROM "season_registrations" AS sr
WHERE tm."registration_id" = sr."id";--> statement-breakpoint
-- backfill team_members.season_id ← teams.season_id
UPDATE "team_members" AS tm
SET "season_id" = t."season_id"
FROM "teams" AS t
WHERE tm."team_id" = t."id";--> statement-breakpoint
-- fail-closed validation：任何异常直接中止迁移
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "teams" WHERE "captain_user_id" IS NULL) THEN
    RAISE EXCEPTION 'teams.captain_user_id has NULL rows; backfill failed';
  END IF;
  IF EXISTS (SELECT 1 FROM "team_members" WHERE "user_id" IS NULL) THEN
    RAISE EXCEPTION 'team_members.user_id has NULL rows; backfill failed';
  END IF;
  IF EXISTS (SELECT 1 FROM "team_members" WHERE "season_id" IS NULL) THEN
    RAISE EXCEPTION 'team_members.season_id has NULL rows; backfill failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "team_members"
    GROUP BY "season_id", "user_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate team_members(season_id, user_id) found; migration aborted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "team_members" tm
    JOIN "teams" t ON t."id" = tm."team_id"
    WHERE tm."season_id" IS DISTINCT FROM t."season_id"
  ) THEN
    RAISE EXCEPTION 'team_members.season_id does not match parent teams.season_id; migration aborted';
  END IF;
  -- legacy provenance season consistency：canonical backfill 从 registration 提取 userId，
  -- 不得把跨 season 的历史错误 provenance 静默升级为 canonical truth
  IF EXISTS (
    SELECT 1 FROM "teams" t
    JOIN "season_registrations" sr ON sr."id" = t."captain_registration_id"
    WHERE sr."season_id" IS DISTINCT FROM t."season_id"
  ) THEN
    RAISE EXCEPTION 'teams.captain_registration_id registration season does not match teams.season_id; migration aborted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "team_members" tm
    JOIN "teams" t ON t."id" = tm."team_id"
    JOIN "season_registrations" sr ON sr."id" = tm."registration_id"
    WHERE sr."season_id" IS DISTINCT FROM t."season_id"
  ) THEN
    RAISE EXCEPTION 'team_members.registration_id registration season does not match parent teams.season_id; migration aborted';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "captain_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" ALTER COLUMN "season_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_season_id_user_id_unique" UNIQUE("season_id","user_id");--> statement-breakpoint
-- composite FK 目标必须先建立 teams(id, season_id) unique
ALTER TABLE "teams" ADD CONSTRAINT "teams_id_season_id_unique" UNIQUE("id","season_id");--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_season_fk" FOREIGN KEY ("team_id","season_id") REFERENCES "public"."teams"("id","season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_captain_user_id_users_id_fk" FOREIGN KEY ("captain_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
