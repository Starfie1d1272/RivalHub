CREATE TYPE "public"."match_roster_source" AS ENUM('participant', 'admin_select');--> statement-breakpoint
CREATE TYPE "public"."match_roster_status" AS ENUM('submitted', 'confirmed');--> statement-breakpoint
ALTER TABLE "major_prestart_entrants" RENAME TO "major_tournament_entrants";--> statement-breakpoint
ALTER TABLE "major_tournament_seeds" RENAME COLUMN "entrant_id" TO "tournament_entrant_id";--> statement-breakpoint
ALTER TABLE "major_tournament_seeds" RENAME COLUMN "tournament_seed" TO "seed";--> statement-breakpoint
ALTER TABLE "major_tournament_entrants" DROP CONSTRAINT "major_prestart_entrants_season_entry_unique";--> statement-breakpoint
ALTER TABLE "major_tournament_entrants" DROP CONSTRAINT "major_prestart_entrants_event_roster_unique";--> statement-breakpoint
ALTER TABLE "major_tournament_seeds" DROP CONSTRAINT "major_tournament_seeds_season_entrant_unique";--> statement-breakpoint
ALTER TABLE "major_tournament_seeds" DROP CONSTRAINT "major_tournament_seeds_season_seed_unique";--> statement-breakpoint
ALTER TABLE "major_stage_entrants" DROP CONSTRAINT "major_stage_entrants_run_entry_unique";--> statement-breakpoint
ALTER TABLE "major_stage_entrants" DROP CONSTRAINT "major_stage_entrants_run_entrant_unique";--> statement-breakpoint
ALTER TABLE "major_tournament_seeds" DROP CONSTRAINT "major_tournament_seeds_seed_range_check";--> statement-breakpoint
ALTER TABLE "major_tournament_entrants" DROP CONSTRAINT "major_prestart_entrants_season_id_seasons_id_fk";
--> statement-breakpoint
ALTER TABLE "major_tournament_entrants" DROP CONSTRAINT "major_prestart_entrants_competition_entry_id_competition_entries_id_fk";
--> statement-breakpoint
ALTER TABLE "major_tournament_entrants" DROP CONSTRAINT "major_prestart_entrants_event_roster_id_event_rosters_id_fk";
--> statement-breakpoint
ALTER TABLE "major_tournament_seeds" DROP CONSTRAINT "major_tournament_seeds_entrant_id_major_prestart_entrants_id_fk";
--> statement-breakpoint
ALTER TABLE "major_stage_entrants" DROP CONSTRAINT "major_stage_entrants_entrant_id_major_prestart_entrants_id_fk";
--> statement-breakpoint
ALTER TABLE "major_stage_entrants" DROP CONSTRAINT "major_stage_entrants_competition_entry_id_competition_entries_id_fk";
--> statement-breakpoint
DROP INDEX "major_prestart_entrants_season_idx";--> statement-breakpoint
UPDATE "match_rosters" SET "status" = 'submitted' WHERE "status" = 'unlocked';--> statement-breakpoint
ALTER TABLE "match_rosters" ALTER COLUMN "source" SET DEFAULT 'participant'::"public"."match_roster_source";--> statement-breakpoint
ALTER TABLE "match_rosters" ALTER COLUMN "source" SET DATA TYPE "public"."match_roster_source" USING "source"::"public"."match_roster_source";--> statement-breakpoint
ALTER TABLE "match_rosters" ALTER COLUMN "status" SET DEFAULT 'submitted'::"public"."match_roster_status";--> statement-breakpoint
ALTER TABLE "match_rosters" ALTER COLUMN "status" SET DATA TYPE "public"."match_roster_status" USING "status"::"public"."match_roster_status";--> statement-breakpoint
ALTER TABLE "major_prestart_states" ADD COLUMN "seeds_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "major_prestart_states" ADD COLUMN "seeds_confirmed_by" text;--> statement-breakpoint
ALTER TABLE "major_stage_entrants" ADD COLUMN "season_id" uuid;--> statement-breakpoint
ALTER TABLE "major_stage_entrants" ADD COLUMN "tournament_entrant_id" uuid;--> statement-breakpoint
UPDATE "major_stage_entrants" stage_entrant
SET "season_id" = stage_run."season_id", "tournament_entrant_id" = stage_entrant."entrant_id"
FROM "major_stage_runs" stage_run
WHERE stage_run."id" = stage_entrant."stage_run_id";--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "major_stage_entrants" WHERE "season_id" IS NULL OR "tournament_entrant_id" IS NULL) THEN
    RAISE EXCEPTION 'major-runtime migration cannot backfill StageEntrant scope';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "major_stage_entrants" stage_entrant
    JOIN "major_tournament_entrants" entrant ON entrant."id" = stage_entrant."tournament_entrant_id"
    WHERE entrant."season_id" <> stage_entrant."season_id"
  ) THEN
    RAISE EXCEPTION 'major-runtime migration found cross-season StageEntrant';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "major_stage_entrants" ALTER COLUMN "season_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "major_stage_entrants" ALTER COLUMN "tournament_entrant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "major_tournament_entrants" ADD CONSTRAINT "major_tournament_entrants_id_season_unique" UNIQUE("id","season_id");--> statement-breakpoint
