/*
 * Release-N data precondition for the contract cleanup.  A fresh database may
 * have no legacy rows, but any retained production data must match the only
 * deterministic Release-N backfill: the 2026 NJU Rivals playoff state.  The
 * checks are intentionally inside the migration transaction so an unknown
 * row, residual Swiss projection, or incomplete canonical coverage fails
 * closed before either destructive statement is attempted.
 */
DO $$
DECLARE
  swiss_row_count bigint;
  legacy_row_count bigint;
  legacy_competition_id uuid;
  legacy_slug text;
  legacy_data jsonb;
  legacy_updated_at timestamp with time zone;
  canonical_data jsonb;
  canonical_updated_at timestamp with time zone;
  canonical_match_count bigint;
  canonical_participant_count bigint;
  managed_match_count bigint;
  unmatched_provider_matches bigint;
  unmatched_db_matches bigint;
  legacy_participants_normalized jsonb;
  stripped_canonical_participants jsonb;
  participant_item jsonb;
  participant_id integer;
  canonical_entry_text text;
  canonical_entry_id uuid;
  participant_node_count bigint;
  candidate_count bigint;
  candidate_entry uuid;
  seen_entry_ids uuid[] := '{}';
BEGIN
  -- 1. Swiss standings must be empty (Swiss projection was migrated or cleaned up)
  SELECT count(*) INTO swiss_row_count
  FROM "swiss_standings";
  IF swiss_row_count <> 0 THEN
    RAISE EXCEPTION '0049 legacy-data precondition failed: swiss_standings contains % residual row(s)', swiss_row_count;
  END IF;

  -- 2. Check legacy competition_bracket_states
  SELECT count(*) INTO legacy_row_count
  FROM "competition_bracket_states";
  IF legacy_row_count = 0 THEN
    RETURN;
  END IF;
  IF legacy_row_count <> 1 THEN
    RAISE EXCEPTION '0049 legacy-data precondition failed: expected zero or one deterministic competition_bracket_states row, got %', legacy_row_count;
  END IF;

  SELECT legacy."competition_id", legacy."data", legacy."updated_at", season."slug"
    INTO legacy_competition_id, legacy_data, legacy_updated_at, legacy_slug
  FROM "competition_bracket_states" AS legacy
  LEFT JOIN "seasons" AS season ON season."id" = legacy."competition_id";

  IF legacy_slug IS DISTINCT FROM '2026-nju-rivals' THEN
    RAISE EXCEPTION '0049 legacy-data precondition failed: competition_bracket_states row % is not the deterministic 2026-nju-rivals source', legacy_competition_id;
  END IF;

  -- 3. Canonical stage-scoped playoff state must exist
  SELECT canonical."data", canonical."updated_at"
    INTO canonical_data, canonical_updated_at
  FROM "competition_stage_bracket_states" AS canonical
  WHERE canonical."competition_id" = legacy_competition_id
    AND canonical."stage_key" = 'playoff';
  IF canonical_data IS NULL THEN
    RAISE EXCEPTION '0049 legacy-data precondition failed: deterministic canonical playoff state is missing for %', legacy_competition_id;
  END IF;

  -- 4. Verify updated_at consistency between canonical playoff state and legacy state
  IF canonical_updated_at IS DISTINCT FROM legacy_updated_at THEN
    RAISE EXCEPTION '0049 legacy-data precondition failed: canonical playoff updated_at % does not match legacy updated_at %',
      canonical_updated_at, legacy_updated_at;
  END IF;

  -- 5. Canonical data except participant must match legacy data except participant
  IF canonical_data - 'participant' IS DISTINCT FROM legacy_data - 'participant' THEN
    RAISE EXCEPTION '0049 legacy-data precondition failed: canonical playoff state is not the deterministic projection of %', legacy_competition_id;
  END IF;

  -- 6. Verify exact set equality between provider match.id and DB (season_id, stage='playoff', bracket_node_id)
  canonical_match_count := COALESCE(jsonb_array_length(canonical_data->'match'), 0);
  SELECT count(*) INTO managed_match_count
  FROM "matches"
  WHERE "season_id" = legacy_competition_id
    AND "stage" = 'playoff'
    AND "bracket_node_id" IS NOT NULL;

  -- Anti-join 1: provider match node ids not found in DB matches
  SELECT count(*) INTO unmatched_provider_matches
  FROM jsonb_array_elements(COALESCE(canonical_data->'match', '[]'::jsonb)) AS provider_match(item)
  WHERE NOT EXISTS (
    SELECT 1 FROM "matches" AS db_match
    WHERE db_match."season_id" = legacy_competition_id
      AND db_match."stage" = 'playoff'
      AND db_match."bracket_node_id" = provider_match.item->>'id'
  );

  -- Anti-join 2: DB match bracket_node_ids not found in provider matches
  SELECT count(*) INTO unmatched_db_matches
  FROM "matches" AS db_match
  WHERE db_match."season_id" = legacy_competition_id
    AND db_match."stage" = 'playoff'
    AND db_match."bracket_node_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(canonical_data->'match', '[]'::jsonb)) AS provider_match(item)
      WHERE provider_match.item->>'id' = db_match."bracket_node_id"
    );

  IF canonical_match_count <> 14
      OR managed_match_count <> 14
      OR unmatched_provider_matches <> 0
      OR unmatched_db_matches <> 0 THEN
    RAISE EXCEPTION '0049 legacy-data precondition failed: exact match set equality failed (canonical: %, db: %, unmatched provider: %, unmatched db: %)',
      canonical_match_count,
      managed_match_count,
      unmatched_provider_matches,
      unmatched_db_matches;
  END IF;

  -- 7. Canonical participant stripped of rivalhubEntryId must be deterministically equivalent to legacy participant
  canonical_participant_count := COALESCE(jsonb_array_length(canonical_data->'participant'), 0);
  IF canonical_participant_count <> 8 THEN
    RAISE EXCEPTION '0049 legacy-data precondition failed: expected 8 canonical participants, got %', canonical_participant_count;
  END IF;

  SELECT jsonb_agg(
    legacy_participant.item
    ORDER BY (legacy_participant.item->>'id')::integer
  ) INTO legacy_participants_normalized
  FROM jsonb_array_elements(COALESCE(legacy_data->'participant', '[]'::jsonb)) AS legacy_participant(item);

  SELECT jsonb_agg(
    canonical_participant.item - 'rivalhubEntryId'
    ORDER BY (canonical_participant.item->>'id')::integer
  ) INTO stripped_canonical_participants
  FROM jsonb_array_elements(COALESCE(canonical_data->'participant', '[]'::jsonb)) AS canonical_participant(item);

  IF legacy_participants_normalized IS NULL
      OR stripped_canonical_participants IS NULL
      OR jsonb_array_length(legacy_participants_normalized) <> 8
      OR stripped_canonical_participants IS DISTINCT FROM legacy_participants_normalized THEN
    RAISE EXCEPTION '0049 legacy-data precondition failed: canonical participants stripped of rivalhubEntryId do not match legacy participants';
  END IF;

  -- 8. Verify each participant rivalhubEntryId belongs to the same competition
  -- and re-prove unique node-coverage identity (matching 0048 backfill semantics)
  FOR participant_item IN SELECT value FROM jsonb_array_elements(COALESCE(canonical_data->'participant', '[]'::jsonb)) LOOP
    participant_id := (participant_item->>'id')::integer;
    canonical_entry_text := participant_item->>'rivalhubEntryId';

    IF canonical_entry_text IS NULL OR canonical_entry_text = '' THEN
      RAISE EXCEPTION '0049 legacy-data precondition failed: participant % missing rivalhubEntryId', participant_id;
    END IF;

    BEGIN
      canonical_entry_id := canonical_entry_text::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '0049 legacy-data precondition failed: participant % invalid rivalhubEntryId UUID: %', participant_id, canonical_entry_text;
    END;

    -- Verify rivalhubEntryId belongs to legacy_competition_id
    IF NOT EXISTS (
      SELECT 1 FROM "competition_entries"
      WHERE "id" = canonical_entry_id
        AND "competition_id" = legacy_competition_id
    ) THEN
      RAISE EXCEPTION '0049 legacy-data precondition failed: participant % rivalhubEntryId % does not belong to competition %',
        participant_id, canonical_entry_id, legacy_competition_id;
    END IF;

    -- Verify uniqueness across participants (no duplicate mappings)
    IF canonical_entry_id = ANY(seen_entry_ids) THEN
      RAISE EXCEPTION '0049 legacy-data precondition failed: duplicate rivalhubEntryId % detected for participant %',
        canonical_entry_id, participant_id;
    END IF;
    seen_entry_ids := array_append(seen_entry_ids, canonical_entry_id);

    -- Re-derive unique node coverage identity from provider-node <-> DB-match coverage
    SELECT count(*) INTO participant_node_count
    FROM jsonb_array_elements(canonical_data->'match') AS provider_match(match_json)
    WHERE ((provider_match.match_json->'opponent1'->>'id')::integer = participant_id
        OR (provider_match.match_json->'opponent2'->>'id')::integer = participant_id)
      AND EXISTS (
        SELECT 1 FROM "matches" AS db_match
        WHERE db_match."season_id" = legacy_competition_id
          AND db_match."stage" = 'playoff'
          AND db_match."bracket_node_id" = provider_match.match_json->>'id'
      );

    SELECT count(*), (array_agg(candidate_entry_id ORDER BY candidate_entry_id))[1]
      INTO candidate_count, candidate_entry
    FROM (
      SELECT candidate.entry_id AS candidate_entry_id
      FROM (
        SELECT db_match."bracket_node_id" AS node_id, db_match."entry_a_id" AS entry_id
        FROM jsonb_array_elements(canonical_data->'match') AS provider_match(match_json)
        JOIN "matches" AS db_match
          ON db_match."season_id" = legacy_competition_id
         AND db_match."stage" = 'playoff'
         AND db_match."bracket_node_id" = provider_match.match_json->>'id'
        WHERE (provider_match.match_json->'opponent1'->>'id')::integer = participant_id
           OR (provider_match.match_json->'opponent2'->>'id')::integer = participant_id
        UNION
        SELECT db_match."bracket_node_id" AS node_id, db_match."entry_b_id" AS entry_id
        FROM jsonb_array_elements(canonical_data->'match') AS provider_match(match_json)
        JOIN "matches" AS db_match
          ON db_match."season_id" = legacy_competition_id
         AND db_match."stage" = 'playoff'
         AND db_match."bracket_node_id" = provider_match.match_json->>'id'
        WHERE (provider_match.match_json->'opponent1'->>'id')::integer = participant_id
           OR (provider_match.match_json->'opponent2'->>'id')::integer = participant_id
      ) AS candidate
      GROUP BY candidate.entry_id
      HAVING count(DISTINCT candidate.node_id) = participant_node_count
    ) AS unique_candidate;

    IF participant_node_count = 0 OR candidate_count <> 1 OR candidate_entry IS NULL THEN
      RAISE EXCEPTION '0049 legacy-data precondition failed: participant % has no unique node-coverage identity (nodes: %, candidates: %)',
        participant_id, participant_node_count, candidate_count;
    END IF;

    IF candidate_entry IS DISTINCT FROM canonical_entry_id THEN
      RAISE EXCEPTION '0049 legacy-data precondition failed: participant % rivalhubEntryId % does not match proven candidate %',
        participant_id, canonical_entry_id, candidate_entry;
    END IF;
  END LOOP;

  IF cardinality(seen_entry_ids) <> 8 THEN
    RAISE EXCEPTION '0049 legacy-data precondition failed: expected 8 proven unique entries, got %', cardinality(seen_entry_ids);
  END IF;
END $$;
--> statement-breakpoint
-- rivalhub:migration-risk: contract-cleanup v2.8.2 production has the stage-scoped bracket owner and deterministic Release-N backfill coverage; no shipped consumer remains.
DROP TABLE "competition_bracket_states";--> statement-breakpoint
-- rivalhub:migration-risk: contract-cleanup v2.8.2 production has the Major Swiss StageRun projection and zero residual Swiss rows; no shipped consumer remains.
DROP TABLE "swiss_standings";
