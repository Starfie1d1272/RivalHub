-- Identity merge is the only controlled operation allowed to reparent a
-- person reference in an otherwise immutable frozen EventRoster.
CREATE OR REPLACE FUNCTION "public"."rivalhub_assert_event_roster_mutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE roster_id uuid;
BEGIN
  IF current_setting('rivalhub.identity_merge_reparent', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  roster_id := COALESCE(NEW.event_roster_id, OLD.event_roster_id);
  IF EXISTS (SELECT 1 FROM event_rosters WHERE id = roster_id AND status = 'frozen') THEN
    RAISE EXCEPTION 'frozen event roster members are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
