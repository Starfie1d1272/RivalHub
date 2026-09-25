CREATE TYPE "public"."competition_qualification_format" AS ENUM('direct_bo3', 'short_swiss_2w2l');--> statement-breakpoint
CREATE TABLE "competition_qualification_entrants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"competition_entry_id" uuid NOT NULL,
	"preliminary_seed" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_qualification_entrants_run_entry_unique" UNIQUE("run_id","competition_entry_id"),
	CONSTRAINT "competition_qualification_entrants_run_seed_unique" UNIQUE("run_id","preliminary_seed"),
	CONSTRAINT "competition_qualification_entrants_id_run_unique" UNIQUE("id","run_id"),
	CONSTRAINT "competition_qualification_entrants_seed_check" CHECK ("competition_qualification_entrants"."preliminary_seed" >= 1)
);
--> statement-breakpoint
CREATE TABLE "competition_qualification_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"format" "competition_qualification_format" NOT NULL,
	"target_entrant_count" integer NOT NULL,
	"candidate_count" integer NOT NULL,
	"direct_entry_count" integer NOT NULL,
	"play_in_entry_count" integer NOT NULL,
	"qualifier_count" integer NOT NULL,
	"configured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"configured_by" text NOT NULL,
	"started_at" timestamp with time zone,
	"started_by" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_qualification_runs_season_id_unique" UNIQUE("season_id"),
	CONSTRAINT "competition_qualification_runs_id_season_unique" UNIQUE("id","season_id"),
	CONSTRAINT "competition_qualification_runs_counts_check" CHECK ("competition_qualification_runs"."candidate_count" = "competition_qualification_runs"."direct_entry_count" + "competition_qualification_runs"."play_in_entry_count"
      AND "competition_qualification_runs"."target_entrant_count" = "competition_qualification_runs"."direct_entry_count" + "competition_qualification_runs"."qualifier_count"
      AND "competition_qualification_runs"."play_in_entry_count" = "competition_qualification_runs"."qualifier_count" * 2
      AND "competition_qualification_runs"."play_in_entry_count" >= 2
      AND "competition_qualification_runs"."candidate_count" > "competition_qualification_runs"."target_entrant_count"),
	CONSTRAINT "competition_qualification_runs_positive_counts_check" CHECK ("competition_qualification_runs"."target_entrant_count" > 0 AND "competition_qualification_runs"."direct_entry_count" >= 0 AND "competition_qualification_runs"."qualifier_count" > 0),
	CONSTRAINT "competition_qualification_runs_started_by_shape_check" CHECK (("competition_qualification_runs"."started_at" IS NULL) = ("competition_qualification_runs"."started_by" IS NULL)),
	CONSTRAINT "competition_qualification_runs_completed_after_start_check" CHECK ("competition_qualification_runs"."completed_at" IS NULL OR "competition_qualification_runs"."started_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "qualification_run_id" uuid;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Qualification entrant rows are created in this migration and have no pre-existing references to validate
ALTER TABLE "competition_qualification_entrants" ADD CONSTRAINT "competition_qualification_entrants_run_season_scope_fk" FOREIGN KEY ("run_id","season_id") REFERENCES "public"."competition_qualification_runs"("id","season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Qualification entrant rows are created in this migration and have no pre-existing Entry references to validate
ALTER TABLE "competition_qualification_entrants" ADD CONSTRAINT "competition_qualification_entrants_entry_season_scope_fk" FOREIGN KEY ("competition_entry_id","season_id") REFERENCES "public"."competition_entries"("id","competition_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new Qualification run table is empty when its season reference is added
ALTER TABLE "competition_qualification_runs" ADD CONSTRAINT "competition_qualification_runs_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed this index is built on the new, empty entrant table
CREATE INDEX "competition_qualification_entrants_season_idx" ON "competition_qualification_entrants" USING btree ("season_id");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed the added nullable reference is NULL for all existing matches; legacy rows satisfy the qualification shape check
ALTER TABLE "matches" ADD CONSTRAINT "matches_qualification_run_season_scope_fk" FOREIGN KEY ("qualification_run_id","season_id") REFERENCES "public"."competition_qualification_runs"("id","season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed the added nullable reference is NULL for all existing matches, so every legacy row satisfies this check
ALTER TABLE "matches" ADD CONSTRAINT "matches_qualification_match_shape" CHECK ("matches"."qualification_run_id" IS NULL OR ("matches"."ownership" = 'manual' AND "matches"."stage" = 'play-in' AND "matches"."major_stage_run_id" IS NULL AND "matches"."managed_key" IS NULL AND "matches"."bracket_node_id" IS NULL));
