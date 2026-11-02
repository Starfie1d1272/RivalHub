-- Read-only snapshot for the legacy prediction financial retirement assessment.
-- Run with psql -X -v ON_ERROR_STOP=1 -f; no credentials belong in this file.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT transaction_timestamp() AS snapshot_at,
       current_database() AS database_name,
       (SELECT count(*) FROM public.prediction_markets) AS markets,
       (SELECT count(*) FROM public.prediction_market_options) AS options,
       (SELECT count(*) FROM public.prediction_stakes) AS stakes,
       (SELECT count(*) FROM public.prediction_settlements) AS settlements;

-- Aggregate only: do not export account identities or individual ledger rows.
SELECT kind, count(*) AS entries, sum(amount) AS amount, sum(profit) AS profit
FROM public.prediction_ledger
GROUP BY kind
ORDER BY kind;

-- Existing markets may still require settlement or a future correction, even if
-- their latest settlement is terminal. Any market therefore needs review.
SELECT COALESCE(latest.state, 'no_settlement') AS latest_state,
       count(*) AS markets,
       count(*) FILTER (WHERE m.locked_at IS NULL) AS unlocked_markets,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM public.prediction_stakes s WHERE s.market_id = m.id
       )) AS markets_with_stakes
FROM public.prediction_markets m
LEFT JOIN LATERAL (
  SELECT state FROM public.prediction_settlements s
  WHERE s.market_id = m.id
  ORDER BY s.created_at DESC, s.id DESC
  LIMIT 1
) latest ON true
GROUP BY COALESCE(latest.state, 'no_settlement')
ORDER BY latest_state;

COMMIT;
