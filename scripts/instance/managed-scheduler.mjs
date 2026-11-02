import { createRequire } from 'node:module';
import { existsSync, openSync, writeFileSync, fsyncSync, closeSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The instance owns these named jobs. Unknown commands are not treated as HTTP
// dispatch and are never modified. The caller holds the host deployment lock.
const [action, root, tlsPath, snapshot] = process.argv.slice(2);
if (!['pause', 'verify', 'resume'].includes(action) || !root || !tlsPath || !snapshot) throw Error('Invalid managed scheduler operation.');
const { Client } = createRequire(`${resolve(root)}/server.js`)('pg');
const { postgresConnection } = await import(pathToFileURL(resolve(tlsPath)).href);
const client = new Client({ ...postgresConnection(process.env.DATABASE_URL), connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 6000 });
const path = `${resolve(snapshot)}/scheduler-state.json`;
const safe = job => {
  const match = /^SELECT public\.dispatch_rivalhub_scheduler_job\('([a-z0-9-]+)'(?:, (?:true|false))?\);$/.exec(job.command);
  return match && job.jobname === `rivalhub-${match[1]}` && typeof job.active === 'boolean' && /^\d+$/.test(job.jobid);
};
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('rivalhub.instance.scheduler-transition'))");
  const { rows } = await client.query("SELECT jobid::text, jobname, schedule, command, active FROM cron.job WHERE jobname LIKE 'rivalhub-%' ORDER BY jobid");
  if (rows.some(job => !safe(job)) || new Set(rows.map(job => job.jobname)).size !== rows.length) throw Error('Unknown managed scheduler job.');
  if (rows.length) {
    const target = await client.query("SELECT decrypted_secret = $1 AS matches FROM vault.decrypted_secrets WHERE name = 'rivalhub_scheduler_base_url'", [process.env.NEXT_PUBLIC_APP_URL]);
    if (target.rows.length !== 1 || target.rows[0].matches !== true) throw Error('Scheduler target differs from the instance origin.');
  }
  let saved;
  if (action === 'pause' && !existsSync(path)) {
    saved = rows;
    writeFileSync(path, `${JSON.stringify({ version: 1, jobs: saved })}\n`, { flag: 'wx', mode: 0o600 });
    const file = openSync(path, 'r'); fsyncSync(file); closeSync(file);
    const dir = openSync(resolve(snapshot), 'r'); fsyncSync(dir); closeSync(dir);
  } else {
    const record = JSON.parse(readFileSync(path, 'utf8'));
    if (record.version !== 1 || !Array.isArray(record.jobs) || record.jobs.some(job => !safe(job))) throw Error('Invalid scheduler snapshot.');
    saved = record.jobs;
  }
  if (rows.length !== saved.length || rows.some((job, i) => ['jobid', 'jobname', 'schedule', 'command'].some(key => job[key] !== saved[i][key]))) throw Error('Managed scheduler changed during transition.');
  if (action === 'pause') {
    for (const job of rows) if (job.active) await client.query('SELECT cron.alter_job($1::bigint, active := false)', [job.jobid]);
  } else if (action === 'resume') {
    if (rows.some(job => job.active)) throw Error('Managed scheduler was unexpectedly enabled.');
    for (const job of saved) if (job.active) await client.query('SELECT cron.alter_job($1::bigint, active := true)', [job.jobid]);
  } else if (rows.some(job => job.active)) throw Error('Managed scheduler is not paused.');
  const checked = await client.query("SELECT jobid::text, active FROM cron.job WHERE jobname LIKE 'rivalhub-%' ORDER BY jobid");
  if (checked.rows.length !== saved.length || checked.rows.some((job, i) => job.jobid !== saved[i].jobid || job.active !== (action === 'resume' ? saved[i].active : false))) throw Error('Managed scheduler state did not converge.');
  await client.query('COMMIT');
  console.log(`Managed scheduler ${action} verified: ${rows.length} jobs.`);
} catch {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Managed scheduler transition failed; inspect target, job ownership and state.');
  process.exitCode = 1;
} finally { await client.end(); }
