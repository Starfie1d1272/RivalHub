import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inspectDatabase } from './writer-inventory-db.mjs';

describe('read-only database inventory', () => {
  it('reports hidden sessions, other roles, and prepared transactions without identities', async () => {
    const calls = [];
    const client = { async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM pg_stat_activity')) return { rows: [{ usename: 'app', hidden: 0, busy: 1 }, { usename: 'other', hidden: 2, busy: 2 }] };
      if (sql.includes('FROM pg_prepared_xacts')) return { rows: [{ owner: 'other', prepared: 1 }] };
      if (sql.includes('session_user AS')) return { rows: [{ runtime: 'app' }] };
      return { rows: [] };
    } };
    assert.deepEqual(await inspectDatabase(client), { roles: 2, hidden: 2, otherRoles: 1, prepared: 1 });
    assert.equal(calls[0], 'BEGIN READ ONLY');
    assert.equal(calls.at(-1), 'ROLLBACK');
  });
  it('fails closed on inaccessible or incomplete observations and rolls back', async () => {
    const calls = [];
    const client = { async query(sql) { calls.push(sql); if (sql.includes('pg_stat_activity')) throw new Error('permission denied'); return { rows: [] }; } };
    await assert.rejects(inspectDatabase(client));
    assert.equal(calls.at(-1), 'ROLLBACK');
  });
});

it('loads the real standalone entrypoint and rejects non-production targets before connecting', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const temp = mkdtempSync(join(tmpdir(), 'writer-entry-'));
  try {
    const root = join(temp, 'standalone');
    const pg = join(root, 'node_modules', 'pg');
    mkdirSync(pg, { recursive: true });
    writeFileSync(join(root, 'server.js'), '');
    writeFileSync(join(pg, 'index.js'), `exports.Client = class {
      async connect() { require('node:fs').writeFileSync(process.env.CONNECT_MARKER, 'connected'); }
      async end() {}
      async query(sql) {
        if (sql.includes('pg_stat_activity') || sql.includes('pg_prepared_xacts')) return {rows: []};
        if (sql.includes('session_user AS')) return {rows: [{runtime: 'app'}]};
        return {rows: []};
      }
    };`);
    const copy = (src, dest, change = s => s) => writeFileSync(join(temp, dest), change(readFileSync(resolve(src), 'utf8')));
    copy('scripts/db/production-environment.ts', 'production-environment.ts', s => s.replace('./remote-environment"', './remote-environment.ts"'));
    copy('scripts/db/remote-environment.ts', 'remote-environment.ts');
    copy('src/db/postgres-connection.ts', 'postgres-connection.ts', s => s.replace('./supabase-ca"', './supabase-ca.ts"'));
    copy('src/db/supabase-ca.ts', 'supabase-ca.ts');
    const good = 'postgresql://postgres.eurxkguokrkvpcsmxuru:test-password@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres';
    const base = { PATH: process.env.PATH, RIVALHUB_DB_TARGET: 'production', RIVALHUB_PRODUCTION_PROJECT_CONFIRM: 'eurxkguokrkvpcsmxuru', RIVALHUB_PRODUCTION_DB_HOST_CONFIRM: 'aws-0-ap-northeast-1.pooler.supabase.com:6543', DATABASE_URL: good, CONNECT_MARKER: join(temp, 'connected') };
    const run = env => spawnSync(process.execPath, [resolve('scripts/standby/writer-inventory-db.mjs'), root, join(temp, 'postgres-connection.ts'), join(temp, 'production-environment.ts')], { env, encoding: 'utf8' });
    const success = run(base);
    assert.equal(success.status, 0, success.stderr);
    assert.deepEqual(JSON.parse(success.stdout), { database: { roles: 0, hidden: 0, otherRoles: 0, prepared: 0 } });
    assert.ok(existsSync(base.CONNECT_MARKER));
    rmSync(base.CONNECT_MARKER);
    for (const env of [
      { ...base, DATABASE_URL: good.replace('postgres.eurxkguokrkvpcsmxuru', 'postgres.previewproject') },
      { ...base, DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/postgres' },
      { ...base, RIVALHUB_DB_TARGET: '' },
    ]) {
      const failure = run(env);
      assert.notEqual(failure.status, 0);
      assert.equal(existsSync(base.CONNECT_MARKER), false);
      assert.equal(failure.stdout, '');
      assert.equal(failure.stderr.trim(), 'Database inventory unavailable.');
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
