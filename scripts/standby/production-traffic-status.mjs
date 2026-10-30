// Read-only, non-sensitive evidence from the existing protected deployment channel.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = '/opt/rivalhub-production';
const directory = '/var/lib/rivalhub-production/db-traffic';
const service = 'rivalhub-production';
function property(name) { return execFileSync('systemctl', ['show', service, '--property', name, '--value'], { encoding: 'utf8', timeout: 5000 }).trim(); }
export function lockHeld(path) {
  if (!existsSync(path)) return false;
  let db;
  try { db = new DatabaseSync(path); db.exec('BEGIN IMMEDIATE'); db.exec('ROLLBACK'); return false; }
  catch (error) { return error?.errcode === 5 || error?.errcode === 6; }
  finally { try { db?.close(); } catch {} }
}

export function lockOwnedBy(pid, path) {
  const info = statSync(path, { bigint: true });
  const dev = info.dev;
  const major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n);
  const minor = (dev & 0xffn) | ((dev >> 12n) & 0xffffff00n);
  return readFileSync('/proc/locks', 'utf8').split('\n').some(line => {
    const fields = line.trim().split(/\s+/); const index = fields.findIndex(value => /^[0-9a-f]+:[0-9a-f]+:\d+$/i.test(value));
    if (index < 1 || Number(fields[index - 1]) !== pid) return false;
    const [deviceMajor, deviceMinor, inode] = fields[index].split(':');
    return BigInt(`0x${deviceMajor}`) === major && BigInt(`0x${deviceMinor}`) === minor && BigInt(inode) === info.ino;
  });
}

export function collect(probe) {
  const pid = Number(probe.property('MainPID'));
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('service unavailable');
  const env = probe.environment(pid);
  let endpointValid = false;
  try { const url = new URL(env.PRODUCT_TELEMETRY_ENDPOINT ?? ''); endpointValid = url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/v1/batches'; } catch {}
  const samplingEnabled = env.RIVALHUB_RUNTIME_HEALTH_ENABLED !== '0';
  const collectionConfigured = samplingEnabled && endpointValid && (env.DB_TRAFFIC_KEY?.length ?? 0) >= 32;
  const stateDirectory = probe.property('StateDirectory').split(/\s+/).some(value => value === 'rivalhub-production/db-traffic' || value === directory);
  const mode = probe.property('StateDirectoryMode');
  const stateModeConfigured = Number.parseInt(mode, 8) === 0o700 || Number(mode) === 0o700;
  const serviceActive = probe.property('ActiveState') === 'active';
  const protectionEnabled = probe.property('ProtectSystem') === 'strict';
  const serviceUser = probe.property('User') === service;
  const processSpoolPath = env.DB_TRAFFIC_SPOOL_DIRECTORY === directory;
  const processCount = probe.processes(probe.property('ControlGroup'));
  const singleNode = processCount.length === 1 && processCount[0] === pid && probe.isExpectedNode(pid);
  const permissions = probe.permissions(directory);
  const directoryPrivate = permissions.mode === 0o700 && permissions.uid === probe.uid();
  const state = probe.state(directory);
  const spoolReadable = state?.version === 1 && Array.isArray(state?.batches) && Array.isArray(state?.gaps);
  const spoolLocked = probe.lockHeld(`${directory}/owner.sqlite`);
  const lockOwnedByMain = spoolLocked && probe.lockOwnedBy(pid, `${directory}/owner.sqlite`);
  return { event: 'db_traffic.host_readback', available: true, release: probe.release(), serviceActive, stateDirectory, stateModeConfigured, protectionEnabled, serviceUser, processSpoolPath, singleNode, directoryPrivate, samplingEnabled, collectionConfigured, spoolReadable, spoolLocked, lockOwnedByMain, coverageUnknown: spoolReadable ? state.coverageUnknownSince != null : null };
}

const actual = {
  property,
  environment(pid) { const wanted = new Set(['RIVALHUB_RUNTIME_HEALTH_ENABLED', 'PRODUCT_TELEMETRY_ENDPOINT', 'DB_TRAFFIC_KEY', 'DB_TRAFFIC_SPOOL_DIRECTORY']); const result = {}; for (const item of readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')) { const i = item.indexOf('='); if (i > 0 && wanted.has(item.slice(0, i))) result[item.slice(0, i)] = item.slice(i + 1); } return result; },
  processes(group) { return readFileSync(`/sys/fs/cgroup${group}/cgroup.procs`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number); },
  isExpectedNode(pid) { return realpathSync(`/proc/${pid}/exe`) === realpathSync(`${root}/current/runtime/node`); },
  permissions(path) { const value = statSync(path); return { mode: value.mode & 0o777, uid: value.uid }; },
  uid() { return Number(execFileSync('id', ['-u', service], { encoding: 'utf8', timeout: 5000 }).trim()); },
  state(path) { try { return JSON.parse(readFileSync(`${path}/state.json`, 'utf8')); } catch { return null; } },
  lockHeld, lockOwnedBy,
  release() { const value = JSON.parse(readFileSync(`${root}/current/standby.json`, 'utf8')); return { tag: value.releaseTag, commit: value.sourceCommit }; },
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(collect(actual))); }
  catch { console.log(JSON.stringify({ event: 'db_traffic.host_readback', available: false })); }
}
