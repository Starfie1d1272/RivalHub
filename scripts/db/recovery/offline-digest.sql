-- Fixture-only prototype. No production CLI, migration, or acceptance gate loads this file.
-- All functions and input relations must belong to this session's temporary schema.
CREATE OR REPLACE FUNCTION pg_temp.offline_digest_frame(value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF value IS NULL THEN RETURN '-1:'; END IF;
  IF octet_length(convert_to(value, 'UTF8')) > 65536 THEN
    RAISE EXCEPTION 'offline digest cell exceeds 64 KiB contract';
  END IF;
  RETURN octet_length(convert_to(value, 'UTF8'))::text || ':' || value;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.offline_digest_row(value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF octet_length(convert_to(value, 'UTF8')) > 262144 THEN
    RAISE EXCEPTION 'offline digest row exceeds 256 KiB contract';
  END IF;
  RETURN value;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.offline_digest_chunk(
  relation regclass, primary_key name, after_key bigint DEFAULT NULL, chunk_size integer DEFAULT 128
) RETURNS TABLE(row_count bigint, last_key bigint, canonical_bytes bigint, digest text)
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
SET enable_seqscan = off
SET enable_bitmapscan = off
AS $$
DECLARE
  column_info record;
  expression text;
  row_expression text := '''''::text';
  header text := 'offline-digest-v1;UTF8;bigint-ASC;';
  column_count integer := 0;
BEGIN
  IF chunk_size IS NULL OR chunk_size < 1 OR chunk_size > 128 THEN
    RAISE EXCEPTION 'offline digest chunk size must be 1..128';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = relation
    AND c.relnamespace = pg_my_temp_schema() AND c.relpersistence = 't' AND c.relkind = 'r') THEN
    RAISE EXCEPTION 'offline digest accepts only session-local temporary fixture tables';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    JOIN pg_class idx ON idx.oid = i.indexrelid JOIN pg_am am ON am.oid = idx.relam
    WHERE i.indrelid = relation AND i.indisprimary AND i.indisvalid AND i.indnkeyatts = 1
      AND a.attname = primary_key AND a.atttypid = 'bigint'::regtype AND am.amname = 'btree'
  ) THEN
    RAISE EXCEPTION 'offline digest requires one bigint btree primary key';
  END IF;
  FOR column_info IN SELECT attname, atttypid FROM pg_attribute
    WHERE attrelid = relation AND attnum > 0 AND NOT attisdropped ORDER BY attnum
  LOOP
    column_count := column_count + 1;
    IF column_count > 64 THEN RAISE EXCEPTION 'offline digest supports at most 64 columns'; END IF;
    -- No client-side Number/Date/JSON conversion. Unsupported types fail before reading rows.
    CASE column_info.atttypid
      WHEN 'numeric'::regtype THEN expression := format('trim_scale(%I)::text', column_info.attname);
      WHEN 'timestamptz'::regtype THEN expression := format(
        'CASE WHEN %1$I IS NULL THEN NULL WHEN isfinite(%1$I) THEN to_char(%1$I AT TIME ZONE ''UTC'', ''YYYY-MM-DD"T"HH24:MI:SS.US AD'') ELSE %1$I::text END', column_info.attname);
      WHEN 'bigint'::regtype, 'integer'::regtype, 'smallint'::regtype, 'text'::regtype, 'boolean'::regtype, 'uuid'::regtype
        THEN expression := format('%I::text', column_info.attname);
      ELSE RAISE EXCEPTION 'offline digest unsupported type (including json/jsonb, floats, arrays and domains)';
    END CASE;
    header := header || pg_temp.offline_digest_frame(column_info.attname::text)
      || pg_temp.offline_digest_frame(column_info.atttypid::regtype::text);
    row_expression := row_expression || ' || pg_temp.offline_digest_frame(' || expression || ')';
  END LOOP;
  -- The only data ORDER BY is the indexed bigint keyset, before a hard LIMIT.
  -- The aggregate sorts at most 128 fixed-size row hashes, never full payloads.
  RETURN QUERY EXECUTE format($query$
    WITH page AS MATERIALIZED (
      SELECT %3$I AS key, pg_temp.offline_digest_row(%4$s) AS value
      FROM %1$s %2$s ORDER BY %3$I LIMIT $2
    )
    SELECT count(*), max(key), coalesce(sum(octet_length(convert_to(value, 'UTF8'))), 0)::bigint,
      encode(sha256(convert_to($3 || coalesce(string_agg(
        encode(sha256(convert_to(value, 'UTF8')), 'hex'), '' ORDER BY key), ''), 'UTF8')), 'hex')
    FROM page
  $query$, relation, CASE WHEN after_key IS NULL THEN '' ELSE format('WHERE %I > $1', primary_key) END,
    primary_key, row_expression)
  USING after_key, chunk_size, header;
END;
$$;
