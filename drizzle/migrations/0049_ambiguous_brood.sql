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
  canonical_data jsonb;
  canonical_match_count bigint;
  canonical_participant_count bigint;
  canonical_mapped_participant_count bigint;
  canonical_entry_count bigint;
  managed_match_count bigint;
BEGIN
  SELECT count(*) INTO swiss_row_count
  FROM "swiss_standings";
  IF swiss_row_count <> 0 THEN
    RAISE EXCEPTION '0049 legacy-data precondition failed: swiss_standings contains % residual row(s)', swiss_row_count;
  END IF;

  SELECT count(*) INTO legacy_row_count
  FROM "competition_bracket_states";
  IF legacy_row_count = 0 THEN
    RETURN;
  END IF;
  IF legacy_row_count <> 1 THEN
    RAISE EXCEPTION '0049 legacy-data precondition failed: expected zero or one deterministic competition_bracket_states row, got %', legacy_row_count;
  END IF;

  SELECT legacy."competition_id", legacy."data", season."slug"
    INTO legacy_competition_id, legacy_data, legacy_slug
  FROM "competition_bracket_states" AS legacy
  LEFT JOIN "seasons" AS season ON season."id" = legacy."competition_id";

  IF legacy_slug IS DISTINCT FROM '2026-nju-rivals' THEN
    RAISE EXCEPTION '0049 legacy-data precondition failed: competition_bracket_states row % is not the deterministic 2026-nju-rivals source', legacy_competition_id;
  END IF;

  SELECT canonical."data"
    INTO canonical_data
  FROM "competition_stage_bracket_states" AS canonical
  WHERE canonical."competition_id" = legacy_competition_id
    AND canonical."stage_key" = 'playoff';
  IF canonical_data IS NULL THEN
    RAISE EXCEPTION '0049 legacy-data precondition failed: deterministic canonical playoff state is missing for %', legacy_competition_id;
  END IF;

  IF canonical_data - 'participant' IS DISTINCT FROM legacy_data - 'participant' THEN
    RAISE EXCEPTION '0049 legacy-data precondition failed: canonical playoff state is not the deterministic projection of %', legacy_competition_id;
  END IF;

  canonical_match_count := COALESCE(jsonb_array_length(canonical_data->'match'), 0);
  canonical_participant_count := COALESCE(jsonb_array_length(canonical_data->'participant'), 0);
  SELECT count(*) INTO canonical_mapped_participant_count
  FROM jsonb_array_elements(COALESCE(canonical_data->'participant', '[]'::jsonb)) AS participant(item)
  WHERE NULLIF(participant.item->>'rivalhubEntryId', '') IS NOT NULL;
  SELECT count(DISTINCT entry.id) INTO canonical_entry_count
  FROM jsonb_array_elements(COALESCE(canonical_data->'participant', '[]'::jsonb)) AS participant(item)
  JOIN "competition_entries" AS entry
    ON entry."id" = (participant.item->>'rivalhubEntryId')::uuid;
  SELECT count(*) INTO managed_match_count
  FROM "matches"
  WHERE "season_id" = legacy_competition_id
    AND "stage" = 'playoff'
    AND "bracket_node_id" IS NOT NULL;

  IF canonical_match_count <> 14
      OR canonical_participant_count <> 8
      OR canonical_mapped_participant_count <> 8
      OR canonical_entry_count <> 8
      OR managed_match_count <> 14 THEN
    RAISE EXCEPTION '0049 legacy-data precondition failed: deterministic playoff coverage is matches %, participants %, mapped participants %, entries %, managed matches %',
      canonical_match_count,
      canonical_participant_count,
      canonical_mapped_participant_count,
      canonical_entry_count,
      managed_match_count;
  END IF;
END $$;
--> statement-breakpoint
-- rivalhub:migration-risk: contract-cleanup v2.8.2 production has the stage-scoped bracket owner and deterministic Release-N backfill coverage; no shipped consumer remains.
DROP TABLE "competition_bracket_states";--> statement-breakpoint
-- rivalhub:migration-risk: contract-cleanup v2.8.2 production has the Major Swiss StageRun projection and zero residual Swiss rows; no shipped consumer remains.
DROP TABLE "swiss_standings";
