-- Adopt the owner-selected eight-challenge thresholds for this event only.
-- Reader-compatible JSON update; all prediction submissions and results stay intact.
WITH changed AS (
  UPDATE prediction_programs p
  SET rules = p.rules || '{"silver":2,"gold":5,"diamond":8}'::jsonb
  FROM seasons s
  WHERE p.season_id = s.id AND s.slug = '2026-nju-major'
    AND p.rules @> '{"silver":4,"gold":6,"diamond":8}'::jsonb
  RETURNING p.season_id
)
INSERT INTO audit_logs (season_id, action, actor_id, target_id, target_type, meta)
SELECT season_id, 'predictions.configure', 'system', season_id::text, 'prediction_program',
  '{"migration":"0093_pickem_coin_thresholds","previous":{"silver":4,"gold":6,"diamond":8},"next":{"silver":2,"gold":5,"diamond":8}}'::jsonb
FROM changed;
