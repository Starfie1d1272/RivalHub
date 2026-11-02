CREATE TYPE "public"."sanction_effect" AS ENUM('registration_block', 'roster_block', 'match_participation_block');--> statement-breakpoint
CREATE TYPE "public"."sanction_status" AS ENUM('draft', 'active', 'expired', 'revoked');--> statement-breakpoint
CREATE TABLE "disciplinary_case_idempotency" (
	"client_request_id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disciplinary_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"subject_user_id" uuid NOT NULL,
	"status" "sanction_status" DEFAULT 'draft' NOT NULL,
	"effects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"internal_evidence" text,
	"public_explanation" text,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_until" timestamp with time zone,
	"issued_by" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"revocation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disciplinary_cases_revocation_consistent_check" CHECK (("disciplinary_cases"."status" = 'revoked') = ("disciplinary_cases"."revoked_at" IS NOT NULL)),
	CONSTRAINT "disciplinary_cases_window_sane_check" CHECK ("disciplinary_cases"."effective_until" IS NULL OR "disciplinary_cases"."effective_until" > "disciplinary_cases"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "disciplinary_case_idempotency" ADD CONSTRAINT "disciplinary_case_idempotency_case_id_disciplinary_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."disciplinary_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_cases" ADD CONSTRAINT "disciplinary_cases_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_cases" ADD CONSTRAINT "disciplinary_cases_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disciplinary_cases_season_subject_idx" ON "disciplinary_cases" USING btree ("season_id","subject_user_id");--> statement-breakpoint
CREATE INDEX "disciplinary_cases_status_idx" ON "disciplinary_cases" USING btree ("status");--> statement-breakpoint
ALTER TABLE disciplinary_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE disciplinary_case_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON disciplinary_cases, disciplinary_case_idempotency FROM anon, authenticated;
