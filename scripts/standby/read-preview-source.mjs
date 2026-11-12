import { once } from "node:events";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { postgresConnection } from "../../src/db/postgres-connection.ts";
import { assertProductionDatabaseUrl } from "../db/production-environment.ts";
import { assertProductionStandbyEnvironment } from "./start-production.mjs";

const root = new URL("../../", import.meta.url);
const { Client } = createRequire(new URL("server.js", root))("pg");

const demoImports = "match_demo_imports";
const demoProjections = "match_demo_stat_projections";

async function write(line) {
  if (!process.stdout.write(line + "\n")) await once(process.stdout, "drain");
}

async function readPreviewSource(client, tables, { sourceCommit, releaseTag }) {
  if (!tables.length || tables.some((table) => !/^[a-z_][a-z_0-9]*$/.test(table))) {
    throw new Error("Invalid packaged Preview table list.");
  }

  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  let phase = "metadata";
  try {
    await client.query("SET LOCAL statement_timeout = '40s'");
    const { rows: [role] } = await client.query("SELECT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname = 'rivalhub_preview_exporter'");
    if (role?.rolcanlogin !== false) throw new Error("Preview database login must be disabled.");
    const { rows: ledger } = await client.query("SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY created_at");
    const { rows: columns } = await client.query(
      "SELECT c.relname AS table_name, a.attname AS column_name FROM pg_catalog.pg_class c " +
      "JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid " +
      "WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f') " +
      "AND a.attnum > 0 AND NOT a.attisdropped ORDER BY c.relname, a.attnum",
    );
    const migrations = ledger.map(({ hash, created_at }) => ({ hash, when: Number(created_at) }));
    await write(JSON.stringify({ format: 1, sourceCommit, sourceTag: releaseTag, migrations, columns, tables }));
    // Raw Demo evidence and projections have much larger rows than the other tables.
    for (const group of [
      { phase: "compact", names: tables.filter((table) => table !== demoImports && table !== demoProjections), size: 512 },
      { phase: "demo-imports", names: tables.filter((table) => table === demoImports), size: 8 },
      { phase: "demo-projections", names: tables.filter((table) => table === demoProjections), size: 32 },
    ]) {
      if (!group.names.length) continue;
      phase = group.phase;
      const names = group.names.map((table) => "'" + table + "'").join(",");
      await client.query(
        "DECLARE preview_rows NO SCROLL CURSOR FOR SELECT table_name, value::text " +
        "FROM unnest(ARRAY[" + names + "]) AS source(table_name) " +
        "CROSS JOIN LATERAL rivalhub_preview.export_table(table_name) AS mirror(value)",
      );
      for (;;) {
        const { rows } = await client.query("FETCH FORWARD " + group.size + " FROM preview_rows");
        for (const { table_name, value } of rows) await write('["' + table_name + '",' + value + ']');
        if (rows.length < group.size) break;
      }
      await client.query("CLOSE preview_rows");
    }
    await client.query("ROLLBACK");
  } catch (error) {
    console.error("Preview source read failed in " + phase + ".");
    throw error;
  }
}

async function main() {
  const manifest = JSON.parse(readFileSync(new URL("standby.json", root), "utf8"));
  const tables = JSON.parse(readFileSync(new URL("preview-tables.json", import.meta.url), "utf8"));
  assertProductionStandbyEnvironment(manifest);
  const databaseUrl = assertProductionDatabaseUrl(process.env.DATABASE_URL);
  process.chdir(fileURLToPath(root));
  if (process.getuid() === 0) {
    process.initgroups("rivalhub-production", "rivalhub-production");
    process.setgid("rivalhub-production");
    process.setuid("rivalhub-production");
  }
  const client = new Client({
    ...postgresConnection(databaseUrl), application_name: "rivalhub-preview-source",
    connectionTimeoutMillis: 5_000, query_timeout: 45_000,
  });
  try {
    await client.connect();
    await readPreviewSource(client, tables, manifest);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // DB driver messages may contain connection details or row values.
    const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,20}$/.test(error.code)
      ? " " + error.code
      : error?.message === "Query read timeout" ? " QUERY_READ_TIMEOUT" : "";
    console.error("Preview source projection failed." + code);
    process.exitCode = 1;
  });
}
