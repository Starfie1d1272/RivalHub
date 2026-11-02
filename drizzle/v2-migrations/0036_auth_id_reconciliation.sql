-- Reconcile only the dangling application/Auth mappings that can be proven by
-- one normalized email match. The whole preflight runs before any update.
DO $$
DECLARE
  dangling_count bigint;
  unmatched_count bigint;
  ambiguous_count bigint;
  duplicate_target_count bigint;
  occupied_target_count bigint;
  updated_count bigint;
BEGIN
  -- Vanilla PostgreSQL CI has no Supabase Auth schema. It is safe to no-op
  -- only when there are no mappings whose identity could need reconciliation;
  -- candidates without an Auth source fail closed below.
  IF to_regclass('auth.users') IS NULL THEN
    SELECT count(*)
    INTO dangling_count
    FROM public.users
    WHERE auth_id IS NOT NULL;

    IF dangling_count > 0 THEN
      RAISE EXCEPTION 'auth identity reconciliation refused: auth.users is unavailable for % mapping(s)', dangling_count
        USING ERRCODE = '23514';
    END IF;

    RETURN;
  END IF;

  SELECT count(*)
  INTO dangling_count
  FROM public.users AS application_user
  WHERE application_user.auth_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM auth.users AS auth_user
      WHERE auth_user.id = application_user.auth_id
    );

  IF dangling_count = 0 THEN
    RETURN;
  END IF;

  WITH dangling AS (
    SELECT application_user.id, lower(btrim(application_user.email)) AS normalized_email
    FROM public.users AS application_user
    WHERE application_user.auth_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM auth.users AS auth_user
        WHERE auth_user.id = application_user.auth_id
      )
  ), match_counts AS (
    SELECT dangling.id, count(auth_user.id) AS match_count
    FROM dangling
    LEFT JOIN auth.users AS auth_user
      ON lower(btrim(auth_user.email)) = dangling.normalized_email
    GROUP BY dangling.id
  )
  SELECT
    count(*) FILTER (WHERE match_count = 0),
    count(*) FILTER (WHERE match_count > 1)
  INTO unmatched_count, ambiguous_count
  FROM match_counts;

  WITH dangling AS (
    SELECT application_user.id, lower(btrim(application_user.email)) AS normalized_email
    FROM public.users AS application_user
    WHERE application_user.auth_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM auth.users AS auth_user
        WHERE auth_user.id = application_user.auth_id
      )
  ), unique_matches AS (
    SELECT dangling.id, (array_agg(auth_user.id ORDER BY auth_user.id))[1] AS matched_auth_id
    FROM dangling
    JOIN auth.users AS auth_user
      ON lower(btrim(auth_user.email)) = dangling.normalized_email
    GROUP BY dangling.id
    HAVING count(auth_user.id) = 1
  )
  SELECT count(*)
  INTO duplicate_target_count
  FROM (
    SELECT matched_auth_id
    FROM unique_matches
    GROUP BY matched_auth_id
    HAVING count(*) > 1
  ) AS duplicate_targets;

  WITH dangling AS (
    SELECT application_user.id, lower(btrim(application_user.email)) AS normalized_email
    FROM public.users AS application_user
    WHERE application_user.auth_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM auth.users AS auth_user
        WHERE auth_user.id = application_user.auth_id
      )
  ), unique_matches AS (
    SELECT dangling.id, (array_agg(auth_user.id ORDER BY auth_user.id))[1] AS matched_auth_id
    FROM dangling
    JOIN auth.users AS auth_user
      ON lower(btrim(auth_user.email)) = dangling.normalized_email
    GROUP BY dangling.id
    HAVING count(auth_user.id) = 1
  )
  SELECT count(*)
  INTO occupied_target_count
  FROM unique_matches
  JOIN public.users AS already_bound
    ON already_bound.auth_id = unique_matches.matched_auth_id
   AND already_bound.id <> unique_matches.id;

  IF unmatched_count > 0
     OR ambiguous_count > 0
     OR duplicate_target_count > 0
     OR occupied_target_count > 0 THEN
    RAISE EXCEPTION 'auth identity reconciliation refused: dangling=% unmatched=% ambiguous=% duplicate_targets=% occupied_targets=%',
      dangling_count, unmatched_count, ambiguous_count, duplicate_target_count, occupied_target_count
      USING ERRCODE = '23514';
  END IF;

  WITH dangling AS (
    SELECT application_user.id, lower(btrim(application_user.email)) AS normalized_email
    FROM public.users AS application_user
    WHERE application_user.auth_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM auth.users AS auth_user
        WHERE auth_user.id = application_user.auth_id
      )
  ), unique_matches AS (
    SELECT dangling.id, (array_agg(auth_user.id ORDER BY auth_user.id))[1] AS matched_auth_id
    FROM dangling
    JOIN auth.users AS auth_user
      ON lower(btrim(auth_user.email)) = dangling.normalized_email
    GROUP BY dangling.id
    HAVING count(auth_user.id) = 1
  )
  UPDATE public.users AS application_user
  SET auth_id = unique_matches.matched_auth_id,
      updated_at = now()
  FROM unique_matches
  WHERE application_user.id = unique_matches.id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> dangling_count THEN
    RAISE EXCEPTION 'auth identity reconciliation refused: expected=% updated=%', dangling_count, updated_count
      USING ERRCODE = '23514';
  END IF;
END
$$;
