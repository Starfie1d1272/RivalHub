CREATE TYPE "public"."match_time_resolution" AS ENUM('participant_accept', 'auto_timeout', 'auto_cutoff', 'admin_force');--> statement-breakpoint
CREATE TABLE "coverage_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "coverage_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"proposed_scheduled_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "match_lineup_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_coverage_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"allocation_policy" text DEFAULT 'first_confirmed' NOT NULL,
	"note" text,
	CONSTRAINT "coverage_slot_window" CHECK ("official_coverage_slots"."ends_at" > "official_coverage_slots"."starts_at" AND "official_coverage_slots"."capacity" > 0)
);
--> statement-breakpoint
ALTER TABLE "match_rosters" DROP CONSTRAINT "match_rosters_metadata_shape_check";--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "match_time_proposals" ADD COLUMN "resolution" "match_time_resolution";--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive constraint on a newly created empty table.
ALTER TABLE "coverage_allocations" ADD CONSTRAINT "coverage_allocations_slot_id_official_coverage_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."official_coverage_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive constraint on a newly created empty table.
ALTER TABLE "coverage_allocations" ADD CONSTRAINT "coverage_allocations_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive constraint on a newly created empty table.
ALTER TABLE "coverage_holds" ADD CONSTRAINT "coverage_holds_slot_id_official_coverage_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."official_coverage_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive constraint on a newly created empty table.
ALTER TABLE "coverage_holds" ADD CONSTRAINT "coverage_holds_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive constraint on a newly created empty table.
ALTER TABLE "match_lineup_incidents" ADD CONSTRAINT "match_lineup_incidents_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive constraint on a newly created empty table.
ALTER TABLE "match_lineup_incidents" ADD CONSTRAINT "match_lineup_incidents_entry_id_competition_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive constraint on a newly created empty table.
ALTER TABLE "official_coverage_slots" ADD CONSTRAINT "official_coverage_slots_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive index on a newly created empty table.
CREATE UNIQUE INDEX "coverage_one_active_allocation" ON "coverage_allocations" USING btree ("match_id") WHERE "coverage_allocations"."released_at" IS NULL;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Additive index on a newly created empty table.
CREATE UNIQUE INDEX "coverage_one_active_hold" ON "coverage_holds" USING btree ("match_id") WHERE "coverage_holds"."released_at" IS NULL;--> statement-breakpoint
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY match_id ORDER BY created_at DESC, id DESC) AS ordinal
  FROM match_time_proposals WHERE status = 'pending'
)
UPDATE match_time_proposals SET status = 'expired', updated_at = now()
WHERE id IN (SELECT id FROM ranked WHERE ordinal > 1);--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Partial unique index enforces one active proposal after the deterministic duplicate cleanup.
CREATE UNIQUE INDEX "match_time_proposals_one_pending" ON "match_time_proposals" USING btree ("match_id") WHERE "match_time_proposals"."status" = 'pending';--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Existing roster metadata constraint expands to system_default without rewriting rows.
ALTER TABLE "match_rosters" ADD CONSTRAINT "match_rosters_metadata_shape_check" CHECK (("match_rosters"."source" = 'participant' AND "match_rosters"."submitted_by" IS NOT NULL) OR ("match_rosters"."source" IN ('admin_select', 'system_default') AND "match_rosters"."submitted_by" IS NULL));--> statement-breakpoint
ALTER TABLE "coverage_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON "coverage_allocations" FROM anon, authenticated;--> statement-breakpoint
ALTER TABLE "coverage_holds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON "coverage_holds" FROM anon, authenticated;--> statement-breakpoint
ALTER TABLE "match_lineup_incidents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON "match_lineup_incidents" FROM anon, authenticated;--> statement-breakpoint
ALTER TABLE "official_coverage_slots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON "official_coverage_slots" FROM anon, authenticated;
