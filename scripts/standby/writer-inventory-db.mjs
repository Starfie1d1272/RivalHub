import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Summaries only: no query text, account names, hosts, or connection errors.
export async function inspectDatabase(client) {
  await client.query('BEGIN READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout = '5s'");
    const { rows: sessions } = await client.query(`SELECT usename, count(*)::int AS sessions,
      count(*) FILTER (WHERE state IS NULL)::int AS hidden,
      count(*) FILTER (WHERE state IS DISTINCT FROM 'idle' OR xact_start IS NOT NULL)::int AS busy
      FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend'
      AND pid <> pg_backend_pid() GROUP BY usename`);
    const { rows: prepared } = await client.query(`SELECT owner, count(*)::int AS prepared
      FROM pg_prepared_xacts WHERE database = current_database() GROUP BY owner`);
    const { rows: identity } = await client.query('SELECT session_user AS runtime');
    if (!identity[0]?.runtime || sessions.some(row => !row.usename || !Number.isInteger(row.hidden) || !Number.isInteger(row.busy)) || prepared.some(row => !row.owner || !Number.isInteger(row.prepared))) throw new Error('incomplete');
    const runtime = identity[0].runtime;
    return { roles: sessions.length, hidden: sessions.reduce((n, r) => n + r.hidden, 0),
      otherRoles: sessions.filter(r => r.usename !== runtime).length,
      prepared: prepared.reduce((n, r) => n + r.prepared, 0) };
  } finally { await client.query('ROLLBACK'); }
}

async function main() {
  const root = resolve(process.argv[2]);
  const { Client } = createRequire(`${root}/server.js`)('pg');
  const { postgresConnection } = await import(pathToFileURL(resolve(process.argv[3])).href);
  const client = new Client({ ...postgresConnection(process.env.DATABASE_URL), application_name: 'rivalhub-release-inventory', connectionTimeoutMillis: 5000, query_timeout: 6000 });
  try { await client.connect(); console.log(JSON.stringify({ database: await inspectDatabase(client) })); }
  finally { await client.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('Database inventory unavailable.'); process.exitCode = 1; });
