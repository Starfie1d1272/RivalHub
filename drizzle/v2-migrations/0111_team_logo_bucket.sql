-- Plain PostgreSQL replay has no Storage provider. Hosted/Local Supabase owns
-- its internal schema; this migration only supplies the application bucket.
DO $$
DECLARE
  contract_ok boolean;
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RETURN;
  END IF;

  -- Never change a pre-existing bucket: a mismatch needs operator review.
  EXECUTE 'INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ($1, $1, true, $2, $3) ON CONFLICT DO NOTHING'
    USING 'team-logos', 1048576, ARRAY['image/jpeg', 'image/png', 'image/webp']::text[];

  EXECUTE 'SELECT count(*) = 1 AND bool_and(id = $1 AND name = $1 AND public IS TRUE
      AND file_size_limit = $2 AND ARRAY(SELECT unnest(allowed_mime_types) ORDER BY 1) = $3)
    FROM storage.buckets WHERE id = $1 OR name = $1'
    INTO contract_ok
    USING 'team-logos', 1048576, ARRAY['image/jpeg', 'image/png', 'image/webp']::text[];
  IF contract_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'team-logos bucket exists with an incompatible identity, visibility, size or MIME contract';
  END IF;
END $$;
