import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { packageLayers } from '../standby/layers.mjs';

// Only committed source and a deliberately empty build environment enter the artifact.
if (process.platform !== 'linux' || process.arch !== 'x64') throw Error('Linux x64 builder required.');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sourceCommit = git('rev-parse', 'HEAD');
if (git('status', '--porcelain')) throw Error('A clean committed source checkout is required.');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const releaseTag = `v${version}-instance.${sourceCommit.slice(0, 12)}`;
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'CI', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, { NODE_ENV: 'production', __NEXT_PROCESSED_ENV: 'true', NEXT_TELEMETRY_DISABLED: '1',
  RIVALHUB_STANDALONE: '1', RIVALHUB_RELEASE_TAG: releaseTag, RIVALHUB_RELEASE_COMMIT: sourceCommit });
execFileSync(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'build'], { env, stdio: 'inherit' });
const bundle = resolve('.next/standalone');
cpSync('public', `${bundle}/public`, { recursive: true });
cpSync('.next/static', `${bundle}/.next/static`, { recursive: true });
for (const path of ['scripts/instance/validate-runtime.mjs', 'scripts/instance/readiness.mjs', 'src/lib/runtime/official-deployment-profile.mjs', 'src/db/postgres-connection.ts', 'src/db/supabase-ca.ts']) {
  mkdirSync(resolve(bundle, path, '..'), { recursive: true });
  if (path === 'src/db/postgres-connection.ts') {
    writeFileSync(resolve(bundle, path), readFileSync(path, 'utf8').replace('from "./supabase-ca"', 'from "./supabase-ca.ts"'));
  } else cpSync(path, resolve(bundle, path));
}
mkdirSync(`${bundle}/runtime`, { recursive: true });
cpSync(process.execPath, `${bundle}/runtime/node`);
for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) rmSync(`${bundle}/${name}`, { force: true });
const journal = JSON.parse(readFileSync('drizzle/migrations/meta/_journal.json', 'utf8'));
const migrations = journal.entries.map(entry => ({ hash: createHash('sha256').update(readFileSync(`drizzle/migrations/${entry.tag}.sql`, 'utf8')).digest('hex'), when: entry.when }));
const manifest = { migrations, environment: 'instance', sourceCommit, operatorCommit: sourceCommit, releaseTag,
  configurationSha256: createHash('sha256').update('rivalhub-instance-runtime-config-v1').digest('hex'),
  nodeVersion: process.version, platform: process.platform, architecture: process.arch };
writeFileSync(`${bundle}/standby.json`, JSON.stringify(manifest, null, 2) + '\n');
const output = resolve('.agent-tmp/instance-package');
const packaged = packageLayers(bundle, output, manifest);
console.log(`Instance package: ${output}/rivalhub-production-${sourceCommit}-${manifest.configurationSha256.slice(0, 12)}.layers.json (${packaged.layers.length} layers)`);
