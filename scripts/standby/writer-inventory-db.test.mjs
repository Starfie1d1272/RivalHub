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
