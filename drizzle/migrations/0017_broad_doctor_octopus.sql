-- Terminal 2.x identity migration. Legacy tables are renamed only inside this
-- transaction; no legacy runtime relation survives the migration.
LOCK TABLE "teams", "team_members", "team_applications", "team_application_members",
  "team_application_active_claims", "matches", "major_prestart_entrants" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
ALTER TABLE "teams" RENAME TO "_legacy_season_teams";--> statement-breakpoint
ALTER TABLE "team_members" RENAME TO "_legacy_season_team_members";--> statement-breakpoint
CREATE TYPE "public"."competition_entry_participant_status" AS ENUM('invited', 'confirmed', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."competition_entry_registration_status" AS ENUM('draft', 'submitted', 'changes_requested', 'waitlisted', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."competition_entry_roster_revision_status" AS ENUM('draft', 'submitted', 'approved', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."competition_entry_source" AS ENUM('linked_team', 'event_native');--> statement-breakpoint
CREATE TYPE "public"."competition_entry_submission_decision" AS ENUM('submitted', 'changes_requested', 'waitlisted', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."event_roster_status" AS ENUM('preparing', 'frozen');--> statement-breakpoint
CREATE TYPE "public"."cs2_role" AS ENUM('igl', 'awper', 'entry', 'closer', 'anchor', 'support', 'lurker');--> statement-breakpoint
CREATE TYPE "public"."team_invitation_kind" AS ENUM('direct', 'share_link');--> statement-breakpoint
CREATE TYPE "public"."team_invitation_status" AS ENUM('pending', 'accepted', 'declined', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."team_lifecycle" AS ENUM('active', 'disbanded');--> statement-breakpoint
CREATE TYPE "public"."team_membership_end_reason" AS ENUM('left', 'kicked', 'disbanded');--> statement-breakpoint
CREATE TYPE "public"."team_membership_role" AS ENUM('captain', 'member');--> statement-breakpoint
CREATE TYPE "public"."team_membership_status" AS ENUM('active', 'benched', 'left');--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"logo_url" text,
	"description" text,
	"recruiting" boolean DEFAULT false NOT NULL,
	"status" "team_lifecycle" DEFAULT 'active' NOT NULL,
	"creator_user_id" uuid NOT NULL,
	"captain_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disbanded_at" timestamp with time zone,
	"disbanded_by" text,
	CONSTRAINT "teams_lifecycle_shape_check" CHECK (("teams"."status" = 'active' AND "teams"."disbanded_at" IS NULL) OR ("teams"."status" = 'disbanded' AND "teams"."disbanded_at" IS NOT NULL))
);--> statement-breakpoint
CREATE TABLE "competition_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"source" "competition_entry_source" NOT NULL,
	"team_id" uuid,
	"source_registration_id" uuid,
	"formation_order" integer,
	"name" text NOT NULL,
	"logo_url" text,
	"representative_user_id" uuid NOT NULL,
	"registration_status" "competition_entry_registration_status" DEFAULT 'draft' NOT NULL,
	"perfect_team_id" text,
	"current_roster_revision" integer DEFAULT 1 NOT NULL,
	"approved_roster_revision" integer,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"legacy_source_type" text,
	"legacy_source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_entries_source_shape_check" CHECK (("competition_entries"."source" = 'linked_team' AND "competition_entries"."team_id" IS NOT NULL) OR ("competition_entries"."source" = 'event_native' AND "competition_entries"."team_id" IS NULL)),
	CONSTRAINT "competition_entries_revision_shape_check" CHECK ("competition_entries"."current_roster_revision" >= 1 AND ("competition_entries"."approved_roster_revision" IS NULL OR ("competition_entries"."approved_roster_revision" >= 1 AND "competition_entries"."approved_roster_revision" <= "competition_entries"."current_roster_revision")))
);
--> statement-breakpoint
CREATE TABLE "competition_entry_active_claims" (
	"competition_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_entry_active_claims_competition_user_unique" UNIQUE("competition_id","user_id"),
	CONSTRAINT "competition_entry_active_claims_participant_unique" UNIQUE("participant_id")
);
--> statement-breakpoint
CREATE TABLE "competition_entry_legacy_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"legacy_type" text NOT NULL,
	"legacy_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_entry_legacy_identities_type_id_unique" UNIQUE("legacy_type","legacy_id")
);
--> statement-breakpoint
CREATE TABLE "competition_entry_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "competition_entry_participant_status" DEFAULT 'invited' NOT NULL,
	"invited_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_entry_participants_entry_user_unique" UNIQUE("entry_id","user_id"),
	CONSTRAINT "competition_entry_participants_confirmation_shape_check" CHECK (("competition_entry_participants"."status" = 'confirmed' AND "competition_entry_participants"."confirmed_at" IS NOT NULL AND "competition_entry_participants"."withdrawn_at" IS NULL)
      OR ("competition_entry_participants"."status" = 'withdrawn' AND "competition_entry_participants"."withdrawn_at" IS NOT NULL)
      OR ("competition_entry_participants"."status" IN ('invited', 'declined') AND "competition_entry_participants"."confirmed_at" IS NULL AND "competition_entry_participants"."withdrawn_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "competition_entry_representative_tenures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"transferred_by" text
);
--> statement-breakpoint
CREATE TABLE "competition_entry_roster_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"team_membership_id" uuid,
	"is_primary_starter" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_entry_roster_members_revision_participant_unique" UNIQUE("revision_id","participant_id"),
	CONSTRAINT "competition_entry_roster_members_revision_user_unique" UNIQUE("revision_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "competition_entry_roster_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" "competition_entry_roster_revision_status" DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	CONSTRAINT "competition_entry_roster_revisions_entry_revision_unique" UNIQUE("entry_id","revision"),
	CONSTRAINT "competition_entry_roster_revisions_positive_check" CHECK ("competition_entry_roster_revisions"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "competition_entry_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"roster_revision_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"decision" "competition_entry_submission_decision" DEFAULT 'submitted' NOT NULL,
	"submitted_by" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"reason" text,
	CONSTRAINT "competition_entry_submissions_entry_sequence_unique" UNIQUE("entry_id","sequence"),
	CONSTRAINT "competition_entry_submissions_positive_check" CHECK ("competition_entry_submissions"."sequence" >= 1)
);
--> statement-breakpoint
CREATE TABLE "event_roster_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_roster_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"participant_id" uuid,
	"education_verification_id" uuid,
	"is_primary_starter" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_roster_members_roster_user_unique" UNIQUE("event_roster_id","user_id"),
	CONSTRAINT "event_roster_members_participant_unique" UNIQUE("event_roster_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "event_rosters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"source_roster_revision_id" uuid,
	"status" "event_roster_status" DEFAULT 'preparing' NOT NULL,
	"policy_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"frozen_at" timestamp with time zone,
	"frozen_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_rosters_entry_unique" UNIQUE("entry_id"),
	CONSTRAINT "event_rosters_freeze_shape_check" CHECK (("event_rosters"."status" = 'preparing' AND "event_rosters"."frozen_at" IS NULL) OR ("event_rosters"."status" = 'frozen' AND "event_rosters"."frozen_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "user_competitive_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "cs2_role" NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_competitive_roles_user_role_unique" UNIQUE("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "team_captain_tenures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"transferred_by" text,
	CONSTRAINT "team_captain_tenures_team_started_unique" UNIQUE("team_id","started_at")
);
--> statement-breakpoint
CREATE TABLE "team_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"kind" "team_invitation_kind" NOT NULL,
	"invited_user_id" uuid,
	"token_hash" text,
	"status" "team_invitation_status" DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"responded_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_invitations_kind_shape_check" CHECK (("team_invitations"."kind" = 'direct' AND "team_invitations"."invited_user_id" IS NOT NULL AND "team_invitations"."token_hash" IS NULL) OR ("team_invitations"."kind" = 'share_link' AND "team_invitations"."invited_user_id" IS NULL AND "team_invitations"."token_hash" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "team_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "team_membership_status" DEFAULT 'active' NOT NULL,
	"role" "team_membership_role" DEFAULT 'member' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_reason" "team_membership_end_reason",
	"invited_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_memberships_period_shape_check" CHECK (("team_memberships"."ended_at" IS NULL AND "team_memberships"."ended_reason" IS NULL AND "team_memberships"."status" <> 'left') OR ("team_memberships"."ended_at" IS NOT NULL AND "team_memberships"."ended_reason" IS NOT NULL AND "team_memberships"."status" = 'left')),
	CONSTRAINT "team_memberships_captain_must_be_active_check" CHECK ("team_memberships"."role" <> 'captain' OR ("team_memberships"."status" = 'active' AND "team_memberships"."ended_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "team_name_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"changed_by" text
);
--> statement-breakpoint
CREATE TABLE "team_slug_aliases" (
	"slug" text PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Legacy sources stay readable until all canonical rows and foreign keys have
-- been backfilled and validated below.
ALTER TABLE "major_prestart_entrants" DROP CONSTRAINT "major_prestart_entrants_season_team_unique";--> statement-breakpoint
ALTER TABLE "major_stage_entrants" DROP CONSTRAINT "major_stage_entrants_run_team_unique";--> statement-breakpoint
ALTER TABLE "swiss_standings" DROP CONSTRAINT "swiss_standings_season_id_stage_team_id_unique";--> statement-breakpoint
ALTER TABLE "match_roster_players" DROP CONSTRAINT "match_roster_players_roster_id_team_member_id_unique";--> statement-breakpoint
ALTER TABLE "match_rosters" DROP CONSTRAINT "match_rosters_match_id_team_id_unique";--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT "matches_teams_different";--> statement-breakpoint
ALTER TABLE "post_event_adjudications" DROP CONSTRAINT "post_event_adjudications_target_check";--> statement-breakpoint
ALTER TABLE "tournament_honors" DROP CONSTRAINT "tournament_honors_recipient_check";--> statement-breakpoint
ALTER TABLE "draft_picks" DROP CONSTRAINT "draft_picks_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "draft_state" DROP CONSTRAINT "draft_state_current_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "major_prestart_entrants" DROP CONSTRAINT "major_prestart_entrants_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "major_final_results" DROP CONSTRAINT "major_final_results_champion_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "major_stage_entrants" DROP CONSTRAINT "major_stage_entrants_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT "matches_team_a_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT "matches_team_b_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "match_maps" DROP CONSTRAINT "match_maps_picked_by_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "swiss_standings" DROP CONSTRAINT "swiss_standings_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "match_roster_players" DROP CONSTRAINT "match_roster_players_team_member_id_team_members_id_fk";
--> statement-breakpoint
ALTER TABLE "match_rosters" DROP CONSTRAINT "match_rosters_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "match_veto_steps" DROP CONSTRAINT "match_veto_steps_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "post_event_adjudications" DROP CONSTRAINT "post_event_adjudications_target_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "tournament_honors" DROP CONSTRAINT "tournament_honors_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "post_event_adjudications" ALTER COLUMN "target" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."adjudication_target";--> statement-breakpoint
CREATE TYPE "public"."adjudication_target" AS ENUM('season', 'entry', 'user', 'match');--> statement-breakpoint
UPDATE "post_event_adjudications" SET "target" = 'entry' WHERE "target" = 'team';--> statement-breakpoint
ALTER TABLE "post_event_adjudications" ALTER COLUMN "target" SET DATA TYPE "public"."adjudication_target" USING "target"::"public"."adjudication_target";--> statement-breakpoint
DROP INDEX "matches_team_a_id_idx";--> statement-breakpoint
DROP INDEX "matches_team_b_id_idx";--> statement-breakpoint
ALTER TABLE "draft_picks" ADD COLUMN "entry_id" uuid;--> statement-breakpoint
ALTER TABLE "draft_state" ADD COLUMN "current_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "major_prestart_entrants" ADD COLUMN "competition_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "major_prestart_entrants" ADD COLUMN "event_roster_id" uuid;--> statement-breakpoint
ALTER TABLE "major_final_results" ADD COLUMN "champion_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "major_stage_entrants" ADD COLUMN "competition_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "entry_a_id" uuid;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "entry_b_id" uuid;--> statement-breakpoint
ALTER TABLE "match_maps" ADD COLUMN "picked_by_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "swiss_standings" ADD COLUMN "entry_id" uuid;--> statement-breakpoint
ALTER TABLE "match_roster_players" ADD COLUMN "event_roster_member_id" uuid;--> statement-breakpoint
ALTER TABLE "match_rosters" ADD COLUMN "entry_id" uuid;--> statement-breakpoint
ALTER TABLE "match_veto_steps" ADD COLUMN "entry_id" uuid;--> statement-breakpoint
ALTER TABLE "post_event_adjudications" ADD COLUMN "target_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "tournament_honors" ADD COLUMN "entry_id" uuid;--> statement-breakpoint

-- One canonical CompetitionEntry id per entrant. Applications keep their
-- draft identity; an approved legacy team id remains provenance and maps to
-- that application id. Rivals teams preserve their id when no cross-table id
-- collision makes that impossible.
CREATE TEMP TABLE "_entry_id_map" (
  "legacy_team_id" uuid PRIMARY KEY,
  "entry_id" uuid NOT NULL UNIQUE
) ON COMMIT DROP;--> statement-breakpoint
INSERT INTO "_entry_id_map" ("legacy_team_id", "entry_id")
SELECT legacy.id,
  CASE WHEN EXISTS (SELECT 1 FROM "team_applications" app WHERE app.id = legacy.id)
    THEN gen_random_uuid() ELSE legacy.id END
FROM "_legacy_season_teams" legacy
WHERE legacy.team_application_id IS NULL;--> statement-breakpoint
INSERT INTO "_entry_id_map" ("legacy_team_id", "entry_id")
SELECT legacy.id, legacy.team_application_id
FROM "_legacy_season_teams" legacy
WHERE legacy.team_application_id IS NOT NULL;--> statement-breakpoint

CREATE TEMP TABLE "_application_team_map" (
  "application_id" uuid PRIMARY KEY,
  "long_team_id" uuid NOT NULL UNIQUE
) ON COMMIT DROP;--> statement-breakpoint
INSERT INTO "_application_team_map" ("application_id", "long_team_id")
SELECT app.id, COALESCE(legacy.id, gen_random_uuid())
FROM "team_applications" app
LEFT JOIN "_legacy_season_teams" legacy ON legacy.team_application_id = app.id;--> statement-breakpoint

-- A migration cannot invent a winner when legacy applications would violate
-- the new global one-active-Team rule. Stop for operator reconciliation.
DO $$
BEGIN
  IF EXISTS (
    SELECT member.user_id
    FROM "team_application_members" member
    WHERE member.status = 'confirmed'
    GROUP BY member.user_id
    HAVING count(DISTINCT member.application_id) > 1
  ) THEN
    RAISE EXCEPTION 'long-lived Team migration blocked: a user is confirmed in multiple legacy applications';
  END IF;
  IF EXISTS (
    SELECT app.captain_user_id
    FROM "team_applications" app
    GROUP BY app.captain_user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'long-lived Team migration blocked: a user captains multiple legacy applications';
  END IF;
END $$;--> statement-breakpoint

INSERT INTO "teams" (
  "id", "slug", "name", "logo_url", "creator_user_id", "captain_user_id", "created_at", "updated_at"
)
SELECT map.long_team_id,
  'legacy-major-' || replace(app.id::text, '-', ''),
  app.name, app.logo_url, app.captain_user_id, app.captain_user_id,
  app.created_at, app.updated_at
FROM "team_applications" app
JOIN "_application_team_map" map ON map.application_id = app.id;--> statement-breakpoint

INSERT INTO "competition_entries" (
  "id", "competition_id", "source", "team_id", "name", "logo_url",
  "representative_user_id", "registration_status", "perfect_team_id",
  "current_roster_revision", "approved_roster_revision", "submitted_at",
  "reviewed_at", "review_reason", "legacy_source_type", "legacy_source_id",
  "created_at", "updated_at"
)
SELECT app.id, app.season_id, 'linked_team', map.long_team_id, app.name, app.logo_url,
  app.captain_user_id,
  CASE app.status::text
    WHEN 'rejected' THEN 'changes_requested'::competition_entry_registration_status
    ELSE app.status::text::competition_entry_registration_status
  END,
  app.perfect_team_id, 1,
  CASE WHEN app.status::text = 'approved' THEN 1 ELSE NULL END,
  app.submitted_at, app.reviewed_at, app.review_reason,
  'team_application', app.id, app.created_at, app.updated_at
FROM "team_applications" app
JOIN "_application_team_map" map ON map.application_id = app.id;--> statement-breakpoint

INSERT INTO "competition_entries" (
  "id", "competition_id", "source", "team_id", "source_registration_id",
  "formation_order", "name", "logo_url", "representative_user_id",
  "registration_status", "current_roster_revision", "approved_roster_revision",
  "legacy_source_type", "legacy_source_id", "created_at", "updated_at"
)
SELECT map.entry_id, legacy.season_id, 'event_native', NULL,
  legacy.captain_registration_id, legacy.draft_order, legacy.name, legacy.logo_url,
  legacy.captain_user_id, 'approved', 1, 1,
  'season_team', legacy.id, legacy.created_at, legacy.created_at
FROM "_legacy_season_teams" legacy
JOIN "_entry_id_map" map ON map.legacy_team_id = legacy.id
WHERE legacy.team_application_id IS NULL;--> statement-breakpoint

INSERT INTO "competition_entry_legacy_identities" ("entry_id", "legacy_type", "legacy_id")
SELECT app.id, 'team_application', app.id FROM "team_applications" app
UNION ALL
SELECT map.entry_id, 'season_team', map.legacy_team_id FROM "_entry_id_map" map;--> statement-breakpoint

INSERT INTO "team_memberships" (
  "id", "team_id", "user_id", "status", "role", "started_at", "invited_by_user_id", "created_at", "updated_at"
)
SELECT COALESCE(legacy_member.id, gen_random_uuid()), map.long_team_id, member.user_id,
  'active', (CASE WHEN member.user_id = app.captain_user_id THEN 'captain' ELSE 'member' END)::team_membership_role,
  COALESCE(legacy_member.joined_at, member.confirmed_at, member.created_at),
  member.invited_by_user_id, member.created_at, member.updated_at
FROM "team_application_members" member
JOIN "team_applications" app ON app.id = member.application_id
JOIN "_application_team_map" map ON map.application_id = app.id
LEFT JOIN "_legacy_season_team_members" legacy_member
  ON legacy_member.team_application_member_id = member.id
WHERE member.status = 'confirmed';--> statement-breakpoint
INSERT INTO "team_memberships" (
  "team_id", "user_id", "status", "role", "started_at", "invited_by_user_id"
)
SELECT map.long_team_id, app.captain_user_id, 'active', 'captain', app.created_at, app.captain_user_id
FROM "team_applications" app
JOIN "_application_team_map" map ON map.application_id = app.id
WHERE NOT EXISTS (
  SELECT 1 FROM "team_memberships" membership
  WHERE membership.team_id = map.long_team_id AND membership.user_id = app.captain_user_id
);--> statement-breakpoint
INSERT INTO "team_captain_tenures" ("team_id", "user_id", "started_at", "transferred_by")
SELECT map.long_team_id, app.captain_user_id, app.created_at, 'migration:0017'
FROM "team_applications" app JOIN "_application_team_map" map ON map.application_id = app.id;--> statement-breakpoint
INSERT INTO "team_name_history" ("team_id", "name", "started_at", "changed_by")
SELECT map.long_team_id, app.name, app.created_at, 'migration:0017'
FROM "team_applications" app JOIN "_application_team_map" map ON map.application_id = app.id;--> statement-breakpoint

-- Commitment identity follows the application member when it exists. Rivals
-- may reuse the old season-member id as a commitment, but frozen roster rows
-- below receive a distinct identity and foreign-key owner.
INSERT INTO "competition_entry_participants" (
  "id", "entry_id", "user_id", "status", "invited_by_user_id", "confirmed_at", "created_at", "updated_at"
)
SELECT member.id, member.application_id, member.user_id,
  member.status::text::competition_entry_participant_status,
  member.invited_by_user_id, member.confirmed_at, member.created_at, member.updated_at
FROM "team_application_members" member;--> statement-breakpoint
INSERT INTO "competition_entry_participants" (
  "entry_id", "user_id", "status", "invited_by_user_id", "confirmed_at", "created_at", "updated_at"
)
SELECT app.id, app.captain_user_id, 'confirmed', app.captain_user_id,
  app.created_at, app.created_at, app.updated_at
FROM "team_applications" app
WHERE NOT EXISTS (
  SELECT 1 FROM "competition_entry_participants" participant
  WHERE participant.entry_id = app.id AND participant.user_id = app.captain_user_id
);--> statement-breakpoint
INSERT INTO "competition_entry_participants" (
  "id", "entry_id", "user_id", "status", "invited_by_user_id", "confirmed_at", "created_at", "updated_at"
)
SELECT legacy_member.id, map.entry_id, legacy_member.user_id, 'confirmed',
  legacy.captain_user_id, legacy_member.joined_at, legacy_member.joined_at, legacy_member.joined_at
FROM "_legacy_season_team_members" legacy_member
JOIN "_legacy_season_teams" legacy ON legacy.id = legacy_member.team_id
JOIN "_entry_id_map" map ON map.legacy_team_id = legacy.id
WHERE legacy.team_application_id IS NULL;--> statement-breakpoint

INSERT INTO "competition_entry_representative_tenures" ("entry_id", "user_id", "started_at", "transferred_by")
SELECT entry.id, entry.representative_user_id, entry.created_at, 'migration:0017'
FROM "competition_entries" entry;--> statement-breakpoint

INSERT INTO "competition_entry_active_claims" ("competition_id", "user_id", "entry_id", "participant_id", "created_at")
SELECT claim.season_id, claim.user_id, claim.application_id, participant.id, claim.created_at
FROM "team_application_active_claims" claim
JOIN "competition_entry_participants" participant
  ON participant.entry_id = claim.application_id AND participant.user_id = claim.user_id;--> statement-breakpoint

CREATE TEMP TABLE "_revision_map" (
  "entry_id" uuid PRIMARY KEY,
  "revision_id" uuid NOT NULL UNIQUE
) ON COMMIT DROP;--> statement-breakpoint
INSERT INTO "_revision_map" ("entry_id", "revision_id")
SELECT id, gen_random_uuid() FROM "competition_entries";--> statement-breakpoint
INSERT INTO "competition_entry_roster_revisions" (
  "id", "entry_id", "revision", "status", "created_by", "created_at", "submitted_at", "approved_at"
)
SELECT revision.revision_id, entry.id, 1,
  CASE entry.registration_status
    WHEN 'approved' THEN 'approved'::competition_entry_roster_revision_status
    WHEN 'submitted' THEN 'submitted'::competition_entry_roster_revision_status
    WHEN 'waitlisted' THEN 'submitted'::competition_entry_roster_revision_status
    ELSE 'draft'::competition_entry_roster_revision_status
  END,
  'migration:0017', entry.created_at,
  CASE WHEN entry.registration_status IN ('submitted', 'waitlisted', 'approved') THEN entry.submitted_at ELSE NULL END,
  CASE WHEN entry.registration_status = 'approved' THEN entry.reviewed_at ELSE NULL END
FROM "competition_entries" entry JOIN "_revision_map" revision ON revision.entry_id = entry.id;--> statement-breakpoint

INSERT INTO "competition_entry_roster_members" (
  "revision_id", "participant_id", "user_id", "team_membership_id", "is_primary_starter", "created_at"
)
SELECT revision.revision_id, participant.id, participant.user_id, membership.id,
  participant.user_id = ANY(app.primary_starter_user_ids), participant.created_at
FROM "team_applications" app
JOIN "_revision_map" revision ON revision.entry_id = app.id
JOIN "competition_entry_participants" participant ON participant.entry_id = app.id
LEFT JOIN "_application_team_map" team_map ON team_map.application_id = app.id
LEFT JOIN "team_memberships" membership
  ON membership.team_id = team_map.long_team_id AND membership.user_id = participant.user_id;--> statement-breakpoint
INSERT INTO "competition_entry_roster_members" (
  "revision_id", "participant_id", "user_id", "is_primary_starter", "created_at"
)
SELECT revision.revision_id, participant.id, participant.user_id,
  legacy_member.is_starter, legacy_member.joined_at
FROM "_legacy_season_team_members" legacy_member
JOIN "_legacy_season_teams" legacy ON legacy.id = legacy_member.team_id
JOIN "_entry_id_map" map ON map.legacy_team_id = legacy.id
JOIN "_revision_map" revision ON revision.entry_id = map.entry_id
JOIN "competition_entry_participants" participant
  ON participant.entry_id = map.entry_id AND participant.user_id = legacy_member.user_id
WHERE legacy.team_application_id IS NULL;--> statement-breakpoint

INSERT INTO "competition_entry_submissions" (
  "entry_id", "roster_revision_id", "sequence", "decision", "submitted_by",
  "submitted_at", "decided_by", "decided_at", "reason"
)
SELECT app.id, revision.revision_id, 1,
  CASE app.status::text
    WHEN 'rejected' THEN 'changes_requested'::competition_entry_submission_decision
    ELSE app.status::text::competition_entry_submission_decision
  END,
  app.captain_user_id::text, COALESCE(app.submitted_at, app.created_at),
  app.reviewed_by, app.reviewed_at, app.review_reason
FROM "team_applications" app JOIN "_revision_map" revision ON revision.entry_id = app.id
WHERE app.status::text <> 'draft';--> statement-breakpoint

-- Rivals history is frozen immediately. Major reuses the existing prestart
-- freeze boundary and the old prestart member id because it already names that
-- exact frozen fact.
CREATE TEMP TABLE "_event_roster_map" (
  "entry_id" uuid PRIMARY KEY,
  "event_roster_id" uuid NOT NULL UNIQUE
) ON COMMIT DROP;--> statement-breakpoint
INSERT INTO "_event_roster_map" ("entry_id", "event_roster_id")
SELECT map.entry_id, gen_random_uuid()
FROM "_entry_id_map" map
JOIN "_legacy_season_teams" legacy ON legacy.id = map.legacy_team_id
WHERE legacy.team_application_id IS NULL
UNION
SELECT map.entry_id, gen_random_uuid()
FROM "major_prestart_entrants" prestart
JOIN "_entry_id_map" map ON map.legacy_team_id = prestart.team_id;--> statement-breakpoint
INSERT INTO "event_rosters" (
  "id", "entry_id", "source_roster_revision_id", "status", "policy_snapshot",
  "frozen_at", "frozen_by", "created_at", "updated_at"
)
SELECT event_map.event_roster_id, event_map.entry_id, revision.revision_id,
  CASE WHEN legacy.team_application_id IS NULL OR prestart.roster_confirmed_at IS NOT NULL
    THEN 'frozen'::event_roster_status ELSE 'preparing'::event_roster_status END,
  jsonb_build_object('version', 1, 'migratedFrom',
    CASE WHEN legacy.team_application_id IS NULL THEN 'season_team' ELSE 'major_prestart' END),
  CASE WHEN legacy.team_application_id IS NULL
    THEN COALESCE(season.updated_at, legacy.created_at)
    ELSE prestart.roster_confirmed_at END,
  CASE WHEN legacy.team_application_id IS NULL THEN 'migration:0017' ELSE prestart.roster_confirmed_by END,
  COALESCE(prestart.created_at, legacy.created_at), COALESCE(prestart.updated_at, legacy.created_at)
FROM "_event_roster_map" event_map
JOIN "_entry_id_map" entry_map ON entry_map.entry_id = event_map.entry_id
JOIN "_legacy_season_teams" legacy ON legacy.id = entry_map.legacy_team_id
JOIN "seasons" season ON season.id = legacy.season_id
LEFT JOIN "major_prestart_entrants" prestart ON prestart.team_id = legacy.id
JOIN "_revision_map" revision ON revision.entry_id = event_map.entry_id;--> statement-breakpoint

CREATE TEMP TABLE "_legacy_member_event_map" (
  "legacy_member_id" uuid PRIMARY KEY,
  "event_roster_member_id" uuid NOT NULL UNIQUE
) ON COMMIT DROP;--> statement-breakpoint
INSERT INTO "_legacy_member_event_map" ("legacy_member_id", "event_roster_member_id")
SELECT legacy_member.id, gen_random_uuid()
FROM "_legacy_season_team_members" legacy_member
JOIN "_legacy_season_teams" legacy ON legacy.id = legacy_member.team_id
WHERE legacy.team_application_id IS NULL;--> statement-breakpoint
INSERT INTO "event_roster_members" (
  "id", "event_roster_id", "user_id", "participant_id", "is_primary_starter", "created_at"
)
SELECT member_map.event_roster_member_id, event_map.event_roster_id,
  legacy_member.user_id, participant.id, legacy_member.is_starter, legacy_member.joined_at
FROM "_legacy_member_event_map" member_map
JOIN "_legacy_season_team_members" legacy_member ON legacy_member.id = member_map.legacy_member_id
JOIN "_entry_id_map" entry_map ON entry_map.legacy_team_id = legacy_member.team_id
JOIN "_event_roster_map" event_map ON event_map.entry_id = entry_map.entry_id
JOIN "competition_entry_participants" participant
  ON participant.entry_id = entry_map.entry_id AND participant.user_id = legacy_member.user_id;--> statement-breakpoint
INSERT INTO "event_roster_members" (
  "id", "event_roster_id", "user_id", "participant_id", "education_verification_id", "is_primary_starter", "created_at"
)
SELECT prestart_member.id, event_map.event_roster_id, prestart_member.user_id,
  participant.id, prestart_member.education_verification_id,
  COALESCE(roster_member.is_primary_starter, false), prestart_member.created_at
FROM "major_prestart_roster_members" prestart_member
JOIN "major_prestart_entrants" prestart ON prestart.id = prestart_member.entrant_id
JOIN "_entry_id_map" entry_map ON entry_map.legacy_team_id = prestart.team_id
JOIN "_event_roster_map" event_map ON event_map.entry_id = entry_map.entry_id
LEFT JOIN "competition_entry_participants" participant
  ON participant.entry_id = entry_map.entry_id AND participant.user_id = prestart_member.user_id
LEFT JOIN "_revision_map" revision ON revision.entry_id = entry_map.entry_id
LEFT JOIN "competition_entry_roster_members" roster_member
  ON roster_member.revision_id = revision.revision_id AND roster_member.user_id = prestart_member.user_id;--> statement-breakpoint

-- Canonical entrant foreign keys. Every old season-team reference passes
-- through the explicit map; no runtime table retains the old identity.
UPDATE "draft_picks" row SET "entry_id" = map.entry_id FROM "_entry_id_map" map WHERE row.team_id = map.legacy_team_id;--> statement-breakpoint
UPDATE "draft_state" row SET "current_entry_id" = map.entry_id FROM "_entry_id_map" map WHERE row.current_team_id = map.legacy_team_id;--> statement-breakpoint
UPDATE "major_prestart_entrants" row SET "competition_entry_id" = map.entry_id, "event_roster_id" = event_map.event_roster_id
FROM "_entry_id_map" map JOIN "_event_roster_map" event_map ON event_map.entry_id = map.entry_id
WHERE row.team_id = map.legacy_team_id;--> statement-breakpoint
UPDATE "major_stage_entrants" row SET "competition_entry_id" = map.entry_id FROM "_entry_id_map" map WHERE row.team_id = map.legacy_team_id;--> statement-breakpoint
UPDATE "major_final_results" row SET "champion_entry_id" = map.entry_id FROM "_entry_id_map" map WHERE row.champion_team_id = map.legacy_team_id;--> statement-breakpoint
UPDATE "matches" row SET "entry_a_id" = a.entry_id, "entry_b_id" = b.entry_id
FROM "_entry_id_map" a, "_entry_id_map" b
WHERE row.team_a_id = a.legacy_team_id AND row.team_b_id = b.legacy_team_id;--> statement-breakpoint
UPDATE "match_maps" row SET "picked_by_entry_id" = map.entry_id FROM "_entry_id_map" map WHERE row.picked_by_team_id = map.legacy_team_id;--> statement-breakpoint
UPDATE "swiss_standings" row SET "entry_id" = map.entry_id FROM "_entry_id_map" map WHERE row.team_id = map.legacy_team_id;--> statement-breakpoint
UPDATE "match_rosters" row SET "entry_id" = map.entry_id FROM "_entry_id_map" map WHERE row.team_id = map.legacy_team_id;--> statement-breakpoint
UPDATE "match_veto_steps" row SET "entry_id" = map.entry_id FROM "_entry_id_map" map WHERE row.team_id = map.legacy_team_id;--> statement-breakpoint
UPDATE "post_event_adjudications" row SET "target_entry_id" = map.entry_id FROM "_entry_id_map" map WHERE row.target_team_id = map.legacy_team_id;--> statement-breakpoint
UPDATE "tournament_honors" row SET "entry_id" = map.entry_id FROM "_entry_id_map" map WHERE row.team_id = map.legacy_team_id;--> statement-breakpoint
UPDATE "match_roster_players" player SET "event_roster_member_id" = member_map.event_roster_member_id
FROM "_legacy_member_event_map" member_map WHERE player.team_member_id = member_map.legacy_member_id;--> statement-breakpoint
UPDATE "match_roster_players" player SET "event_roster_member_id" = event_member.id
FROM "_legacy_season_team_members" legacy_member
JOIN "_entry_id_map" entry_map ON entry_map.legacy_team_id = legacy_member.team_id
JOIN "_event_roster_map" event_map ON event_map.entry_id = entry_map.entry_id
JOIN "event_roster_members" event_member
  ON event_member.event_roster_id = event_map.event_roster_id AND event_member.user_id = legacy_member.user_id
WHERE player.team_member_id = legacy_member.id AND player.event_roster_member_id IS NULL;--> statement-breakpoint

-- Rewrite only historical snapshots/projections. Runtime identities remain
-- relational foreign keys; this helper is dropped before commit.
CREATE OR REPLACE FUNCTION pg_temp.rivalhub_entry_json(value jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  result jsonb;
  pair record;
  scalar text;
  mapped uuid;
  mapped_key text;
BEGIN
  IF value IS NULL THEN RETURN NULL; END IF;
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      result := '{}'::jsonb;
      FOR pair IN SELECT key, val FROM jsonb_each(value) AS item(key, val) LOOP
        mapped_key := CASE pair.key
          WHEN 'teamId' THEN 'competitionEntryId'
          WHEN 'teamIds' THEN 'entryIds'
          WHEN 'teamAId' THEN 'entryAId'
          WHEN 'teamBId' THEN 'entryBId'
          WHEN 'championTeamId' THEN 'championEntryId'
          WHEN 'targetTeamId' THEN 'targetEntryId'
          ELSE pair.key END;
        result := result || jsonb_build_object(mapped_key, pg_temp.rivalhub_entry_json(pair.val));
      END LOOP;
      RETURN result;
    WHEN 'array' THEN
      SELECT COALESCE(jsonb_agg(pg_temp.rivalhub_entry_json(item)), '[]'::jsonb) INTO result FROM jsonb_array_elements(value) item;
      RETURN result;
    WHEN 'string' THEN
      scalar := value #>> '{}';
      IF scalar ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        SELECT entry_id INTO mapped FROM "_entry_id_map" WHERE legacy_team_id = scalar::uuid;
        IF mapped IS NOT NULL THEN RETURN to_jsonb(mapped::text); END IF;
      END IF;
      RETURN value;
    ELSE RETURN value;
  END CASE;
END $$;--> statement-breakpoint
UPDATE "major_stage_runs" SET "rule_snapshot" = pg_temp.rivalhub_entry_json("rule_snapshot");--> statement-breakpoint
UPDATE "major_final_results" SET "placement_groups" = pg_temp.rivalhub_entry_json("placement_groups");--> statement-breakpoint
UPDATE "audit_logs" SET "meta" = pg_temp.rivalhub_entry_json("meta") WHERE "meta" IS NOT NULL;--> statement-breakpoint
UPDATE "audit_logs" audit SET "target_id" = map.entry_id, "target_type" = 'competition_entry'
FROM "_entry_id_map" map WHERE audit.target_type = 'team' AND audit.target_id = map.legacy_team_id::text;--> statement-breakpoint
UPDATE "audit_logs" audit SET "target_id" = app.id::text, "target_type" = 'competition_entry'
FROM "team_applications" app WHERE audit.target_type = 'team_application' AND audit.target_id = app.id::text;--> statement-breakpoint
UPDATE "tournament_honors" honor SET "honor_key" = replace(honor.honor_key, map.legacy_team_id::text, map.entry_id::text)
FROM "_entry_id_map" map WHERE honor.honor_key LIKE '%' || map.legacy_team_id::text || '%';--> statement-breakpoint

-- Fail closed before old columns/tables are retired.
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(name, ', ') INTO missing FROM (
    SELECT 'draft_picks.entry_id' name WHERE EXISTS (SELECT 1 FROM "draft_picks" WHERE entry_id IS NULL)
    UNION ALL SELECT 'major_prestart_entrants.competition_entry_id' WHERE EXISTS (SELECT 1 FROM "major_prestart_entrants" WHERE competition_entry_id IS NULL)
    UNION ALL SELECT 'major_stage_entrants.competition_entry_id' WHERE EXISTS (SELECT 1 FROM "major_stage_entrants" WHERE competition_entry_id IS NULL)
    UNION ALL SELECT 'major_final_results.champion_entry_id' WHERE EXISTS (SELECT 1 FROM "major_final_results" WHERE champion_entry_id IS NULL)
    UNION ALL SELECT 'matches.entry ids' WHERE EXISTS (SELECT 1 FROM "matches" WHERE entry_a_id IS NULL OR entry_b_id IS NULL)
    UNION ALL SELECT 'swiss_standings.entry_id' WHERE EXISTS (SELECT 1 FROM "swiss_standings" WHERE entry_id IS NULL)
    UNION ALL SELECT 'match_rosters.entry_id' WHERE EXISTS (SELECT 1 FROM "match_rosters" WHERE entry_id IS NULL)
    UNION ALL SELECT 'match_roster_players.event_roster_member_id' WHERE EXISTS (SELECT 1 FROM "match_roster_players" WHERE event_roster_member_id IS NULL)
  ) failures;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'CompetitionEntry migration has unmapped canonical facts: %', missing; END IF;
END $$;--> statement-breakpoint

ALTER TABLE "draft_picks" ALTER COLUMN "entry_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "major_prestart_entrants" ALTER COLUMN "competition_entry_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "major_final_results" ALTER COLUMN "champion_entry_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "major_stage_entrants" ALTER COLUMN "competition_entry_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "entry_a_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "entry_b_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "swiss_standings" ALTER COLUMN "entry_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "match_roster_players" ALTER COLUMN "event_roster_member_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "match_rosters" ALTER COLUMN "entry_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_competition_id_seasons_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_source_registration_id_season_registrations_id_fk" FOREIGN KEY ("source_registration_id") REFERENCES "public"."season_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_representative_user_id_users_id_fk" FOREIGN KEY ("representative_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entry_active_claims" ADD CONSTRAINT "competition_entry_active_claims_competition_id_seasons_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entry_active_claims" ADD CONSTRAINT "competition_entry_active_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entry_active_claims" ADD CONSTRAINT "competition_entry_active_claims_entry_id_competition_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entry_active_claims" ADD CONSTRAINT "competition_entry_active_claims_participant_id_competition_entry_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."competition_entry_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entry_legacy_identities" ADD CONSTRAINT "competition_entry_legacy_identities_entry_id_competition_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entry_participants" ADD CONSTRAINT "competition_entry_participants_entry_id_competition_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entry_participants" ADD CONSTRAINT "competition_entry_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entry_participants" ADD CONSTRAINT "competition_entry_participants_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entry_representative_tenures" ADD CONSTRAINT "competition_entry_representative_tenures_entry_id_competition_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entry_representative_tenures" ADD CONSTRAINT "competition_entry_representative_tenures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entry_roster_members" ADD CONSTRAINT "competition_entry_roster_members_revision_id_competition_entry_roster_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."competition_entry_roster_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entry_roster_members" ADD CONSTRAINT "competition_entry_roster_members_participant_id_competition_entry_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."competition_entry_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entry_roster_members" ADD CONSTRAINT "competition_entry_roster_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entry_roster_members" ADD CONSTRAINT "competition_entry_roster_members_team_membership_id_team_memberships_id_fk" FOREIGN KEY ("team_membership_id") REFERENCES "public"."team_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entry_roster_revisions" ADD CONSTRAINT "competition_entry_roster_revisions_entry_id_competition_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entry_submissions" ADD CONSTRAINT "competition_entry_submissions_entry_id_competition_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entry_submissions" ADD CONSTRAINT "competition_entry_submissions_roster_revision_id_competition_entry_roster_revisions_id_fk" FOREIGN KEY ("roster_revision_id") REFERENCES "public"."competition_entry_roster_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_roster_members" ADD CONSTRAINT "event_roster_members_event_roster_id_event_rosters_id_fk" FOREIGN KEY ("event_roster_id") REFERENCES "public"."event_rosters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_roster_members" ADD CONSTRAINT "event_roster_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_roster_members" ADD CONSTRAINT "event_roster_members_participant_id_competition_entry_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."competition_entry_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_roster_members" ADD CONSTRAINT "event_roster_members_education_verification_id_education_verifications_id_fk" FOREIGN KEY ("education_verification_id") REFERENCES "public"."education_verifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rosters" ADD CONSTRAINT "event_rosters_entry_id_competition_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rosters" ADD CONSTRAINT "event_rosters_source_roster_revision_id_competition_entry_roster_revisions_id_fk" FOREIGN KEY ("source_roster_revision_id") REFERENCES "public"."competition_entry_roster_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_competitive_roles" ADD CONSTRAINT "user_competitive_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_captain_tenures" ADD CONSTRAINT "team_captain_tenures_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_captain_tenures" ADD CONSTRAINT "team_captain_tenures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_invited_user_id_users_id_fk" FOREIGN KEY ("invited_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_responded_by_user_id_users_id_fk" FOREIGN KEY ("responded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_name_history" ADD CONSTRAINT "team_name_history_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_slug_aliases" ADD CONSTRAINT "team_slug_aliases_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competition_entries_competition_status_idx" ON "competition_entries" USING btree ("competition_id","registration_status");--> statement-breakpoint
CREATE INDEX "competition_entries_team_history_idx" ON "competition_entries" USING btree ("team_id","competition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competition_entries_legacy_source_unique" ON "competition_entries" USING btree ("legacy_source_type","legacy_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competition_entries_one_effective_team_per_competition" ON "competition_entries" USING btree ("competition_id","team_id") WHERE "competition_entries"."team_id" IS NOT NULL AND "competition_entries"."registration_status" NOT IN ('rejected', 'withdrawn');--> statement-breakpoint
CREATE UNIQUE INDEX "competition_entries_competition_formation_order_unique" ON "competition_entries" USING btree ("competition_id","formation_order") WHERE "competition_entries"."formation_order" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "competition_entry_active_claims_entry_idx" ON "competition_entry_active_claims" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "competition_entry_legacy_identities_entry_idx" ON "competition_entry_legacy_identities" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "competition_entry_participants_user_status_idx" ON "competition_entry_participants" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "competition_entry_representative_one_current" ON "competition_entry_representative_tenures" USING btree ("entry_id") WHERE "competition_entry_representative_tenures"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "event_roster_members_roster_idx" ON "event_roster_members" USING btree ("event_roster_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_competitive_roles_one_primary_per_user" ON "user_competitive_roles" USING btree ("user_id") WHERE "user_competitive_roles"."is_primary";--> statement-breakpoint
CREATE INDEX "user_competitive_roles_user_idx" ON "user_competitive_roles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_captain_tenures_one_current_per_team" ON "team_captain_tenures" USING btree ("team_id") WHERE "team_captain_tenures"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "team_invitations_team_status_idx" ON "team_invitations" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "team_invitations_user_status_idx" ON "team_invitations" USING btree ("invited_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "team_invitations_token_hash_unique" ON "team_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "team_memberships_team_idx" ON "team_memberships" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_memberships_user_idx" ON "team_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_memberships_one_current_period" ON "team_memberships" USING btree ("team_id","user_id") WHERE "team_memberships"."ended_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "team_memberships_one_active_team_per_user" ON "team_memberships" USING btree ("user_id") WHERE "team_memberships"."ended_at" IS NULL AND "team_memberships"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "team_memberships_one_current_captain_per_team" ON "team_memberships" USING btree ("team_id") WHERE "team_memberships"."ended_at" IS NULL AND "team_memberships"."role" = 'captain';--> statement-breakpoint
CREATE UNIQUE INDEX "team_memberships_one_current_captaincy_per_user" ON "team_memberships" USING btree ("user_id") WHERE "team_memberships"."ended_at" IS NULL AND "team_memberships"."role" = 'captain';--> statement-breakpoint
CREATE UNIQUE INDEX "team_name_history_one_current_per_team" ON "team_name_history" USING btree ("team_id") WHERE "team_name_history"."ended_at" IS NULL;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_entry_id_competition_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_state" ADD CONSTRAINT "draft_state_current_entry_id_competition_entries_id_fk" FOREIGN KEY ("current_entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_captain_user_id_users_id_fk" FOREIGN KEY ("captain_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_prestart_entrants" ADD CONSTRAINT "major_prestart_entrants_competition_entry_id_competition_entries_id_fk" FOREIGN KEY ("competition_entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_prestart_entrants" ADD CONSTRAINT "major_prestart_entrants_event_roster_id_event_rosters_id_fk" FOREIGN KEY ("event_roster_id") REFERENCES "public"."event_rosters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_final_results" ADD CONSTRAINT "major_final_results_champion_entry_id_competition_entries_id_fk" FOREIGN KEY ("champion_entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_stage_entrants" ADD CONSTRAINT "major_stage_entrants_competition_entry_id_competition_entries_id_fk" FOREIGN KEY ("competition_entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_entry_a_id_competition_entries_id_fk" FOREIGN KEY ("entry_a_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_entry_b_id_competition_entries_id_fk" FOREIGN KEY ("entry_b_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_maps" ADD CONSTRAINT "match_maps_picked_by_entry_id_competition_entries_id_fk" FOREIGN KEY ("picked_by_entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swiss_standings" ADD CONSTRAINT "swiss_standings_entry_id_competition_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_roster_players" ADD CONSTRAINT "match_roster_players_event_roster_member_id_event_roster_members_id_fk" FOREIGN KEY ("event_roster_member_id") REFERENCES "public"."event_roster_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_rosters" ADD CONSTRAINT "match_rosters_entry_id_competition_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_veto_steps" ADD CONSTRAINT "match_veto_steps_entry_id_competition_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_event_adjudications" ADD CONSTRAINT "post_event_adjudications_target_entry_id_competition_entries_id_fk" FOREIGN KEY ("target_entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_honors" ADD CONSTRAINT "tournament_honors_entry_id_competition_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_slug_unique" ON "teams" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_one_active_captaincy_per_user" ON "teams" USING btree ("captain_user_id") WHERE "teams"."status" = 'active';--> statement-breakpoint
CREATE INDEX "matches_entry_a_id_idx" ON "matches" USING btree ("entry_a_id");--> statement-breakpoint
CREATE INDEX "matches_entry_b_id_idx" ON "matches" USING btree ("entry_b_id");--> statement-breakpoint
ALTER TABLE "draft_picks" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "draft_state" DROP COLUMN "current_team_id";--> statement-breakpoint
ALTER TABLE "major_prestart_entrants" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "major_final_results" DROP COLUMN "champion_team_id";--> statement-breakpoint
ALTER TABLE "major_stage_entrants" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN "team_a_id";--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN "team_b_id";--> statement-breakpoint
ALTER TABLE "match_maps" DROP COLUMN "picked_by_team_id";--> statement-breakpoint
ALTER TABLE "swiss_standings" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "match_roster_players" DROP COLUMN "team_member_id";--> statement-breakpoint
ALTER TABLE "match_rosters" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "match_veto_steps" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "post_event_adjudications" DROP COLUMN "target_team_id";--> statement-breakpoint
ALTER TABLE "tournament_honors" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "major_prestart_entrants" ADD CONSTRAINT "major_prestart_entrants_season_entry_unique" UNIQUE("season_id","competition_entry_id");--> statement-breakpoint
ALTER TABLE "major_prestart_entrants" ADD CONSTRAINT "major_prestart_entrants_event_roster_unique" UNIQUE("event_roster_id");--> statement-breakpoint
ALTER TABLE "major_stage_entrants" ADD CONSTRAINT "major_stage_entrants_run_entry_unique" UNIQUE("stage_run_id","competition_entry_id");--> statement-breakpoint
ALTER TABLE "swiss_standings" ADD CONSTRAINT "swiss_standings_season_id_stage_entry_id_unique" UNIQUE("season_id","stage","entry_id");--> statement-breakpoint
ALTER TABLE "match_roster_players" ADD CONSTRAINT "match_roster_players_roster_id_event_roster_member_id_unique" UNIQUE("roster_id","event_roster_member_id");--> statement-breakpoint
ALTER TABLE "match_rosters" ADD CONSTRAINT "match_rosters_match_id_entry_id_unique" UNIQUE("match_id","entry_id");--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_entries_different" CHECK ("matches"."entry_a_id" != "matches"."entry_b_id");--> statement-breakpoint
ALTER TABLE "post_event_adjudications" ADD CONSTRAINT "post_event_adjudications_target_check" CHECK (("post_event_adjudications"."target" = 'season' AND "post_event_adjudications"."target_entry_id" IS NULL AND "post_event_adjudications"."target_user_id" IS NULL AND "post_event_adjudications"."target_match_id" IS NULL)
      OR ("post_event_adjudications"."target" = 'entry' AND "post_event_adjudications"."target_entry_id" IS NOT NULL AND "post_event_adjudications"."target_user_id" IS NULL AND "post_event_adjudications"."target_match_id" IS NULL)
      OR ("post_event_adjudications"."target" = 'user' AND "post_event_adjudications"."target_entry_id" IS NULL AND "post_event_adjudications"."target_user_id" IS NOT NULL AND "post_event_adjudications"."target_match_id" IS NULL)
      OR ("post_event_adjudications"."target" = 'match' AND "post_event_adjudications"."target_entry_id" IS NULL AND "post_event_adjudications"."target_user_id" IS NULL AND "post_event_adjudications"."target_match_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "tournament_honors" ADD CONSTRAINT "tournament_honors_recipient_check" CHECK (("tournament_honors"."state" IN ('valid', 'revoked') AND (("tournament_honors"."entry_id" IS NOT NULL)::int + ("tournament_honors"."user_id" IS NOT NULL)::int) = 1)
      OR ("tournament_honors"."state" IN ('vacant', 'not_awarded') AND "tournament_honors"."entry_id" IS NULL AND "tournament_honors"."user_id" IS NULL));--> statement-breakpoint
ALTER TABLE "_legacy_season_team_members" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_application_active_claims" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_application_members" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_applications" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "major_prestart_roster_members" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "major_prestart_roster_members" CASCADE;--> statement-breakpoint
DROP TABLE "_legacy_season_team_members" CASCADE;--> statement-breakpoint
DROP TABLE "_legacy_season_teams" CASCADE;--> statement-breakpoint
DROP TABLE "team_application_active_claims" CASCADE;--> statement-breakpoint
DROP TABLE "team_application_members" CASCADE;--> statement-breakpoint
DROP TABLE "team_applications" CASCADE;--> statement-breakpoint

ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_captain_tenures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_name_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_slug_aliases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "competition_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "competition_entry_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "competition_entry_active_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "competition_entry_roster_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "competition_entry_roster_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "competition_entry_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "competition_entry_representative_tenures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "competition_entry_legacy_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_rosters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_roster_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_competitive_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "teams", "team_memberships", "team_captain_tenures", "team_name_history",
  "team_slug_aliases", "team_invitations", "competition_entries", "competition_entry_participants",
  "competition_entry_active_claims", "competition_entry_roster_revisions", "competition_entry_roster_members",
  "competition_entry_submissions", "competition_entry_representative_tenures",
  "competition_entry_legacy_identities", "event_rosters", "event_roster_members", "user_competitive_roles"
FROM anon, authenticated;--> statement-breakpoint

DROP TYPE "public"."team_application_member_status";--> statement-breakpoint
DROP TYPE "public"."team_application_status";
