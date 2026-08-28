-- Keep the public Data API deny-by-default until a future migration defines
-- matching RLS policies and explicit read grants for a public surface.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
