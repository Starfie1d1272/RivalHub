ALTER TABLE "seasons" RENAME COLUMN "start_at" TO "registration_opens_at";--> statement-breakpoint
ALTER TABLE "seasons" RENAME COLUMN "registration_deadline" TO "registration_closes_at";--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "registration_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "roster_change_closes_at" timestamp with time zone;--> statement-breakpoint
-- Before 2.1 a published row with start_at = NULL meant immediately open.
-- Preserve that fact explicitly; only newly published rows may use NULL for
-- the new "time to be announced" state.
UPDATE "seasons"
SET "registration_opened_at" = COALESCE("registration_opens_at", "created_at")
WHERE "status" <> 'draft';--> statement-breakpoint
-- Existing published freezes retain their exact two-season evaluation: the
-- new policy simply makes its old 50/20/30 evidence slots explicit without
-- resolving anything against today's catalog.
UPDATE "seasons"
SET "team_registration_config" = jsonb_set(
  "team_registration_config"::jsonb,
  '{competitiveProfile,evidencePolicy}'::text[],
  jsonb_build_object(
    'historicalWeight', 50,
    'referenceSeasonKey', "team_registration_config"->'competitiveProfile'->>'previousSeasonKey',
    'referenceSeasonWeight', 20,
    'recentSeasonKeys', jsonb_build_array("team_registration_config"->'competitiveProfile'->>'currentSeasonKey'),
    'recentSeasonWeight', 30
  )
)::json
WHERE "status" <> 'draft'
  AND "team_registration_config"->'competitiveProfile'->>'platform' IS NOT NULL
  AND COALESCE("team_registration_config"->'competitiveProfile'->>'previousSeasonKey', '') <> ''
  AND COALESCE("team_registration_config"->'competitiveProfile'->>'currentSeasonKey', '') <> ''
  AND "team_registration_config"->'competitiveProfile'->'evidencePolicy' IS NULL;
