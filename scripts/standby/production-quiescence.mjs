import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Query the server, not the OS process list: a pooler can retain a transaction
// after the HTTP process has exited. Include idle/aborted and prepared work.
export const quiescenceSql = `
  SELECT
    (SELECT count(*)::int FROM pg_stat_activity
      WHERE datname = current_database() AND usename = session_user
        AND backend_type = 'client backend' AND pid <> pg_backend_pid()
        AND (state IS DISTINCT FROM 'idle' OR xact_start IS NOT NULL)) AS transactions,
    (SELECT count(*)::int FROM pg_prepared_xacts
      WHERE database = current_database() AND owner = session_user) AS prepared`;

export async function waitForDatabaseQuiescence(client, {
  timeoutMs = 60_000, intervalMs = 1_000,
  now = () => performance.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const deadline = now() + timeoutMs;
  let empty = 0;
  while (true) {
    const { rows: [state] } = await client.query(quiescenceSql);
    if (!state || !Number.isSafeInteger(state.transactions) || !Number.isSafeInteger(state.prepared)) {
      throw new Error('Database quiescence observation unavailable.');
    }
    empty = state.transactions === 0 && state.prepared === 0 ? empty + 1 : 0;
    if (empty === 2) return;
    if (now() >= deadline) throw new Error('Database writers did not drain; keep the application stopped and inspect independent writers.');
    await wait(intervalMs);
  }
}

async function main() {
  const root = resolve(process.argv[2]);
  // Resolve the already verified package's traced pg dependency. No install or
  // additional credential is needed on the host. TLS tooling is uploaded by
  // linux-routing alongside this helper from the canonical connection owner.
  const { Client } = createRequire(`${root}/server.js`)('pg');
  if (!process.argv[3]) throw new Error('Canonical TLS tooling path required.');
  const { postgresConnection } = await import(pathToFileURL(resolve(process.argv[3])).href);
  const client = new Client({ ...postgresConnection(process.env.DATABASE_URL),
    application_name: 'rivalhub-release-drain', connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000, query_timeout: 6_000 });
  try {
    await client.connect();
    await waitForDatabaseQuiescence(client);
    console.log('Runtime database transactions drained (two server observations).');
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    // Driver errors can include connection details; keep host logs credential-free.
    console.error('Database quiescence failed; no release switch is permitted. Inspect runtime connectivity and independent writers.');
    process.exitCode = 1;
  });
}
