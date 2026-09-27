-- Final placements cover the materialized entrant set for both supported Major profiles.
CREATE OR REPLACE FUNCTION "public"."validate_major_final_result"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  group_value jsonb;
  entry_value jsonb;
  expected_from integer := 1;
  placement_count integer := 0;
  entrant_count integer := 0;
  first_entry uuid;
  entry_id uuid;
BEGIN
  SELECT count(*) INTO entrant_count
  FROM "public"."major_tournament_entrants"
  WHERE "season_id" = NEW.season_id;

  IF jsonb_typeof(NEW.placement_groups) <> 'array' THEN
    RAISE EXCEPTION 'major_final_results placement_groups must be an array';
  END IF;

  FOR group_value IN SELECT value FROM jsonb_array_elements(NEW.placement_groups) LOOP
    IF jsonb_typeof(group_value) <> 'object'
      OR NOT (group_value ? 'from' AND group_value ? 'to' AND group_value ? 'entryIds')
      OR jsonb_typeof(group_value->'entryIds') <> 'array' THEN
      RAISE EXCEPTION 'major_final_results placement group shape invalid';
    END IF;
    IF (group_value->>'from') !~ '^[0-9]+$' OR (group_value->>'to') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'major_final_results placement range invalid';
    END IF;
    IF (group_value->>'from')::integer <> expected_from
      OR (group_value->>'to')::integer < expected_from
      OR jsonb_array_length(group_value->'entryIds') <> (group_value->>'to')::integer - expected_from + 1 THEN
      RAISE EXCEPTION 'major_final_results placement groups not contiguous';
    END IF;
    FOR entry_value IN SELECT value FROM jsonb_array_elements(group_value->'entryIds') LOOP
      BEGIN
        entry_id := trim(both '"' from entry_value::text)::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'major_final_results entry id invalid';
      END;
      IF placement_count = 0 THEN first_entry := entry_id; END IF;
      IF NOT EXISTS (
        SELECT 1 FROM "public"."competition_entries"
        WHERE id = entry_id AND competition_id = NEW.season_id
      ) THEN
        RAISE EXCEPTION 'major_final_results entry outside season';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM "public"."major_tournament_entrants"
        WHERE season_id = NEW.season_id AND competition_entry_id = entry_id
      ) THEN
        RAISE EXCEPTION 'major_final_results entry outside materialized entrants';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(NEW.placement_groups) g,
             jsonb_array_elements(g.value->'entryIds') e
        WHERE trim(both '"' from e.value::text)::uuid = entry_id
      ) AND placement_count > 0 THEN
        IF (
          SELECT count(*)
          FROM jsonb_array_elements(NEW.placement_groups) g,
               jsonb_array_elements(g.value->'entryIds') e
          WHERE trim(both '"' from e.value::text)::uuid = entry_id
        ) > 1 THEN
          RAISE EXCEPTION 'major_final_results duplicate entry';
        END IF;
      END IF;
      placement_count := placement_count + 1;
    END LOOP;
    expected_from := (group_value->>'to')::integer + 1;
  END LOOP;

  IF expected_from <> entrant_count + 1
    OR placement_count <> entrant_count
    OR first_entry IS DISTINCT FROM NEW.champion_entry_id THEN
    RAISE EXCEPTION 'major_final_results champion/placement mismatch';
  END IF;
  RETURN NEW;
END $$;
