-- Normalize the legacy BO1 score unit before enforcing the all-format series contract.
-- This migration deliberately does not identify or print individual match data.
DO $$
DECLARE
  incomplete_matches bigint;
  incomplete_maps bigint;
  malformed_bo1 bigint;
  malformed_series bigint;
BEGIN
  SELECT count(*) INTO incomplete_matches
  FROM "matches"
  WHERE ("score_a" IS NULL) <> ("score_b" IS NULL);

  SELECT count(*) INTO incomplete_maps
  FROM "match_maps"
  WHERE ("score_a" IS NULL) <> ("score_b" IS NULL);

  WITH bo1_facts AS (
    SELECT
      m."id",
      m."score_a",
      m."score_b",
      m."status",
      m."is_forfeit",
      count(mm."id")::integer AS map_count,
      count(mm."id") FILTER (WHERE mm."score_a" IS NOT NULL AND mm."score_b" IS NOT NULL)::integer AS scored_count,
      count(mm."id") FILTER (WHERE (mm."score_a" IS NULL) <> (mm."score_b" IS NULL))::integer AS partial_count,
      count(mm."id") FILTER (WHERE mm."score_a" > mm."score_b")::integer AS scored_a_wins,
      count(mm."id") FILTER (WHERE mm."score_b" > mm."score_a")::integer AS scored_b_wins,
      COALESCE(
        m."score_a" IS NOT NULL
        AND m."score_b" IS NOT NULL
        AND (
          (GREATEST(m."score_a", m."score_b") = 1 AND LEAST(m."score_a", m."score_b") = 0)
        ),
        false
      ) AS canonical_series,
      COALESCE(
        m."score_a" IS NOT NULL
        AND m."score_b" IS NOT NULL
        AND GREATEST(m."score_a", m."score_b") >= 13
        AND (GREATEST(m."score_a", m."score_b") - 13) % 3 = 0
        AND LEAST(m."score_a", m."score_b") >= 0
        AND LEAST(m."score_a", m."score_b") < GREATEST(m."score_a", m."score_b"),
        false
      ) AS legacy_round,
      COALESCE(
        m."is_forfeit"
        AND m."score_a" IS NOT NULL
        AND m."score_b" IS NOT NULL
        AND GREATEST(m."score_a", m."score_b") = 13
        AND LEAST(m."score_a", m."score_b") = 0,
        false
      ) AS legacy_forfeit
    FROM "matches" m
    LEFT JOIN "match_maps" mm ON mm."match_id" = m."id"
    WHERE m."format" = 'bo1'
    GROUP BY m."id", m."score_a", m."score_b", m."status", m."is_forfeit"
  )
  SELECT count(*) INTO malformed_bo1
  FROM bo1_facts
  WHERE
    ("status" = 'finished' AND "score_a" IS NULL AND "score_b" IS NULL)
    OR (
      "score_a" IS NOT NULL
      AND "score_b" IS NOT NULL
      AND NOT "canonical_series"
      AND NOT (
        "status" = 'finished'
        AND (
          (NOT "is_forfeit" AND "legacy_round" AND map_count = 1 AND scored_count = 0 AND partial_count = 0)
          OR ("is_forfeit" AND "legacy_forfeit" AND scored_count = 0 AND partial_count = 0)
        )
      )
    )
    OR (
      "status" = 'finished'
    AND NOT "is_forfeit"
    AND "canonical_series"
      AND (
        map_count <> 1
        OR scored_count <> 1
        OR partial_count <> 0
        OR NOT (
          ("score_a" = 1 AND "score_b" = 0 AND scored_a_wins = 1)
          OR ("score_a" = 0 AND "score_b" = 1 AND scored_b_wins = 1)
        )
      )
    )
    OR (
      "status" = 'finished'
      AND "is_forfeit"
      AND "legacy_forfeit"
      AND (scored_count <> 0 OR partial_count <> 0)
    );

  SELECT count(*) INTO malformed_series
  FROM "matches" m
  WHERE m."score_a" IS NOT NULL
    AND m."score_b" IS NOT NULL
    AND (
      (m."format" = 'bo3' AND NOT (
        GREATEST(m."score_a", m."score_b") = 2
        AND LEAST(m."score_a", m."score_b") BETWEEN 0 AND 1
      ))
      OR (m."format" = 'bo5' AND NOT (
        GREATEST(m."score_a", m."score_b") = 3
        AND LEAST(m."score_a", m."score_b") BETWEEN 0 AND 2
      ))
    );

  IF incomplete_matches > 0 OR incomplete_maps > 0 OR malformed_bo1 > 0 OR malformed_series > 0 THEN
    RAISE EXCEPTION
      'match score semantics preflight failed (incomplete_matches=%, incomplete_maps=%, malformed_bo1=%, malformed_series=%)',
      incomplete_matches, incomplete_maps, malformed_bo1, malformed_series;
  END IF;
