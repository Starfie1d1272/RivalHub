import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyTeamLogoBucket } from '../db/team-logo-bucket.mjs';

const root = resolve(process.argv[2]);
const { migrations } = JSON.parse(readFileSync(`${root}/standby.json`, 'utf8'));
const { Client } = createRequire(`${root}/server.js`)('pg');
const { postgresConnection } = await import(pathToFileURL(`${root}/src/db/postgres-connection.ts`).href);
const client = new Client({ ...postgresConnection(process.env.DATABASE_URL), connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 6000 });
try {
  await client.connect();
  const result = await client.query("SELECT hash, created_at::bigint::text AS time FROM drizzle.__drizzle_migrations ORDER BY created_at");
  if (!Array.isArray(migrations) || migrations.length !== result.rows.length || result.rows.some((row, i) => row.hash !== migrations[i].hash || Number(row.time) !== migrations[i].when)) throw Error('Migration ledger differs from this application package.');
  if (await verifyTeamLogoBucket(client) !== 'verified') throw Error('Storage provider is unavailable.');
  if (process.argv[3] === '--fresh') {
    const rule = await client.query("SELECT EXISTS (SELECT 1 FROM institution_email_domains WHERE domain = $1) AS present", ['smail.nju.edu.cn']);
    if (rule.rows[0]?.present !== false) throw Error('Fresh instance retains the official email bootstrap rule.');
  }
} catch {
  console.error('Instance database readiness failed; verify the migration ledger, Storage bucket and fresh-instance configuration.');
  process.exitCode = 1;
} finally { await client.end(); }
