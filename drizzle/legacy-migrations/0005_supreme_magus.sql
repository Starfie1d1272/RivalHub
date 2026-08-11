ALTER TABLE "matches" ALTER COLUMN "stage" SET DATA TYPE text USING "stage"::text;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "stage_plan" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "registration_config" json DEFAULT '{}'::json NOT NULL;--> statement-breakpoint
UPDATE "seasons"
SET "stage_plan" = CASE
  WHEN "qualifier_format" IS NULL AND "playoff_format" IS NULL THEN '[]'::json
  WHEN "qualifier_format" IS NULL THEN json_build_array(
    json_build_object(
      'key', 'playoff',
      'name', '正赛',
      'type', "playoff_format"::text,
      'teamCount', 8,
      'advance', 1
    )
  )
  WHEN "playoff_format" IS NULL THEN json_build_array(
    json_build_object(
      'key', 'qualifier',
      'name', '排位赛',
      'type', "qualifier_format"::text,
      'teamCount', 8,
      'advance', 8
    )
  )
  ELSE json_build_array(
    json_build_object(
      'key', 'qualifier',
      'name', '排位赛',
      'type', "qualifier_format"::text,
      'teamCount', 8,
      'advance', 8
    ),
    json_build_object(
      'key', 'playoff',
      'name', '正赛',
      'type', "playoff_format"::text,
      'teamCount', 8,
      'advance', 1
    )
  )
END;--> statement-breakpoint
UPDATE "seasons"
SET "registration_config" = json_build_object(
  'allowedPlayerTypes', json_build_array('enrolled'),
  'rankThreshold', json_build_object('currentMin', 'A', 'peakMin', 'A+'),
  'maxPerPosition', 15,
  'screenshotCount', 1
);--> statement-breakpoint
ALTER TABLE "season_registrations" ADD COLUMN "player_type" text DEFAULT 'enrolled' NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "round" integer;--> statement-breakpoint
ALTER TABLE "seasons" DROP COLUMN "qualifier_format";--> statement-breakpoint
ALTER TABLE "seasons" DROP COLUMN "playoff_format";--> statement-breakpoint
DROP TYPE "public"."playoff_format";--> statement-breakpoint
DROP TYPE "public"."qualifier_format";--> statement-breakpoint
DROP TYPE "public"."match_stage";
