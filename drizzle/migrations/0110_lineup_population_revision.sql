CREATE TABLE "lineup_population_state" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"recent_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_transaction_id" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "lineup_population_state_singleton" CHECK ("lineup_population_state"."id")
);
--> statement-breakpoint
ALTER TABLE public.lineup_population_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lineup_population_state FROM PUBLIC, anon, authenticated;
INSERT INTO public.lineup_population_state DEFAULT VALUES;
--> statement-breakpoint
CREATE FUNCTION public.advance_lineup_population_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE
  writer bigint := txid_current();
  affected_from timestamptz;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'match_veto_invalidations' THEN
      SELECT m.completed_at INTO affected_from
      FROM matches m JOIN seasons s ON s.id = m.season_id
      WHERE m.id = NEW.match_id AND m.status = 'finished' AND m.test_config IS NULL AND s.status <> 'draft';
      IF affected_from IS NULL THEN RETURN NULL; END IF;
    WHEN 'matches' THEN
      affected_from := OLD.completed_at;
      IF affected_from IS NULL THEN RETURN NULL; END IF;
    WHEN 'seasons' THEN
      SELECT min(completed_at) INTO affected_from FROM matches
      WHERE season_id = NEW.id AND status = 'finished' AND test_config IS NULL;
      IF affected_from IS NULL THEN RETURN NULL; END IF;
    WHEN 'event_roster_members' THEN
      SELECT min(m.completed_at) INTO affected_from
      FROM match_roster_players p JOIN match_rosters r ON r.id = p.roster_id
      JOIN matches m ON m.id = r.match_id JOIN seasons s ON s.id = m.season_id
      WHERE p.event_roster_member_id = NEW.id AND p.is_starter
        AND m.status = 'finished' AND m.test_config IS NULL AND s.status <> 'draft';
      IF affected_from IS NULL THEN RETURN NULL; END IF;
    ELSE
      -- An identity change can reach any historical cutoff.
      affected_from := NULL;
  END CASE;
  IF TG_TABLE_NAME = 'user_gameplay_steam_ids' THEN
    IF TG_OP = 'INSERT' AND NEW.status <> 'active' THEN RETURN NULL; END IF;
    IF TG_OP = 'DELETE' AND OLD.status <> 'active' THEN RETURN NULL; END IF;
    IF TG_OP = 'UPDATE' AND (
      (OLD.status <> 'active' AND NEW.status <> 'active') OR
      ROW(OLD.user_id, OLD.steam64, OLD.status) IS NOT DISTINCT FROM ROW(NEW.user_id, NEW.steam64, NEW.status)
    ) THEN RETURN NULL; END IF;
  END IF;
  UPDATE lineup_population_state
  SET revision = CASE WHEN last_transaction_id = writer THEN revision ELSE gen_random_uuid() END,
      recent_changes = CASE WHEN last_transaction_id = writer THEN
        jsonb_set(recent_changes, '{0,affectedFrom}', coalesce(to_jsonb(affected_from), 'null'::jsonb))
        ELSE jsonb_build_array(jsonb_build_object('revision', revision, 'affectedFrom', affected_from))
          || (recent_changes - 15) END,
      last_transaction_id = writer
  WHERE id AND (
    last_transaction_id <> writer OR (
      recent_changes->0->>'affectedFrom' IS NOT NULL AND
      (affected_from IS NULL OR (recent_changes->0->>'affectedFrom')::timestamptz > affected_from)
    )
  );
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.advance_lineup_population_revision() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- Commit-time coalescing leaves match and identity lock ordering intact.
CREATE CONSTRAINT TRIGGER lineup_population_match_insert
AFTER INSERT ON public.match_veto_invalidations DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.affected_facts ?| ARRAY['statistics','map_plan','lineups'])
EXECUTE FUNCTION public.advance_lineup_population_revision();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER lineup_population_match_update
AFTER UPDATE ON public.match_veto_invalidations DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (
  NEW.affected_facts ?| ARRAY['statistics','map_plan','lineups'] AND
  ROW(OLD.generation, OLD.affected_facts) IS DISTINCT FROM ROW(NEW.generation, NEW.affected_facts)
)
EXECUTE FUNCTION public.advance_lineup_population_revision();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER lineup_population_match_leaves
AFTER UPDATE ON public.matches DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (
  OLD.status = 'finished' AND OLD.test_config IS NULL AND
  (NEW.status <> 'finished' OR NEW.test_config IS NOT NULL OR OLD.season_id IS DISTINCT FROM NEW.season_id
    OR OLD.completed_at IS DISTINCT FROM NEW.completed_at)
)
EXECUTE FUNCTION public.advance_lineup_population_revision();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER lineup_population_match_delete
AFTER DELETE ON public.matches DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (OLD.status = 'finished' AND OLD.test_config IS NULL)
EXECUTE FUNCTION public.advance_lineup_population_revision();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER lineup_population_visibility
AFTER UPDATE ON public.seasons DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN ((OLD.status = 'draft') IS DISTINCT FROM (NEW.status = 'draft'))
EXECUTE FUNCTION public.advance_lineup_population_revision();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER lineup_population_primary_identity
AFTER UPDATE ON public.users DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (ROW(OLD.status, OLD.steam64) IS DISTINCT FROM ROW(NEW.status, NEW.steam64))
EXECUTE FUNCTION public.advance_lineup_population_revision();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER lineup_population_new_primary_identity
AFTER INSERT ON public.users DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.status = 'active' AND NEW.steam64 IS NOT NULL)
EXECUTE FUNCTION public.advance_lineup_population_revision();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER lineup_population_removed_primary_identity
AFTER DELETE ON public.users DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (OLD.status = 'active' AND OLD.steam64 IS NOT NULL)
EXECUTE FUNCTION public.advance_lineup_population_revision();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER lineup_population_alias_identity
AFTER INSERT OR UPDATE OR DELETE ON public.user_gameplay_steam_ids DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.advance_lineup_population_revision();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER lineup_population_roster_identity
AFTER UPDATE ON public.event_roster_members DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)
EXECUTE FUNCTION public.advance_lineup_population_revision();
