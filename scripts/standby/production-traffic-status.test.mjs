import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { collect, lockHeld, lockOwnedBy } from './production-traffic-status.mjs';

function fixture() {
  const props = { MainPID: '123', StateDirectory: 'rivalhub-production/db-traffic', StateDirectoryMode: '0700', ActiveState: 'active', FragmentPath: '/etc/systemd/system/rivalhub-production.service', DropInPaths: '/etc/systemd/system/rivalhub-production.service.d/override.conf', ProtectSystem: 'strict', User: 'rivalhub-production', ControlGroup: '/test' };
  const env = { PRODUCT_TELEMETRY_ENDPOINT: 'https://fixture.invalid/v1/batches', DB_TRAFFIC_KEY: 'private-key-'.repeat(4), DB_TRAFFIC_SPOOL_DIRECTORY: '/var/lib/rivalhub-production/db-traffic' };
  return { props, env, probe: { property: name => props[name], environment: () => env, processes: () => [123], isExpectedNode: () => true, permissions: () => ({ mode: 0o700, uid: 100 }), uid: () => 100, state: () => ({ version: 1, batches: [], gaps: [], coverageUnknownSince: null }), lockHeld: () => true, lockOwnedBy: () => true, release: () => ({ tag: 'v1.0.0', commit: 'a'.repeat(40) }) } };
}
test('reports effective settings and state without exposing credentials', () => {
  const { probe, props } = fixture(); const result = collect(probe);
  assert.equal(result.collectionConfigured, true); assert.equal(result.managedUnit, true); assert.equal(result.dropInsPresent, true); assert.equal(result.singleNode, true); assert.equal(result.spoolLocked, true); assert.equal(result.lockOwnedByMain, true); assert.equal(result.directoryPrivate, true);
  assert.doesNotMatch(JSON.stringify(result), /private-key|fixture\.invalid/);
  props.StateDirectory = ''; assert.equal(collect(probe).stateDirectory, false);
  props.ProtectSystem = 'no'; assert.equal(collect(probe).protectionEnabled, false);
});
test('distinguishes disabled sampling and an unowned spool', () => {
  const { probe, env } = fixture(); env.RIVALHUB_RUNTIME_HEALTH_ENABLED = '0'; probe.processes = () => [123, 124]; probe.lockHeld = () => false;
  const result = collect(probe); assert.equal(result.collectionConfigured, false); assert.equal(result.samplingEnabled, false); assert.equal(result.singleNode, false); assert.equal(result.spoolLocked, false);
  probe.state = () => null; assert.equal(collect(probe).coverageUnknown, null);
  probe.state = () => ({ version: 1, batches: [], gaps: [] }); assert.equal(collect(probe).coverageUnknown, null);
});
test('probes the actual SQLite lock without changing its owner', () => {
  const dir = mkdtempSync(join(tmpdir(), 'traffic-readback-')); const path = join(dir, 'owner.sqlite');
  try { const owner = new DatabaseSync(path); owner.exec('BEGIN IMMEDIATE'); assert.equal(lockHeld(path), true); assert.equal(lockOwnedBy(process.pid, path), true); owner.close(); assert.equal(lockHeld(path), false); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
