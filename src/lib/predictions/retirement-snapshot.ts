// The matching expression in 0109 is kept byte-for-byte equivalent. UTC is required by both callers.
export const LEGACY_RETIREMENT_SNAPSHOT_SQL = `encode(sha256(convert_to(jsonb_build_object(
  'accounts', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.prediction_accounts t),
  'markets', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.prediction_markets t),
  'options', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.prediction_market_options t),
  'stakes', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.prediction_stakes t),
  'settlements', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.prediction_settlements t),
  'ledger', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.prediction_ledger t),
  'matches', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.matches t),
  'runs', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.major_stage_runs t),
  'finals', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.major_final_results t)
)::text, 'UTF8')), 'hex')`;
