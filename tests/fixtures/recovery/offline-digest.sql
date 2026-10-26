-- Run after scripts/db/recovery/offline-digest.sql in a disposable local PG session.
BEGIN;
SET LOCAL statement_timeout = '10s';
CREATE TEMP TABLE digest_source (id bigint PRIMARY KEY, amount numeric, at timestamptz, note text, enabled boolean);
CREATE TEMP TABLE digest_target (LIKE digest_source INCLUDING ALL);
INSERT INTO digest_source VALUES
  (-9, 9007199254740993.12345678901234567890, '2026-10-26 00:00:00.123456+00', NULL, true),
  (2, 1.000, '2026-10-26 09:00:00.000001+09', '', false),
  (9007199254740993, -0.000001, '2026-10-26 00:00:00.000002+00', E'中文\n:é', NULL);
INSERT INTO digest_target SELECT * FROM digest_source ORDER BY id DESC;
UPDATE digest_target SET amount = 1 WHERE id = 2;
DO $$
DECLARE a record; b record; cursor_key bigint := NULL; total bigint := 0; chunks integer := 0;
BEGIN
  LOOP
    SELECT * INTO a FROM pg_temp.offline_digest_chunk('digest_source', 'id', cursor_key, 2);
    SET LOCAL timezone = 'Asia/Tokyo';
    SELECT * INTO b FROM pg_temp.offline_digest_chunk('digest_target', 'id', cursor_key, 2);
    IF a IS DISTINCT FROM b THEN RAISE EXCEPTION 'reordered equivalent fixture mismatch'; END IF;
    EXIT WHEN a.row_count = 0;
    total := total + a.row_count; chunks := chunks + 1; cursor_key := a.last_key;
  END LOOP;
  IF total <> 3 OR chunks <> 2 THEN RAISE EXCEPTION 'keyset count/boundary failure'; END IF;
  SELECT * INTO a FROM pg_temp.offline_digest_chunk('digest_source', 'id');
  UPDATE digest_target SET at = at + interval '1 microsecond' WHERE id = -9;
  SELECT * INTO b FROM pg_temp.offline_digest_chunk('digest_target', 'id');
  IF a.digest = b.digest THEN RAISE EXCEPTION 'microsecond change missed'; END IF;
  UPDATE digest_target SET at = at - interval '1 microsecond', amount = amount + 0.00000000000000000001 WHERE id = -9;
  SELECT * INTO b FROM pg_temp.offline_digest_chunk('digest_target', 'id');
  IF a.digest = b.digest THEN RAISE EXCEPTION 'lossless numeric change missed'; END IF;
  UPDATE digest_target SET amount = amount - 0.00000000000000000001, note = '' WHERE id = -9;
  SELECT * INTO b FROM pg_temp.offline_digest_chunk('digest_target', 'id');
  IF a.digest = b.digest THEN RAISE EXCEPTION 'NULL versus empty missed'; END IF;
  RAISE NOTICE 'PASS: keyset, row order, exact numeric, UTC microseconds, NULL and UTF8';
END $$;
CREATE TEMP TABLE digest_json (id bigint PRIMARY KEY, value jsonb);
CREATE TEMP TABLE digest_large (id bigint PRIMARY KEY, value text);
CREATE TEMP TABLE digest_wide (id bigint PRIMARY KEY, a text, b text, c text, d text);
INSERT INTO digest_wide VALUES (1, repeat('x',65536), repeat('x',65536), repeat('x',65536), repeat('x',65536));
INSERT INTO digest_large VALUES (1, repeat('x', 65537));
DO $$
BEGIN
  BEGIN
    PERFORM pg_temp.offline_digest_chunk('digest_json', 'id');
    RAISE EXCEPTION 'jsonb accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'offline digest unsupported type%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM pg_temp.offline_digest_chunk('pg_catalog.pg_class', 'oid');
    RAISE EXCEPTION 'permanent relation accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'offline digest accepts only%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM pg_temp.offline_digest_chunk('digest_large', 'id');
    RAISE EXCEPTION 'oversized cell accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'offline digest cell exceeds%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM pg_temp.offline_digest_chunk('digest_wide', 'id');
    RAISE EXCEPTION 'oversized row accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'offline digest row exceeds%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM pg_temp.offline_digest_chunk('digest_source', 'id', NULL, 129);
    RAISE EXCEPTION 'unbounded chunk accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'offline digest chunk size%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: jsonb, permanent target, oversized cell and unbounded chunk fail closed';
END $$;
SELECT row_count, canonical_bytes, length(digest) AS digest_hex_characters
FROM pg_temp.offline_digest_chunk('digest_source', 'id', NULL, 2);
ROLLBACK;
