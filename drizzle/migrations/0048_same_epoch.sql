CREATE TABLE "competition_stage_bracket_states" (
	"competition_id" uuid NOT NULL,
	"stage_key" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_stage_bracket_states_pkey" PRIMARY KEY("competition_id","stage_key")
);
--> statement-breakpoint
ALTER TABLE "competition_stage_bracket_states" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "competition_stage_bracket_states" FROM anon, authenticated;
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed add the composite identity required by the stage-scoped Major match FK; no data rewrite is performed.
ALTER TABLE "major_stage_runs" ADD CONSTRAINT "major_stage_runs_id_season_stage_unique" UNIQUE("id","season_id","stage_key");
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed replace the old two-column Major scope with the stage-aware scope; the old constraint is retained in the ledger only until this statement executes.
ALTER TABLE "matches" DROP CONSTRAINT "matches_major_stage_run_season_scope_fk";
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed add the new stage-state foreign key after the table is created; no existing row rewrite is performed.
ALTER TABLE "competition_stage_bracket_states" ADD CONSTRAINT "competition_stage_bracket_states_competition_id_seasons_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed add the stage-aware composite FK after its referenced unique identity exists.
ALTER TABLE "matches" ADD CONSTRAINT "matches_major_stage_run_season_stage_scope_fk" FOREIGN KEY ("major_stage_run_id","season_id","stage") REFERENCES "public"."major_stage_runs"("id","season_id","stage_key") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed create the partial uniqueness guard for provider nodes within one logical stage.
CREATE UNIQUE INDEX "matches_season_stage_bracket_node_unique" ON "matches" USING btree ("season_id","stage","bracket_node_id") WHERE "matches"."bracket_node_id" IS NOT NULL;
--> statement-breakpoint
/*
 * Deterministic Release-N historical backfill.  The fixture is intentionally
 * narrow: only the 2026 Rivals playoff state is migrated, and only when all
 * fourteen provider nodes have an exact stage-scoped DB match.  Participant
 * identity is recovered from the intersection of the DB entries appearing in
 * every node for that provider participant; display names and array position
 * are never consulted.  If the proof is not unique, the migration fails
 * closed instead of manufacturing identity metadata.
 */
DO $$
DECLARE
  rivals_id uuid;
  source_data jsonb;
  migrated_data jsonb;
  participant_item jsonb;
  participant_id integer;
  provider_match_count bigint;
  matched_provider_nodes bigint;
  db_playoff_node_count bigint;
  participant_node_count bigint;
  candidate_count bigint;
  candidate_entry uuid;
  participant_count bigint;
  mapping jsonb := '{}'::jsonb;
