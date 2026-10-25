import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForDatabaseQuiescence } from './production-quiescence.mjs';

test('prepared work resets the empty observation sequence; unknown observation fails', async () => {
  const observations = [0, 1, 0, 0];
  let count = 0;
  await waitForDatabaseQuiescence({ query: async () => ({ rows: [{ transactions: 0, prepared: observations[count++] }] }) }, { wait: async () => {} });
  assert.equal(count, 4);
  await assert.rejects(waitForDatabaseQuiescence({ query: async () => ({ rows: [{ transactions: null, prepared: 0 }] }) }), /unavailable/);
  await assert.rejects(waitForDatabaseQuiescence({ query: async () => { throw Error('unreachable'); } }), /unreachable/);
});