ALTER TABLE "major_stage_runs" ADD CONSTRAINT "major_stage_runs_id_season_unique" UNIQUE("id","season_id");--> statement-breakpoint
ALTER TABLE "major_tournament_entrants" ADD CONSTRAINT "major_tournament_entrants_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_tournament_entrants" ADD CONSTRAINT "major_tournament_entrants_competition_entry_id_competition_entries_id_fk" FOREIGN KEY ("competition_entry_id") REFERENCES "public"."competition_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_tournament_entrants" ADD CONSTRAINT "major_tournament_entrants_entry_season_scope_fk" FOREIGN KEY ("competition_entry_id","season_id") REFERENCES "public"."competition_entries"("id","competition_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_tournament_seeds" ADD CONSTRAINT "major_tournament_seeds_tournament_entrant_id_major_tournament_entrants_id_fk" FOREIGN KEY ("tournament_entrant_id") REFERENCES "public"."major_tournament_entrants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_tournament_seeds" ADD CONSTRAINT "major_tournament_seeds_entrant_season_scope_fk" FOREIGN KEY ("tournament_entrant_id","season_id") REFERENCES "public"."major_tournament_entrants"("id","season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_final_results" ADD CONSTRAINT "major_final_results_playoff_run_season_scope_fk" FOREIGN KEY ("playoff_stage_run_id","season_id") REFERENCES "public"."major_stage_runs"("id","season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_final_results" ADD CONSTRAINT "major_final_results_champion_entry_season_scope_fk" FOREIGN KEY ("champion_entry_id","season_id") REFERENCES "public"."competition_entries"("id","competition_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_stage_entrants" ADD CONSTRAINT "major_stage_entrants_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_stage_entrants" ADD CONSTRAINT "major_stage_entrants_tournament_entrant_id_major_tournament_entrants_id_fk" FOREIGN KEY ("tournament_entrant_id") REFERENCES "public"."major_tournament_entrants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_stage_entrants" ADD CONSTRAINT "major_stage_entrants_run_season_scope_fk" FOREIGN KEY ("stage_run_id","season_id") REFERENCES "public"."major_stage_runs"("id","season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_stage_entrants" ADD CONSTRAINT "major_stage_entrants_tournament_entrant_season_scope_fk" FOREIGN KEY ("tournament_entrant_id","season_id") REFERENCES "public"."major_tournament_entrants"("id","season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_entry_a_season_scope_fk" FOREIGN KEY ("entry_a_id","season_id") REFERENCES "public"."competition_entries"("id","competition_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_entry_b_season_scope_fk" FOREIGN KEY ("entry_b_id","season_id") REFERENCES "public"."competition_entries"("id","competition_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_major_stage_run_season_scope_fk" FOREIGN KEY ("major_stage_run_id","season_id") REFERENCES "public"."major_stage_runs"("id","season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "major_tournament_entrants_season_idx" ON "major_tournament_entrants" USING btree ("season_id");--> statement-breakpoint
ALTER TABLE "major_tournament_entrants" DROP COLUMN "event_roster_id";--> statement-breakpoint
ALTER TABLE "major_tournament_entrants" DROP COLUMN "roster_confirmed_at";--> statement-breakpoint
ALTER TABLE "major_tournament_entrants" DROP COLUMN "roster_confirmed_by";--> statement-breakpoint
ALTER TABLE "major_tournament_entrants" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "major_prestart_states" DROP COLUMN "seed_revision";--> statement-breakpoint
ALTER TABLE "major_prestart_states" DROP COLUMN "confirmed_seed_revision";--> statement-breakpoint
ALTER TABLE "major_tournament_seeds" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "major_stage_entrants" DROP COLUMN "entrant_id";--> statement-breakpoint
ALTER TABLE "major_stage_entrants" DROP COLUMN "competition_entry_id";--> statement-breakpoint
ALTER TABLE "major_stage_entrants" DROP COLUMN "tournament_seed";--> statement-breakpoint
ALTER TABLE "major_tournament_entrants" ADD CONSTRAINT "major_tournament_entrants_season_entry_unique" UNIQUE("season_id","competition_entry_id");--> statement-breakpoint
ALTER TABLE "major_tournament_seeds" ADD CONSTRAINT "major_tournament_seeds_season_entrant_unique" UNIQUE("season_id","tournament_entrant_id");--> statement-breakpoint
ALTER TABLE "major_tournament_seeds" ADD CONSTRAINT "major_tournament_seeds_season_seed_unique" UNIQUE("season_id","seed");--> statement-breakpoint
ALTER TABLE "major_stage_entrants" ADD CONSTRAINT "major_stage_entrants_run_entrant_unique" UNIQUE("stage_run_id","tournament_entrant_id");--> statement-breakpoint
ALTER TABLE "major_prestart_states" ADD CONSTRAINT "major_prestart_states_seed_confirmation_shape_check" CHECK (("major_prestart_states"."seeds_confirmed_at" IS NULL) = ("major_prestart_states"."seeds_confirmed_by" IS NULL));--> statement-breakpoint
ALTER TABLE "major_prestart_states" ADD CONSTRAINT "major_prestart_states_seed_lock_shape_check" CHECK (("major_prestart_states"."seeds_locked_at" IS NULL) = ("major_prestart_states"."seeds_locked_by" IS NULL));--> statement-breakpoint
ALTER TABLE "major_prestart_states" ADD CONSTRAINT "major_prestart_states_entrant_lock_shape_check" CHECK (("major_prestart_states"."entrants_locked_at" IS NULL) = ("major_prestart_states"."entrants_locked_by" IS NULL));--> statement-breakpoint
ALTER TABLE "major_tournament_seeds" ADD CONSTRAINT "major_tournament_seeds_seed_range_check" CHECK ("major_tournament_seeds"."seed" BETWEEN 1 AND 32);--> statement-breakpoint
ALTER TABLE "major_final_results" ADD CONSTRAINT "major_final_results_confirmation_shape_check" CHECK (("major_final_results"."status" = 'pending_confirmation' AND "major_final_results"."confirmed_at" IS NULL AND "major_final_results"."confirmed_by" IS NULL) OR ("major_final_results"."status" = 'confirmed' AND "major_final_results"."confirmed_at" IS NOT NULL AND "major_final_results"."confirmed_by" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "match_rosters" ADD CONSTRAINT "match_rosters_metadata_shape_check" CHECK (("match_rosters"."source" = 'participant' AND "match_rosters"."submitted_by" IS NOT NULL) OR ("match_rosters"."source" = 'admin_select' AND "match_rosters"."submitted_by" IS NULL));--> statement-breakpoint
ALTER TABLE "match_rosters" ADD CONSTRAINT "match_rosters_confirmation_shape_check" CHECK (("match_rosters"."status" = 'submitted' AND "match_rosters"."confirmed_at" IS NULL AND "match_rosters"."confirmed_by" IS NULL) OR ("match_rosters"."status" = 'confirmed' AND "match_rosters"."confirmed_at" IS NOT NULL AND "match_rosters"."confirmed_by" IS NOT NULL));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."validate_major_final_result"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE group_value jsonb; entry_value jsonb; expected_from integer := 1; placement_count integer := 0; first_entry uuid; entry_id uuid;
BEGIN
  IF jsonb_typeof(NEW.placement_groups) <> 'array' THEN RAISE EXCEPTION 'major_final_results placement_groups must be an array'; END IF;
  FOR group_value IN SELECT value FROM jsonb_array_elements(NEW.placement_groups) LOOP
    IF jsonb_typeof(group_value) <> 'object' OR NOT (group_value ? 'from' AND group_value ? 'to' AND group_value ? 'entryIds')
      OR jsonb_typeof(group_value->'entryIds') <> 'array' THEN RAISE EXCEPTION 'major_final_results placement group shape invalid'; END IF;
    IF (group_value->>'from') !~ '^[0-9]+$' OR (group_value->>'to') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'major_final_results placement range invalid'; END IF;
    IF (group_value->>'from')::integer <> expected_from OR (group_value->>'to')::integer < expected_from
      OR jsonb_array_length(group_value->'entryIds') <> (group_value->>'to')::integer - expected_from + 1 THEN RAISE EXCEPTION 'major_final_results placement groups not contiguous'; END IF;
    FOR entry_value IN SELECT value FROM jsonb_array_elements(group_value->'entryIds') LOOP
      BEGIN entry_id := trim(both '"' from entry_value::text)::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'major_final_results entry id invalid'; END;
      IF placement_count = 0 THEN first_entry := entry_id; END IF;
      IF NOT EXISTS (SELECT 1 FROM competition_entries WHERE id = entry_id AND competition_id = NEW.season_id) THEN RAISE EXCEPTION 'major_final_results entry outside season'; END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.placement_groups) g, jsonb_array_elements(g.value->'entryIds') e WHERE trim(both '"' from e.value::text)::uuid = entry_id) AND placement_count > 0 THEN
        IF (SELECT count(*) FROM jsonb_array_elements(NEW.placement_groups) g, jsonb_array_elements(g.value->'entryIds') e WHERE trim(both '"' from e.value::text)::uuid = entry_id) > 1 THEN RAISE EXCEPTION 'major_final_results duplicate entry'; END IF;
      END IF;
      placement_count := placement_count + 1;
    END LOOP;
    expected_from := (group_value->>'to')::integer + 1;
  END LOOP;
  IF expected_from <> 33 OR placement_count <> 32 OR first_entry IS DISTINCT FROM NEW.champion_entry_id THEN RAISE EXCEPTION 'major_final_results champion/placement mismatch'; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "major_final_results_placement_integrity" AFTER INSERT OR UPDATE OF "placement_groups", "champion_entry_id", "season_id" ON "major_final_results" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."validate_major_final_result"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."validate_match_roster_scope"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM matches WHERE id = NEW.match_id AND (entry_a_id = NEW.entry_id OR entry_b_id = NEW.entry_id)) THEN RAISE EXCEPTION 'match roster entry must be a match competitor'; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "match_rosters_competitor_scope" AFTER INSERT OR UPDATE OF "match_id", "entry_id" ON "match_rosters" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."validate_match_roster_scope"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."validate_match_roster_player_scope"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM match_rosters roster
    JOIN event_roster_members member ON member.id = NEW.event_roster_member_id
    JOIN event_rosters event_roster ON event_roster.id = member.event_roster_id
    WHERE roster.id = NEW.roster_id AND event_roster.entry_id = roster.entry_id
  ) THEN RAISE EXCEPTION 'match roster player must belong to roster entry'; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "match_roster_players_entry_scope" AFTER INSERT OR UPDATE OF "roster_id", "event_roster_member_id" ON "match_roster_players" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."validate_match_roster_player_scope"();
