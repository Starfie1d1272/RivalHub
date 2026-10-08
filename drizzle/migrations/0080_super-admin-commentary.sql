-- Match the application's current season-admin authorization, including global admins.
-- The existing capacity, cancelled-match and submitted-roster guards remain enforced.
CREATE OR REPLACE FUNCTION "public"."enforce_post_match_scope"()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE match_season_id uuid; match_status text;
BEGIN
  IF TG_TABLE_NAME = 'match_commentators' AND TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM post_match_reports WHERE match_id = OLD.match_id) THEN RAISE EXCEPTION 'submitted commentator roster is immutable' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  SELECT season_id, status INTO match_season_id, match_status FROM matches WHERE id = NEW.match_id;
  IF match_season_id IS NULL THEN RAISE EXCEPTION 'match does not exist' USING ERRCODE = '23503'; END IF;
  IF TG_TABLE_NAME = 'match_commentators' THEN
    IF match_status = 'cancelled' THEN RAISE EXCEPTION 'cancelled match cannot have commentators' USING ERRCODE = '23514'; END IF;
    IF EXISTS (SELECT 1 FROM post_match_reports WHERE match_id = NEW.match_id) THEN RAISE EXCEPTION 'submitted commentator roster is immutable' USING ERRCODE = '23514'; END IF;
    IF NOT EXISTS (SELECT 1 FROM season_admin_grants WHERE season_id = match_season_id AND user_id = NEW.user_id)
       AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND role = 'super_admin') THEN RAISE EXCEPTION 'commentator must be a season admin' USING ERRCODE = '23514'; END IF;
    IF (SELECT count(*) FROM match_commentators WHERE match_id = NEW.match_id) >= 2 THEN RAISE EXCEPTION 'a match has at most two commentators' USING ERRCODE = '23514'; END IF;
  ELSE
    IF match_status <> 'finished' THEN RAISE EXCEPTION 'post-match reports require a finished match' USING ERRCODE = '23514'; END IF;
    IF NOT EXISTS (SELECT 1 FROM match_commentators WHERE match_id = NEW.match_id AND user_id = NEW.submitted_by_user_id) THEN RAISE EXCEPTION 'submitter must be a registered commentator' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."enforce_post_match_scope"() FROM PUBLIC, anon, authenticated;
