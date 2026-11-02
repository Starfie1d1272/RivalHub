import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2]);
const { migrations } = JSON.parse(readFileSync(`${root}/standby.json`, 'utf8'));
const { Client } = createRequire(`${root}/server.js`)('pg');
const { postgresConnection } = await import(pathToFileURL(`${root}/src/db/postgres-connection.ts`).href);
const client = new Client({ ...postgresConnection(process.env.DATABASE_URL), connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 6000 });
try {
  await client.connect();
  const result = await client.query("SELECT hash, created_at::bigint::text AS time FROM drizzle.__drizzle_migrations ORDER BY created_at");
  if (!Array.isArray(migrations) || migrations.length !== result.rows.length || result.rows.some((row, i) => row.hash !== migrations[i].hash || Number(row.time) !== migrations[i].when)) throw Error('Migration ledger differs from this application package.');
} catch {
  console.error('Instance database readiness failed; verify connectivity and the active migration ledger.');
  process.exitCode = 1;
} finally { await client.end(); }
