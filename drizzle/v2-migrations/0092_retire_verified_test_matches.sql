-- One-time owner-authorized retirement of two completed rehearsals.
-- Intentionally irreversible: protected release must create its DB checkpoint.
-- Never select by stage alone or delete future rehearsal records.
DO $$
DECLARE target record;
BEGIN
  FOR target IN
    SELECT m.* FROM public.matches m
    WHERE m.id IN ('36f748a5-2753-4d0f-acdd-9849666fd2ac'::uuid, 'd4de85cc-3f9a-451d-ad1d-41e6b8ef910f'::uuid)
    ORDER BY m.id FOR UPDATE
  LOOP
    IF target.test_config IS NULL OR target.stage <> 'test' OR target.status <> 'finished'
       OR target.ownership <> 'manual' OR target.major_stage_run_id IS NOT NULL
       OR target.qualification_run_id IS NOT NULL OR target.bracket_node_id IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM public.seasons WHERE id = target.season_id AND slug = '2026-nju-major') THEN
      RAISE EXCEPTION 'Rehearsal retirement target no longer matches approved scope';
    END IF;
    -- Fail closed on unexpected financial, adjudication, or imported evidence links.
    IF EXISTS (SELECT 1 FROM public.bet_markets WHERE match_id = target.id)
       OR EXISTS (SELECT 1 FROM public.prediction_markets WHERE match_id = target.id)
       OR EXISTS (SELECT 1 FROM public.community_award_evidence WHERE match_id = target.id)
       OR EXISTS (SELECT 1 FROM public.post_event_adjudications WHERE target_match_id = target.id)
       OR EXISTS (SELECT 1 FROM public.match_demo_imports WHERE match_id = target.id)
       OR EXISTS (SELECT 1 FROM public.match_player_stats WHERE match_id = target.id)
       OR EXISTS (SELECT 1 FROM public.match_mvp_votes WHERE match_id = target.id)
       OR EXISTS (SELECT 1 FROM public.free_prediction_choices WHERE match_id = target.id) THEN
      RAISE EXCEPTION 'Rehearsal retirement has unexpected dependent evidence; review required';
    END IF;
    INSERT INTO public.audit_logs (season_id, action, actor_id, target_id, target_type, meta)
    VALUES (target.season_id, 'match.delete', 'system', target.id::text, 'match',
      jsonb_build_object('purpose', 'retire_completed_test', 'migration', '0092_retire_verified_test_matches',
        'entryAId', target.entry_a_id, 'entryBId', target.entry_b_id, 'status', target.status,
        'mapCount', (SELECT count(*) FROM public.match_maps WHERE match_id = target.id)));
    -- Release the submitted-commentator guard before deleting its roster.
    DELETE FROM public.post_match_reports WHERE match_id = target.id;
    DELETE FROM public.match_commentators WHERE match_id = target.id;
    DELETE FROM public.free_prediction_locks WHERE match_id = target.id;
    DELETE FROM public.match_time_proposals WHERE match_id = target.id;
    DELETE FROM public.match_veto_steps WHERE match_id = target.id;
    DELETE FROM public.match_maps WHERE match_id = target.id;
    DELETE FROM public.match_rosters WHERE match_id = target.id;
    -- Explicit match FKs cascade only execution-owned records (BP, coverage,
    -- reports, live sessions and their receipts). Team/user/roster identities stay.
    DELETE FROM public.matches WHERE id = target.id;
  END LOOP;
END $$;
