import { lstatSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

// This is restore-produced evidence held in the root-only installation
// snapshot, not a caller-supplied assertion that an existing DB is safe.
const [path, manifestPath, previousTag, previousCommit] = process.argv.slice(2);
if (!path || !manifestPath) throw Error('Recovery evidence and candidate manifest are required.');
const file = lstatSync(path), parent = statSync(dirname(path));
if (!file.isFile() || file.isSymbolicLink() || file.uid !== process.getuid() || parent.uid !== process.getuid()
  || (file.mode & 0o077) !== 0 || (parent.mode & 0o077) !== 0 || file.size > 65536) {
  throw Error('Recovery evidence must be held in an owner-only installation snapshot.');
}
const evidence = JSON.parse(readFileSync(path, 'utf8'));
const candidate = JSON.parse(readFileSync(manifestPath, 'utf8'));
const sha256 = /^[a-f0-9]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const db = new URL(process.env.DATABASE_URL ?? '');
const databaseName = decodeURI(db.pathname.slice(1));
const ledger = evidence.ledger, migrations = candidate.migrations;
if (evidence.version !== 1 || evidence.artifactKind !== 'full' || !uuid.test(evidence.runId ?? '')
  || !sha256.test(evidence.artifactSha256 ?? '') || !sha256.test(evidence.manifestSha256 ?? '')
  || !/^[a-z0-9]{20}$/.test(evidence.sourceProjectRef ?? '')
  || evidence.source?.deployedReleaseTag !== previousTag || evidence.source?.deployedCommit !== previousCommit
  || evidence.source?.deployedReleaseTag !== candidate.releaseTag
  || evidence.source?.deployedCommit !== candidate.sourceCommit
  || evidence.target?.supabaseUrl !== process.env.NEXT_PUBLIC_SUPABASE_URL
  || evidence.target?.databaseName !== databaseName
  || !Array.isArray(ledger) || !Array.isArray(migrations) || !ledger.length || ledger.length !== migrations.length
  || ledger.some((row, i) => row.hash !== migrations[i]?.hash || row.when !== migrations[i]?.when)
  || ledger.at(-1)?.hash !== evidence.source?.databaseMigrationTerminal?.terminalHash
  || ledger.at(-1)?.when !== evidence.source?.databaseMigrationTerminal?.terminalWhen) {
  throw Error('Recovery evidence does not match the candidate release, target and migration ledger.');
}
