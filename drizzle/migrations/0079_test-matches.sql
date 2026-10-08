ALTER TABLE "matches" ADD COLUMN "test_config" jsonb;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Existing rows have NULL test_config; only newly created test executions are restricted.
ALTER TABLE "matches" ADD CONSTRAINT "matches_test_shape" CHECK ("matches"."test_config" IS NULL OR ("matches"."season_id" IS NOT NULL AND "matches"."stage" = 'test' AND "matches"."ownership" = 'manual' AND "matches"."major_stage_run_id" IS NULL AND "matches"."qualification_run_id" IS NULL AND "matches"."bracket_node_id" IS NULL AND "matches"."managed_key" IS NULL AND jsonb_typeof("matches"."test_config") = 'object' AND jsonb_typeof("matches"."test_config"->'mapPool') = 'array' AND jsonb_array_length("matches"."test_config"->'mapPool') = 7 AND jsonb_typeof("matches"."test_config"->'operatorAId') = 'string' AND jsonb_typeof("matches"."test_config"->'operatorBId') = 'string' AND "matches"."test_config"->>'operatorAId' <> "matches"."test_config"->>'operatorBId') IS TRUE);

--> statement-breakpoint
CREATE FUNCTION public.rivalhub_test_match_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  IF (OLD.test_config IS NULL) IS DISTINCT FROM (NEW.test_config IS NULL) THEN
    RAISE EXCEPTION 'Match test purpose is immutable';
  END IF;
  IF OLD.test_config IS NOT NULL AND (
    OLD.season_id IS DISTINCT FROM NEW.season_id OR
    OLD.entry_a_id IS DISTINCT FROM NEW.entry_a_id OR
    OLD.entry_b_id IS DISTINCT FROM NEW.entry_b_id OR
    OLD.test_config->'mapPool' IS DISTINCT FROM NEW.test_config->'mapPool' OR
    OLD.test_config->'eligibility' IS DISTINCT FROM NEW.test_config->'eligibility'
  ) THEN
    RAISE EXCEPTION 'Test match affiliation, participants and map pool are frozen';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER test_match_identity BEFORE UPDATE ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.rivalhub_test_match_identity();
