CREATE TYPE "public"."match_veto_step_source" AS ENUM('participant', 'admin', 'timeout', 'system');--> statement-breakpoint
CREATE TYPE "public"."match_veto_appeal_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."match_veto_resolution_scope" AS ENUM('platform_or_organizer', 'participant_or_unverified');--> statement-breakpoint
CREATE TABLE "match_veto_appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timeout_incident_id" uuid NOT NULL,
	"submitted_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "match_veto_appeal_status" DEFAULT 'pending' NOT NULL,
	"resolution_scope" "match_veto_resolution_scope",
	"resolved_by" uuid,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "match_veto_appeals_reason_check" CHECK (length(btrim("match_veto_appeals"."reason")) > 0),
	CONSTRAINT "match_veto_appeals_resolution_shape_check" CHECK (("match_veto_appeals"."status" = 'pending' AND "match_veto_appeals"."resolution_scope" IS NULL AND "match_veto_appeals"."resolved_by" IS NULL AND "match_veto_appeals"."resolved_at" IS NULL)
      OR ("match_veto_appeals"."status" <> 'pending' AND "match_veto_appeals"."resolution_scope" IS NOT NULL AND "match_veto_appeals"."resolved_by" IS NOT NULL AND "match_veto_appeals"."resolved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "match_veto_sessions" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"privileged_entry_id" uuid,
	"veto_team_a_entry_id" uuid,
	"entry_a_start_requested_at" timestamp with time zone,
	"entry_a_start_requested_by" uuid,
	"entry_b_start_requested_at" timestamp with time zone,
	"entry_b_start_requested_by" uuid,
	"map_pool_snapshot" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"current_turn_key" text,
	"turn_started_at" timestamp with time zone,
	"turn_deadline_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"paused_by" uuid,
	"pause_reason" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_veto_sessions_revision_check" CHECK ("match_veto_sessions"."revision" >= 0),
	CONSTRAINT "match_veto_sessions_entry_a_request_shape_check" CHECK (("match_veto_sessions"."entry_a_start_requested_at" IS NULL) = ("match_veto_sessions"."entry_a_start_requested_by" IS NULL)),
	CONSTRAINT "match_veto_sessions_entry_b_request_shape_check" CHECK (("match_veto_sessions"."entry_b_start_requested_at" IS NULL) = ("match_veto_sessions"."entry_b_start_requested_by" IS NULL)),
	CONSTRAINT "match_veto_sessions_pause_shape_check" CHECK (("match_veto_sessions"."paused_at" IS NULL AND "match_veto_sessions"."paused_by" IS NULL AND "match_veto_sessions"."pause_reason" IS NULL)
      OR ("match_veto_sessions"."paused_at" IS NOT NULL AND "match_veto_sessions"."paused_by" IS NOT NULL AND "match_veto_sessions"."pause_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "match_veto_timeout_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"turn_key" text NOT NULL,
	"entry_id" uuid,
	"representative_user_id" uuid,
	"deadline_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone NOT NULL,
	"eligible_options" jsonb NOT NULL,
	"selected_options" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_roster_players" ADD COLUMN "is_veto_representative" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "match_veto_steps" ADD COLUMN "source" "match_veto_step_source";--> statement-breakpoint
ALTER TABLE "match_veto_steps" ADD COLUMN "actor_user_id" uuid;--> statement-breakpoint
ALTER TABLE "match_veto_steps" ADD COLUMN "client_request_id" text;--> statement-breakpoint
ALTER TABLE "match_veto_steps" ADD COLUMN "turn_key" text;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new appeal table is empty when its timeout reference is validated
ALTER TABLE "match_veto_appeals" ADD CONSTRAINT "match_veto_appeals_timeout_incident_id_match_veto_timeout_incidents_id_fk" FOREIGN KEY ("timeout_incident_id") REFERENCES "public"."match_veto_timeout_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new appeal table is empty when its submitter reference is validated
ALTER TABLE "match_veto_appeals" ADD CONSTRAINT "match_veto_appeals_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new appeal table is empty when its resolver reference is validated
ALTER TABLE "match_veto_appeals" ADD CONSTRAINT "match_veto_appeals_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new session table is empty when its match reference is validated
ALTER TABLE "match_veto_sessions" ADD CONSTRAINT "match_veto_sessions_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new session table is empty when its privileged entry reference is validated
ALTER TABLE "match_veto_sessions" ADD CONSTRAINT "match_veto_sessions_privileged_entry_id_competition_entries_id_fk" FOREIGN KEY ("privileged_entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new session table is empty when its veto team reference is validated
ALTER TABLE "match_veto_sessions" ADD CONSTRAINT "match_veto_sessions_veto_team_a_entry_id_competition_entries_id_fk" FOREIGN KEY ("veto_team_a_entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new session table is empty when its first requester reference is validated
ALTER TABLE "match_veto_sessions" ADD CONSTRAINT "match_veto_sessions_entry_a_start_requested_by_users_id_fk" FOREIGN KEY ("entry_a_start_requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new session table is empty when its second requester reference is validated
ALTER TABLE "match_veto_sessions" ADD CONSTRAINT "match_veto_sessions_entry_b_start_requested_by_users_id_fk" FOREIGN KEY ("entry_b_start_requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new session table is empty when its pauser reference is validated
ALTER TABLE "match_veto_sessions" ADD CONSTRAINT "match_veto_sessions_paused_by_users_id_fk" FOREIGN KEY ("paused_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new timeout incident table is empty when its match reference is validated
ALTER TABLE "match_veto_timeout_incidents" ADD CONSTRAINT "match_veto_timeout_incidents_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new timeout incident table is empty when its entry reference is validated
ALTER TABLE "match_veto_timeout_incidents" ADD CONSTRAINT "match_veto_timeout_incidents_entry_id_competition_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new timeout incident table is empty when its representative reference is validated
ALTER TABLE "match_veto_timeout_incidents" ADD CONSTRAINT "match_veto_timeout_incidents_representative_user_id_users_id_fk" FOREIGN KEY ("representative_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed pending appeals index is built on the new empty table
CREATE UNIQUE INDEX "match_veto_appeals_one_pending_per_incident" ON "match_veto_appeals" USING btree ("timeout_incident_id") WHERE "match_veto_appeals"."status" = 'pending';--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed active deadline index is built on the new empty session table
CREATE INDEX "match_veto_sessions_active_deadline_idx" ON "match_veto_sessions" USING btree ("turn_deadline_at") WHERE "match_veto_sessions"."started_at" IS NOT NULL AND "match_veto_sessions"."completed_at" IS NULL AND "match_veto_sessions"."paused_at" IS NULL;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed timeout incident index is built on the new empty table
CREATE INDEX "match_veto_timeout_incidents_match_created_idx" ON "match_veto_timeout_incidents" USING btree ("match_id","created_at");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed actor reference is NULL for every legacy veto step after the nullable column addition
ALTER TABLE "match_veto_steps" ADD CONSTRAINT "match_veto_steps_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new representative flag defaults false so this partial index has no legacy entries
CREATE UNIQUE INDEX "match_roster_players_one_veto_representative_per_roster" ON "match_roster_players" USING btree ("roster_id") WHERE "match_roster_players"."is_veto_representative";--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new nullable request id is NULL for every legacy veto step
CREATE UNIQUE INDEX "match_veto_steps_match_client_request_unique" ON "match_veto_steps" USING btree ("match_id","client_request_id") WHERE "match_veto_steps"."client_request_id" IS NOT NULL;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed additive representative check validates existing rows with the false default
ALTER TABLE "match_roster_players" ADD CONSTRAINT "match_roster_players_veto_representative_is_starter_check" CHECK (NOT "match_roster_players"."is_veto_representative" OR "match_roster_players"."is_starter");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed nullable provenance fields let all legacy veto step rows satisfy the new check
ALTER TABLE "match_veto_steps" ADD CONSTRAINT "match_veto_steps_source_actor_shape_check" CHECK ("match_veto_steps"."source" IS NULL
        OR ("match_veto_steps"."source" IN ('participant', 'admin') AND "match_veto_steps"."actor_user_id" IS NOT NULL)
        OR ("match_veto_steps"."source" IN ('timeout', 'system') AND "match_veto_steps"."actor_user_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "match_veto_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "match_veto_timeout_incidents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "match_veto_appeals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "match_veto_sessions", "match_veto_timeout_incidents", "match_veto_appeals" FROM anon, authenticated;
--> statement-breakpoint
DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT unnest(ARRAY[
      'match_veto_appeals',
      'match_veto_sessions',
      'match_veto_timeout_incidents'
    ]::text[])
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_publication AS publication
      JOIN pg_publication_rel AS publication_relation
        ON publication_relation.prpubid = publication.oid
      JOIN pg_class AS table_object
        ON table_object.oid = publication_relation.prrelid
      JOIN pg_namespace AS table_schema
        ON table_schema.oid = table_object.relnamespace
      WHERE publication.pubname = 'supabase_realtime'
        AND table_schema.nspname = 'public'
        AND table_object.relname = table_name
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION %I DROP TABLE %I.%I',
        'supabase_realtime',
        'public',
        table_name
      );
    END IF;
  END LOOP;
END $$;