END
$$;
--> statement-breakpoint

-- Legacy non-forfeit BO1: preserve the existing map row and move its round fact
-- out of matches before converting matches to a 1:0/0:1 series result.
UPDATE "match_maps" mm
SET
  "score_a" = m."score_a",
  "score_b" = m."score_b",
  "completed_at" = COALESCE(mm."completed_at", m."completed_at")
FROM "matches" m
WHERE m."id" = mm."match_id"
  AND m."format" = 'bo1'
  AND m."status" = 'finished'
  AND NOT m."is_forfeit"
  AND m."score_a" IS NOT NULL
  AND m."score_b" IS NOT NULL
  AND GREATEST(m."score_a", m."score_b") >= 13
  AND (GREATEST(m."score_a", m."score_b") - 13) % 3 = 0
  AND LEAST(m."score_a", m."score_b") >= 0
  AND LEAST(m."score_a", m."score_b") < GREATEST(m."score_a", m."score_b")
  AND mm."score_a" IS NULL
  AND mm."score_b" IS NULL;--> statement-breakpoint

UPDATE "matches"
SET
  "score_a" = CASE WHEN "score_a" > "score_b" THEN 1 ELSE 0 END,
  "score_b" = CASE WHEN "score_b" > "score_a" THEN 1 ELSE 0 END
WHERE "format" = 'bo1'
  AND "status" = 'finished'
  AND NOT "is_forfeit"
  AND "score_a" IS NOT NULL
  AND "score_b" IS NOT NULL
  AND GREATEST("score_a", "score_b") >= 13
  AND (GREATEST("score_a", "score_b") - 13) % 3 = 0
  AND LEAST("score_a", "score_b") >= 0
  AND LEAST("score_a", "score_b") < GREATEST("score_a", "score_b");--> statement-breakpoint

-- Legacy BO1 forfeits become official series results only; no map row is created.
UPDATE "matches"
SET
  "score_a" = CASE WHEN "score_a" > "score_b" THEN 1 ELSE 0 END,
  "score_b" = CASE WHEN "score_b" > "score_a" THEN 1 ELSE 0 END
WHERE "format" = 'bo1'
  AND "status" = 'finished'
  AND "is_forfeit"
  AND "score_a" IS NOT NULL
  AND "score_b" IS NOT NULL
  AND GREATEST("score_a", "score_b") = 13
  AND LEAST("score_a", "score_b") = 0;--> statement-breakpoint

-- A forfeited match keeps scored real maps but drops only pending/unscored rows.
DELETE FROM "match_maps" mm
USING "matches" m
WHERE m."id" = mm."match_id"
  AND m."format" = 'bo1'
  AND m."status" = 'finished'
  AND m."is_forfeit"
  AND mm."score_a" IS NULL
  AND mm."score_b" IS NULL;--> statement-breakpoint

-- The three constraints are guarded so the data migration logic is safe to
-- replay in a scratch database after the row values are already canonical.
-- rivalhub:migration-risk: locking-reviewed short constraint validation is performed after the fail-closed preflight and data normalization above
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matches_score_pair_complete'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE "matches" ADD CONSTRAINT "matches_score_pair_complete"
      CHECK (("score_a" IS NULL AND "score_b" IS NULL) OR ("score_a" IS NOT NULL AND "score_b" IS NOT NULL));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matches_series_score_shape'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE "matches" ADD CONSTRAINT "matches_series_score_shape"
      CHECK (("score_a" IS NULL AND "score_b" IS NULL)
        OR ("format" = 'bo1' AND GREATEST("score_a", "score_b") = 1 AND LEAST("score_a", "score_b") = 0)
        OR ("format" = 'bo3' AND GREATEST("score_a", "score_b") = 2 AND LEAST("score_a", "score_b") BETWEEN 0 AND 1)
        OR ("format" = 'bo5' AND GREATEST("score_a", "score_b") = 3 AND LEAST("score_a", "score_b") BETWEEN 0 AND 2));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'match_maps_score_pair_complete'
      AND conrelid = 'public.match_maps'::regclass
  ) THEN
    ALTER TABLE "match_maps" ADD CONSTRAINT "match_maps_score_pair_complete"
      CHECK (("score_a" IS NULL AND "score_b" IS NULL) OR ("score_a" IS NOT NULL AND "score_b" IS NOT NULL));
  END IF;
END
$$;