BEGIN
  SELECT "id" INTO rivals_id FROM "seasons" WHERE "slug" = '2026-nju-rivals';
  IF rivals_id IS NULL THEN
    RETURN;
  END IF;

  SELECT "data" INTO source_data
  FROM "competition_bracket_states"
  WHERE "competition_id" = rivals_id;
  IF source_data IS NULL THEN
    RETURN;
  END IF;

  SELECT jsonb_array_length(COALESCE(source_data->'match', '[]'::jsonb)) INTO provider_match_count;
  SELECT count(*) INTO db_playoff_node_count
  FROM "matches"
  WHERE "season_id" = rivals_id
    AND "stage" = 'playoff'
    AND "bracket_node_id" IS NOT NULL;
  SELECT count(*) INTO matched_provider_nodes
  FROM jsonb_array_elements(COALESCE(source_data->'match', '[]'::jsonb)) AS provider_match(match_json)
  WHERE EXISTS (
    SELECT 1 FROM "matches" AS db_match
    WHERE db_match."season_id" = rivals_id
      AND db_match."stage" = 'playoff'
      AND db_match."bracket_node_id" = provider_match.match_json->>'id'
  );

  IF provider_match_count <> 14 OR db_playoff_node_count <> 14 OR matched_provider_nodes <> 14 THEN
    RAISE EXCEPTION '2026 Rivals playoff stage backfill proof failed: provider %, matched %, db %', provider_match_count, matched_provider_nodes, db_playoff_node_count;
  END IF;

  SELECT jsonb_array_length(COALESCE(source_data->'participant', '[]'::jsonb)) INTO participant_count;
  FOR participant_item IN SELECT value FROM jsonb_array_elements(COALESCE(source_data->'participant', '[]'::jsonb)) LOOP
    participant_id := (participant_item->>'id')::integer;

    SELECT count(*) INTO participant_node_count
    FROM jsonb_array_elements(source_data->'match') AS provider_match(match_json)
    WHERE ((provider_match.match_json->'opponent1'->>'id')::integer = participant_id
        OR (provider_match.match_json->'opponent2'->>'id')::integer = participant_id)
      AND EXISTS (
        SELECT 1 FROM "matches" AS db_match
        WHERE db_match."season_id" = rivals_id
          AND db_match."stage" = 'playoff'
          AND db_match."bracket_node_id" = provider_match.match_json->>'id'
      );

    SELECT count(*), (array_agg(candidate_entry_id ORDER BY candidate_entry_id))[1]
      INTO candidate_count, candidate_entry
    FROM (
      SELECT candidate.entry_id AS candidate_entry_id
      FROM (
        SELECT db_match."bracket_node_id" AS node_id, db_match."entry_a_id" AS entry_id
        FROM jsonb_array_elements(source_data->'match') AS provider_match(match_json)
        JOIN "matches" AS db_match
          ON db_match."season_id" = rivals_id
         AND db_match."stage" = 'playoff'
         AND db_match."bracket_node_id" = provider_match.match_json->>'id'
        WHERE (provider_match.match_json->'opponent1'->>'id')::integer = participant_id
           OR (provider_match.match_json->'opponent2'->>'id')::integer = participant_id
        UNION
        SELECT db_match."bracket_node_id" AS node_id, db_match."entry_b_id" AS entry_id
        FROM jsonb_array_elements(source_data->'match') AS provider_match(match_json)
        JOIN "matches" AS db_match
          ON db_match."season_id" = rivals_id
         AND db_match."stage" = 'playoff'
         AND db_match."bracket_node_id" = provider_match.match_json->>'id'
        WHERE (provider_match.match_json->'opponent1'->>'id')::integer = participant_id
           OR (provider_match.match_json->'opponent2'->>'id')::integer = participant_id
      ) AS candidate
      GROUP BY candidate.entry_id
      HAVING count(DISTINCT candidate.node_id) = participant_node_count
    ) AS unique_candidate;

    IF participant_node_count = 0 OR candidate_count <> 1 OR candidate_entry IS NULL THEN
      RAISE EXCEPTION '2026 Rivals participant % has no unique node-coverage identity', participant_id;
    END IF;
    mapping := mapping || jsonb_build_object(participant_id::text, candidate_entry::text);
  END LOOP;

  IF participant_count <> jsonb_object_length(mapping) THEN
    RAISE EXCEPTION '2026 Rivals participant metadata backfill is incomplete';
  END IF;

  SELECT jsonb_agg(
    participant_item.value || jsonb_build_object(
      'rivalhubEntryId', mapping ->> (participant_item.value->>'id')
    ) ORDER BY (participant_item.value->>'id')::integer
  ) INTO migrated_data
  FROM jsonb_array_elements(source_data->'participant') AS participant_item(value);

  migrated_data := jsonb_set(source_data, '{participant}', migrated_data, true);
  INSERT INTO "competition_stage_bracket_states" ("competition_id", "stage_key", "data", "updated_at")
  SELECT rivals_id, 'playoff', migrated_data, "updated_at"
  FROM "competition_bracket_states"
  WHERE "competition_id" = rivals_id
  ON CONFLICT ("competition_id", "stage_key") DO NOTHING;
END $$;
