import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { exportQuery, previewPolicyFor } from "./policy";
import { readExpectedMigrations } from "../production-preflight";

const dir = resolve("drizzle/migrations");
const policy = previewPolicyFor(readExpectedMigrations());

const branches = Object.keys(policy.tables).sort().map((table) =>
  `    WHEN '${table}' THEN\n      RETURN QUERY SELECT to_jsonb(mirror_row) FROM (\n        ${exportQuery(table, policy)}\n      ) AS mirror_row;`,
).join("\n");

const sql = `-- Generated from scripts/db/preview/policy.ts by reader-sql.ts.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rivalhub_preview_exporter') THEN
    CREATE ROLE rivalhub_preview_exporter NOLOGIN NOINHERIT CONNECTION LIMIT 1;
  END IF;
END $$;
--> statement-breakpoint
ALTER ROLE rivalhub_preview_exporter SET default_transaction_read_only = on;
ALTER ROLE rivalhub_preview_exporter SET statement_timeout = '60s';
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS rivalhub_preview;
REVOKE ALL ON SCHEMA rivalhub_preview FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA rivalhub_preview TO rivalhub_preview_exporter;
DO $$ BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    GRANT USAGE ON SCHEMA drizzle TO rivalhub_preview_exporter;
    GRANT SELECT (hash, created_at) ON drizzle.__drizzle_migrations TO rivalhub_preview_exporter;
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION rivalhub_preview.export_table(table_name text) RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  CASE table_name
${branches}
    ELSE RAISE EXCEPTION 'Unsupported Preview export table' USING ERRCODE = '22023';
  END CASE;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION rivalhub_preview.export_table(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION rivalhub_preview.export_table(text) TO rivalhub_preview_exporter;
`;

if (process.argv.includes("--check")) {
  const latest = readdirSync(dir).filter((name) => /^\d+_preview_reader\.sql$/.test(name)).sort().at(-1);
  if (!latest || readFileSync(resolve(dir, latest), "utf8") !== sql)
    throw new Error("Preview reader projection drift: generate a new custom preview_reader migration.");
} else {
  process.stdout.write(sql);
}
