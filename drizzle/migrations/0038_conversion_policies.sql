CREATE TYPE "public"."conversion_policy_status" AS ENUM('draft', 'approved', 'retired');--> statement-breakpoint
CREATE TABLE "conversion_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_platform" text NOT NULL,
	"target_platform" text NOT NULL,
	"version" text NOT NULL,
	"status" "conversion_policy_status" DEFAULT 'draft' NOT NULL,
	"mapping" jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversion_policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "conversion_policies" FROM anon, authenticated;
