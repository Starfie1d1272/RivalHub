CREATE TYPE "public"."competitive_fact_kind" AS ENUM('historical_peak', 'season_peak');--> statement-breakpoint
CREATE TYPE "public"."competitive_fact_provenance" AS ENUM('self_declared');--> statement-breakpoint
CREATE TABLE "competitive_platform_seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"season_key" text NOT NULL,
	"label" text NOT NULL,
	"rank_order" json DEFAULT '[]'::json NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitive_rank_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"kind" "competitive_fact_kind" NOT NULL,
	"platform_season_key" text,
	"rank" text NOT NULL,
	"rating" numeric(8, 2) NOT NULL,
	"provenance" "competitive_fact_provenance" DEFAULT 'self_declared' NOT NULL,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "perfect_id" text;--> statement-breakpoint
ALTER TABLE "team_applications" ADD COLUMN "perfect_team_id" text;--> statement-breakpoint
ALTER TABLE "team_applications" ADD COLUMN "primary_starter_user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "competitive_rank_facts" ADD CONSTRAINT "competitive_rank_facts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "competitive_platform_seasons_platform_key_unique" ON "competitive_platform_seasons" USING btree ("platform","season_key");--> statement-breakpoint
CREATE UNIQUE INDEX "competitive_rank_facts_identity_unique" ON "competitive_rank_facts" USING btree ("user_id","platform","kind",coalesce("platform_season_key", ''));--> statement-breakpoint
CREATE INDEX "competitive_rank_facts_user_platform_idx" ON "competitive_rank_facts" USING btree ("user_id","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "users_perfect_id_normalized_unique" ON "users" USING btree (lower(btrim("perfect_id")));--> statement-breakpoint
ALTER TABLE "competitive_platform_seasons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "competitive_rank_facts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON competitive_platform_seasons, competitive_rank_facts FROM anon, authenticated;
