CREATE TYPE "public"."dak_pairing_intent_status" AS ENUM('pending', 'authorized', 'expired');--> statement-breakpoint
CREATE TYPE "public"."dak_pairing_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."demo_economy_type" AS ENUM('pistol', 'eco', 'semi', 'force', 'full');--> statement-breakpoint
CREATE TYPE "public"."demo_round_phase" AS ENUM('regulation', 'overtime');--> statement-breakpoint
CREATE TYPE "public"."match_demo_import_status" AS ENUM('pending', 'confirmed', 'rejected', 'stale', 'superseded', 'needs_attention');--> statement-breakpoint
CREATE TABLE "dak_pairing_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_token_hash" text NOT NULL,
	"status" "dak_pairing_intent_status" DEFAULT 'pending' NOT NULL,
	"authorized_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"authorized_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dak_pairing_intents_poll_token_hash_unique" UNIQUE("poll_token_hash"),
	CONSTRAINT "dak_pairing_intents_status_shape_check" CHECK (("dak_pairing_intents"."status" = 'pending' AND "dak_pairing_intents"."authorized_by_user_id" IS NULL AND "dak_pairing_intents"."authorized_at" IS NULL)
      OR ("dak_pairing_intents"."status" = 'authorized' AND "dak_pairing_intents"."authorized_by_user_id" IS NOT NULL AND "dak_pairing_intents"."authorized_at" IS NOT NULL)
      OR ("dak_pairing_intents"."status" = 'expired'))
);
--> statement-breakpoint
CREATE TABLE "dak_pairings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pairing_intent_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"season_ids" text[] NOT NULL,
	"status" "dak_pairing_status" DEFAULT 'active' NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dak_pairings_pairing_intent_id_unique" UNIQUE("pairing_intent_id"),
	CONSTRAINT "dak_pairings_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "dak_pairings_status_shape_check" CHECK (("dak_pairings"."status" = 'active' AND "dak_pairings"."revoked_at" IS NULL) OR ("dak_pairings"."status" = 'revoked' AND "dak_pairings"."revoked_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "match_demo_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"match_map_id" uuid NOT NULL,
	"stage_key" text NOT NULL,
	"stage_run_id" uuid,
	"demo_sha256" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"contract_version" text NOT NULL,
	"semantic_profile" text NOT NULL,
	"analysis_version" text NOT NULL,
	"evidence_revision" text NOT NULL,
	"status" "match_demo_import_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"submitted_by_pairing_id" uuid NOT NULL,
	"idempotency_key" text,
	"supersedes_import_id" uuid,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_demo_imports_map_payload_unique" UNIQUE("match_map_id","payload_sha256"),
	CONSTRAINT "match_demo_imports_sha_shape_check" CHECK ("match_demo_imports"."demo_sha256" ~ '^[a-f0-9]{64}$' AND "match_demo_imports"."payload_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "match_demo_imports_contract_shape_check" CHECK ("match_demo_imports"."contract_version" = 'rivalhub-demo-evidence/1')
);
--> statement-breakpoint
CREATE TABLE "match_round_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"round_seq" integer NOT NULL,
	"source_round_number" integer NOT NULL,
	"phase" "demo_round_phase" NOT NULL,
	"start_tick" integer NOT NULL,
	"freeze_end_tick" integer NOT NULL,
	"end_tick" integer NOT NULL,
	"team_a_side" "side" NOT NULL,
	"team_b_side" "side" NOT NULL,
	"team_a_score_before" integer NOT NULL,
	"team_b_score_before" integer NOT NULL,
	"team_a_economy" "demo_economy_type" NOT NULL,
	"team_b_economy" "demo_economy_type" NOT NULL,
	"winner_team_key" text NOT NULL,
	"winner_side" "side" NOT NULL,
	"end_reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_round_facts_import_round_unique" UNIQUE("import_id","round_seq"),
	CONSTRAINT "match_round_facts_positive_round_check" CHECK ("match_round_facts"."round_seq" > 0 AND "match_round_facts"."source_round_number" > 0),
	CONSTRAINT "match_round_facts_nonnegative_ticks_check" CHECK ("match_round_facts"."start_tick" >= 0 AND "match_round_facts"."freeze_end_tick" >= 0 AND "match_round_facts"."end_tick" >= 0),
	CONSTRAINT "match_round_facts_winner_shape_check" CHECK ("match_round_facts"."winner_team_key" IN ('teamA', 'teamB'))
);
--> statement-breakpoint
ALTER TABLE "match_player_stats" ADD COLUMN "first_deaths" integer;--> statement-breakpoint
ALTER TABLE "match_player_stats" ADD COLUMN "trade_kills" integer;--> statement-breakpoint
ALTER TABLE "match_player_stats" ADD COLUMN "kast_rounds" integer;--> statement-breakpoint
ALTER TABLE "match_player_stats" ADD COLUMN "dak_import_id" uuid;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new pairing intent table is empty at creation
ALTER TABLE "dak_pairing_intents" ADD CONSTRAINT "dak_pairing_intents_authorized_by_user_id_users_id_fk" FOREIGN KEY ("authorized_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new pairing table is empty at creation
ALTER TABLE "dak_pairings" ADD CONSTRAINT "dak_pairings_pairing_intent_id_dak_pairing_intents_id_fk" FOREIGN KEY ("pairing_intent_id") REFERENCES "public"."dak_pairing_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new pairing table is empty at creation
ALTER TABLE "dak_pairings" ADD CONSTRAINT "dak_pairings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new Demo import table is empty at creation
ALTER TABLE "match_demo_imports" ADD CONSTRAINT "match_demo_imports_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new Demo import table is empty at creation
ALTER TABLE "match_demo_imports" ADD CONSTRAINT "match_demo_imports_match_map_id_match_maps_id_fk" FOREIGN KEY ("match_map_id") REFERENCES "public"."match_maps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new Demo import table is empty at creation
ALTER TABLE "match_demo_imports" ADD CONSTRAINT "match_demo_imports_submitted_by_pairing_id_dak_pairings_id_fk" FOREIGN KEY ("submitted_by_pairing_id") REFERENCES "public"."dak_pairings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new round fact table is empty at creation
ALTER TABLE "match_round_facts" ADD CONSTRAINT "match_round_facts_import_id_match_demo_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."match_demo_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new pairing intent table is empty at creation
CREATE INDEX "dak_pairing_intents_expires_at_idx" ON "dak_pairing_intents" USING btree ("expires_at");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new pairing table is empty at creation
CREATE INDEX "dak_pairings_user_id_idx" ON "dak_pairings" USING btree ("user_id");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new Demo import table is empty at creation
CREATE UNIQUE INDEX "match_demo_imports_idempotency_key_unique" ON "match_demo_imports" USING btree ("idempotency_key") WHERE "match_demo_imports"."idempotency_key" IS NOT NULL;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new Demo import table is empty at creation
CREATE INDEX "match_demo_imports_map_created_at_idx" ON "match_demo_imports" USING btree ("match_map_id","created_at");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new Demo import table is empty at creation
CREATE INDEX "match_demo_imports_season_status_idx" ON "match_demo_imports" USING btree ("season_id","status");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new round fact table is empty at creation
CREATE INDEX "match_round_facts_import_id_idx" ON "match_round_facts" USING btree ("import_id");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed the new DAK projection reference is nullable for all existing stats rows
ALTER TABLE "match_player_stats" ADD CONSTRAINT "match_player_stats_dak_import_id_match_demo_imports_id_fk" FOREIGN KEY ("dak_import_id") REFERENCES "public"."match_demo_imports"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Issue #641: DAK pairing and Demo evidence tables remain server-only.
-- Keep the browser Data API denied, add RLS as defense in depth, and remove
-- any accidental Realtime membership from the active publication.
REVOKE ALL PRIVILEGES ON TABLE "dak_pairing_intents", "dak_pairings", "match_demo_imports", "match_round_facts" FROM anon, authenticated;
--> statement-breakpoint
ALTER TABLE "dak_pairing_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dak_pairings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "match_demo_imports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "match_round_facts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT unnest(ARRAY[
      'dak_pairing_intents',
      'dak_pairings',
      'match_demo_imports',
      'match_round_facts'
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
