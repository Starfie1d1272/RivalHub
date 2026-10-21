-- One-time, owner-selected change to this event's coin thresholds.
-- Exclusive lock and transaction-local trigger suspension keep concurrent writers
-- fenced. The original freeze trigger is restored before the migration commits;
-- any error rolls the entire statement back, including trigger state and audit.
DO $$
BEGIN
  LOCK TABLE public.prediction_programs IN ACCESS EXCLUSIVE MODE;
  ALTER TABLE public.prediction_programs DISABLE TRIGGER prediction_frozen_config;
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

  ALTER TABLE public.prediction_programs ENABLE TRIGGER prediction_frozen_config;
END $$;
