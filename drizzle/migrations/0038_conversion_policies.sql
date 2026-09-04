CREATE TYPE "public"."conversion_policy_status" AS ENUM('draft', 'approved', 'retired');--> statement-breakpoint
CREATE TABLE "conversion_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_platform" text NOT NULL,
	"target_platform" text NOT NULL,
	"version" text NOT NULL,
	"status" "conversion_policy_status" DEFAULT 'draft' NOT NULL,
	"mapping" jsonb NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversion_policies_current_must_be_approved" CHECK (NOT "conversion_policies"."is_current" OR "conversion_policies"."status" = 'approved')
);
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new conversion_policies table is empty at creation, so synchronous index build is bounded to the new table
CREATE UNIQUE INDEX "conversion_policies_source_target_version_unique" ON "conversion_policies" USING btree ("source_platform","target_platform","version");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new conversion_policies table is empty at creation, so synchronous index build is bounded to the new table
CREATE UNIQUE INDEX "conversion_policies_one_current_per_pair" ON "conversion_policies" USING btree ("source_platform","target_platform") WHERE "conversion_policies"."is_current";--> statement-breakpoint
ALTER TABLE "conversion_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "conversion_policies" FROM anon, authenticated;--> statement-breakpoint
INSERT INTO "conversion_policies" ("source_platform", "target_platform", "version", "status", "mapping", "is_current", "approved_at")
VALUES ('fivee', 'perfect_world', '2026.09', 'approved', '{"belowSRankMap":{"D":"D","C":"C","C+":"C+","C++":"C++","B":"B","B+":"B","B++":"B+","A":"B++","A+":"A","A++":"A+"},"starSegments":[{"minStar":0,"maxStar":5,"targetRank":"A++","targetStarFloor":null,"slopeNum":0,"slopeDen":1},{"minStar":6,"maxStar":12,"targetRank":"青铜S","targetStarFloor":0,"slopeNum":9,"slopeDen":6},{"minStar":13,"maxStar":25,"targetRank":"黄金S","targetStarFloor":10,"slopeNum":14,"slopeDen":12},{"minStar":26,"maxStar":45,"targetRank":"钻石S","targetStarFloor":25,"slopeNum":24,"slopeDen":19},{"minStar":46,"maxStar":null,"targetRank":"魔王S","targetStarFloor":50,"slopeNum":1,"slopeDen":1}],"relativeSeasonAlignment":true}'::jsonb, true, now());