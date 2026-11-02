CREATE TYPE "public"."identity_link_request_status" AS ENUM('pending', 'completed', 'merge_required', 'blocked', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_identity_kind" AS ENUM('email', 'auth', 'oauth', 'external');--> statement-breakpoint
CREATE TYPE "public"."user_identity_link_provenance" AS ENUM('signup_confirmation', 'existing_account_reverification', 'user_verified_link', 'merge', 'admin_migration');--> statement-breakpoint
CREATE TYPE "public"."user_identity_status" AS ENUM('active', 'revoked', 'retired');--> statement-breakpoint
CREATE TYPE "public"."user_merge_authorization_status" AS ENUM('available', 'consumed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_merge_evidence_class" AS ENUM('dual_identity_control', 'super_admin_review');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'merged');--> statement-breakpoint
CREATE TABLE "identity_link_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"normalized_email" text NOT NULL,
	"state_token_hash" text NOT NULL,
	"status" "identity_link_request_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_link_requests_state_token_hash_unique" UNIQUE("state_token_hash"),
	CONSTRAINT "identity_link_requests_status_shape_check" CHECK (("identity_link_requests"."status" = 'pending' AND "identity_link_requests"."completed_at" IS NULL)
      OR ("identity_link_requests"."status" <> 'pending' AND "identity_link_requests"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "user_identity_kind" NOT NULL,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"normalized_value" text,
	"verified_at" timestamp with time zone,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provenance" "user_identity_link_provenance" NOT NULL,
	"status" "user_identity_status" DEFAULT 'active' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"retired_at" timestamp with time zone,
	"retired_reason" text,
	CONSTRAINT "user_identities_status_shape_check" CHECK (("user_identities"."status" = 'active' AND "user_identities"."retired_at" IS NULL AND "user_identities"."retired_reason" IS NULL)
      OR ("user_identities"."status" <> 'active' AND "user_identities"."is_primary" = false AND "user_identities"."retired_at" IS NOT NULL AND length(trim("user_identities"."retired_reason")) > 0)),
	CONSTRAINT "user_identities_provider_non_blank_check" CHECK (length(trim("user_identities"."provider")) > 0),
	CONSTRAINT "user_identities_subject_non_blank_check" CHECK (length(trim("user_identities"."provider_subject")) > 0)
);
--> statement-breakpoint
CREATE TABLE "user_merge_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"initiating_user_id" uuid NOT NULL,
	"counterparty_user_id" uuid NOT NULL,
	"proven_identity_id" uuid NOT NULL,
	"status" "user_merge_authorization_status" DEFAULT 'available' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_merge_authorizations_status_shape_check" CHECK (("user_merge_authorizations"."status" = 'available' AND "user_merge_authorizations"."consumed_at" IS NULL)
      OR ("user_merge_authorizations"."status" <> 'available' AND "user_merge_authorizations"."consumed_at" IS NOT NULL)),
	CONSTRAINT "user_merge_authorizations_distinct_users_check" CHECK ("user_merge_authorizations"."initiating_user_id" <> "user_merge_authorizations"."counterparty_user_id")
);
--> statement-breakpoint
CREATE TABLE "user_merge_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_user_id" uuid NOT NULL,
	"merged_user_id" uuid NOT NULL,
	"executed_by_user_id" uuid NOT NULL,
	"evidence_class" "user_merge_evidence_class" NOT NULL,
	"reason" text NOT NULL,
	"plan_fingerprint" text NOT NULL,
	"authorization_id" uuid,
	"domain_summary" jsonb NOT NULL,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_merge_ledger_merged_user_id_unique" UNIQUE("merged_user_id"),
	CONSTRAINT "user_merge_ledger_authorization_id_unique" UNIQUE("authorization_id"),
	CONSTRAINT "user_merge_ledger_distinct_users_check" CHECK ("user_merge_ledger"."canonical_user_id" <> "user_merge_ledger"."merged_user_id"),
	CONSTRAINT "user_merge_ledger_reason_non_blank_check" CHECK (length(trim("user_merge_ledger"."reason")) > 0),
	CONSTRAINT "user_merge_ledger_fingerprint_shape_check" CHECK ("user_merge_ledger"."plan_fingerprint" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" "user_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "merged_into_user_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "merged_at" timestamp with time zone;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new identity link request table is empty, so foreign-key validation scans no child rows
ALTER TABLE "identity_link_requests" ADD CONSTRAINT "identity_link_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new identity table is empty before the deterministic users backfill
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new merge authorization table is empty, so foreign-key validation scans no child rows
ALTER TABLE "user_merge_authorizations" ADD CONSTRAINT "user_merge_authorizations_initiating_user_id_users_id_fk" FOREIGN KEY ("initiating_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new merge authorization table is empty, so foreign-key validation scans no child rows
ALTER TABLE "user_merge_authorizations" ADD CONSTRAINT "user_merge_authorizations_counterparty_user_id_users_id_fk" FOREIGN KEY ("counterparty_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new merge authorization table is empty, so foreign-key validation scans no child rows
ALTER TABLE "user_merge_authorizations" ADD CONSTRAINT "user_merge_authorizations_proven_identity_id_user_identities_id_fk" FOREIGN KEY ("proven_identity_id") REFERENCES "public"."user_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new merge ledger is empty, so foreign-key validation scans no child rows
ALTER TABLE "user_merge_ledger" ADD CONSTRAINT "user_merge_ledger_canonical_user_id_users_id_fk" FOREIGN KEY ("canonical_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new merge ledger is empty, so foreign-key validation scans no child rows
ALTER TABLE "user_merge_ledger" ADD CONSTRAINT "user_merge_ledger_merged_user_id_users_id_fk" FOREIGN KEY ("merged_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new merge ledger is empty, so foreign-key validation scans no child rows
ALTER TABLE "user_merge_ledger" ADD CONSTRAINT "user_merge_ledger_executed_by_user_id_users_id_fk" FOREIGN KEY ("executed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new merge ledger and authorization table are empty, so foreign-key validation scans no child rows
ALTER TABLE "user_merge_ledger" ADD CONSTRAINT "user_merge_ledger_authorization_id_user_merge_authorizations_id_fk" FOREIGN KEY ("authorization_id") REFERENCES "public"."user_merge_authorizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
INSERT INTO "user_identities" (
	"user_id", "kind", "provider", "provider_subject", "normalized_value", "verified_at", "linked_at", "provenance", "status", "is_primary"
)
SELECT
	"id", 'email', 'email', lower(trim("email")), lower(trim("email")), "email_verified_at", "created_at",
	COALESCE("email_verification_source"::text, 'admin_migration')::"user_identity_link_provenance", 'active', true
FROM "users";--> statement-breakpoint
INSERT INTO "user_identities" (
	"user_id", "kind", "provider", "provider_subject", "normalized_value", "verified_at", "linked_at", "provenance", "status", "is_primary"
)
SELECT
	"id", 'auth', 'supabase_auth', "auth_id"::text, lower(trim("email")), "email_verified_at", "created_at",
	COALESCE("email_verification_source"::text, 'admin_migration')::"user_identity_link_provenance", 'active', true
FROM "users"
WHERE "auth_id" IS NOT NULL;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new link request table remains empty, so synchronous index build is bounded
CREATE INDEX "identity_link_requests_user_status_idx" ON "identity_link_requests" USING btree ("user_id","status");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed identity backfill is bounded by the existing users cardinality and production duplicate preflight found no normalized-email collisions
CREATE UNIQUE INDEX "user_identities_active_provider_subject_unique" ON "user_identities" USING btree ("provider","provider_subject") WHERE "user_identities"."status" = 'active';--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed identity backfill is bounded by the existing users cardinality and production duplicate preflight found no normalized-email collisions
CREATE UNIQUE INDEX "user_identities_active_normalized_value_unique" ON "user_identities" USING btree ("kind","normalized_value") WHERE "user_identities"."status" = 'active' AND "user_identities"."normalized_value" IS NOT NULL;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed identity backfill creates exactly one primary email and at most one primary auth identity per user
CREATE UNIQUE INDEX "user_identities_one_primary_per_kind_unique" ON "user_identities" USING btree ("user_id","kind") WHERE "user_identities"."status" = 'active' AND "user_identities"."is_primary" = true;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed identity backfill is bounded by the existing users cardinality
CREATE INDEX "user_identities_user_status_idx" ON "user_identities" USING btree ("user_id","status");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new merge authorization table is empty, so synchronous index build is bounded
CREATE INDEX "user_merge_authorizations_initiating_status_idx" ON "user_merge_authorizations" USING btree ("initiating_user_id","status");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new merge ledger is empty, so synchronous index build is bounded
CREATE INDEX "user_merge_ledger_canonical_user_id_idx" ON "user_merge_ledger" USING btree ("canonical_user_id");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed self-reference validates existing rows with a null merged target and supports the new explicit merge state
ALTER TABLE "users" ADD CONSTRAINT "users_merged_into_user_id_users_id_fk" FOREIGN KEY ("merged_into_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed existing users satisfy the new active-state default and null merged columns without a data rewrite
ALTER TABLE "users" ADD CONSTRAINT "users_merge_shape_check" CHECK (("users"."status" = 'active' AND "users"."merged_into_user_id" IS NULL AND "users"."merged_at" IS NULL)
      OR ("users"."status" = 'merged' AND "users"."merged_into_user_id" IS NOT NULL AND "users"."merged_into_user_id" <> "users"."id" AND "users"."merged_at" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "identity_link_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_merge_authorizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_merge_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "identity_link_requests", "user_identities", "user_merge_authorizations", "user_merge_ledger" FROM anon, authenticated;
