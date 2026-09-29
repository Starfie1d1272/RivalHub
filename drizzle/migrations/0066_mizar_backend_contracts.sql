CREATE TYPE "public"."mizar_pairing_intent_status" AS ENUM('pending', 'authorized', 'expired');--> statement-breakpoint
CREATE TABLE "match_live_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"producer_instance_id" text NOT NULL,
	"live_session_id" text NOT NULL,
	"context_revision" text NOT NULL,
	"authority_revision" integer NOT NULL,
	"program_source_generation" integer NOT NULL,
	"map_epoch" integer NOT NULL,
	"last_reliable_seq" integer DEFAULT -1 NOT NULL,
	"last_reliable_event_at" timestamp with time zone,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"identity_health" text DEFAULT 'unknown' NOT NULL,
	"lineup_health" text DEFAULT 'unknown' NOT NULL,
	"continuity_health" text DEFAULT 'unknown' NOT NULL,
	"auto_canonicalization_armed" boolean DEFAULT false NOT NULL,
	"manual_takeover_map_epoch" integer,
	"current_map_id" uuid,
	"map_execution_phase" text DEFAULT 'waiting' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mizar_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"pairing_intent_id" uuid NOT NULL,
	"authorized_by_user_id" uuid NOT NULL,
	"credential_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "mizar_installations_pairing_intent_id_unique" UNIQUE("pairing_intent_id"),
	CONSTRAINT "mizar_installations_credential_hash_unique" UNIQUE("credential_hash")
);
--> statement-breakpoint
CREATE TABLE "mizar_pairing_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_token_hash" text NOT NULL,
	"status" "mizar_pairing_intent_status" DEFAULT 'pending' NOT NULL,
	"competition_id" uuid,
	"authorized_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"authorized_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mizar_pairing_intents_poll_token_hash_unique" UNIQUE("poll_token_hash"),
	CONSTRAINT "mizar_pairing_intents_status_shape_check" CHECK (("mizar_pairing_intents"."status" = 'pending' AND "mizar_pairing_intents"."competition_id" IS NULL AND "mizar_pairing_intents"."authorized_by_user_id" IS NULL AND "mizar_pairing_intents"."authorized_at" IS NULL) OR ("mizar_pairing_intents"."status" = 'authorized' AND "mizar_pairing_intents"."competition_id" IS NOT NULL AND "mizar_pairing_intents"."authorized_by_user_id" IS NOT NULL AND "mizar_pairing_intents"."authorized_at" IS NOT NULL) OR ("mizar_pairing_intents"."status" = 'expired'))
);
--> statement-breakpoint
CREATE TABLE "mizar_reliable_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"event_hash" text NOT NULL,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "logo_url" text;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive constraint on a newly created empty table.
ALTER TABLE "match_live_sessions" ADD CONSTRAINT "match_live_sessions_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive constraint on a newly created empty table.
ALTER TABLE "match_live_sessions" ADD CONSTRAINT "match_live_sessions_installation_id_mizar_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."mizar_installations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive constraint on a newly created empty table.
ALTER TABLE "mizar_installations" ADD CONSTRAINT "mizar_installations_competition_id_seasons_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive constraint on a newly created empty table.
ALTER TABLE "mizar_installations" ADD CONSTRAINT "mizar_installations_pairing_intent_id_mizar_pairing_intents_id_fk" FOREIGN KEY ("pairing_intent_id") REFERENCES "public"."mizar_pairing_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive constraint on a newly created empty table.
ALTER TABLE "mizar_installations" ADD CONSTRAINT "mizar_installations_authorized_by_user_id_users_id_fk" FOREIGN KEY ("authorized_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive constraint on a newly created empty table.
ALTER TABLE "mizar_pairing_intents" ADD CONSTRAINT "mizar_pairing_intents_competition_id_seasons_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive constraint on a newly created empty table.
ALTER TABLE "mizar_pairing_intents" ADD CONSTRAINT "mizar_pairing_intents_authorized_by_user_id_users_id_fk" FOREIGN KEY ("authorized_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive constraint on a newly created empty table.
ALTER TABLE "mizar_reliable_receipts" ADD CONSTRAINT "mizar_reliable_receipts_session_id_match_live_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."match_live_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive index on a newly created empty table.
CREATE UNIQUE INDEX "match_one_active_live_source" ON "match_live_sessions" USING btree ("match_id") WHERE "match_live_sessions"."closed_at" IS NULL;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive index on a newly created empty table.
CREATE INDEX "mizar_pairing_intents_expires_at_idx" ON "mizar_pairing_intents" USING btree ("expires_at");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive index on a newly created empty table.
CREATE UNIQUE INDEX "mizar_reliable_receipt_dedupe" ON "mizar_reliable_receipts" USING btree ("session_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "match_live_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON "match_live_sessions" FROM anon, authenticated;--> statement-breakpoint
ALTER TABLE "mizar_installations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON "mizar_installations" FROM anon, authenticated;--> statement-breakpoint
ALTER TABLE "mizar_pairing_intents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON "mizar_pairing_intents" FROM anon, authenticated;--> statement-breakpoint
ALTER TABLE "mizar_reliable_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON "mizar_reliable_receipts" FROM anon, authenticated;--> statement-breakpoint
-- Receive-only private Broadcast: a live-viewer JWT can only subscribe to its own
-- match topic. No INSERT policy exists, so a browser cannot publish a trusted frame.
DO $$ BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    EXECUTE $policy$
      CREATE POLICY rivalhub_match_live_receive ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        extension = 'broadcast'
        AND (select auth.jwt() ->> 'scope') = 'live-viewer'
        AND (select auth.jwt() ->> 'matchId') = substring((select realtime.topic()) from '^match-live:([0-9a-f-]{36})$')
      )
    $policy$;
  END IF;
END $$;
