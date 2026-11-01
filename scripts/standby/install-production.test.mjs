import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, existsSync, realpathSync, readlinkSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { packageLayers, packageProduction, loadLayerManifest, missingLayers } from './layers.mjs';

test('host promotion, failed restart recovery, immutable retry and explicit rollback', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rivalhub-host-')));
  try {
    const source = dirname(fileURLToPath(import.meta.url));
    const root = join(dir, 'host');
    const config = join(dir, 'etc/production.env');
    const unit = join(dir, 'etc/service');
    const bin = join(dir, 'bin');
    for (const path of [bin, dirname(config), join(root, 'rollback'), join(root, 'releases')]) mkdirSync(path, { recursive: true });
    const installer = readFileSync(join(source, 'install-production.sh'), 'utf8')
      .replaceAll('/opt/rivalhub-production', root).replaceAll('/etc/rivalhub-production/production.env', config)
      .replaceAll('/etc/systemd/system/rivalhub-production.service', unit).replaceAll('/etc/rivalhub-production', dirname(config));
    writeFileSync(join(dir, 'install-production.sh'), installer);
    for (const file of ['production-host.mjs', 'rivalhub-production.service', 'layers.mjs']) writeFileSync(join(dir, file), readFileSync(join(source, file)));
    // DB owner is exercised separately against PostgreSQL. This host fixture
    // records ordering and injects drain failures without touching a real host.
    writeFileSync(join(dir, 'production-quiescence.mjs'), String.raw`
      import fs from 'node:fs';
      const dir = ${JSON.stringify(dir)}, root = ${JSON.stringify(root)}, config = ${JSON.stringify(config)};
      fs.appendFileSync(dir + '/events', 'drain ' + fs.readlinkSync(root + '/current') + '\n');
      if (fs.existsSync(dir + '/fail-drain')) process.exit(1);
    `);
    const old = 'a'.repeat(40), next = 'b'.repeat(40), hash = 'c'.repeat(64);
    const name = sha => `rivalhub-production-${sha}-${hash.slice(0, 12)}`;
    const manifest = (sha, tag) => JSON.stringify({ sourceCommit: sha, releaseTag: tag, configurationSha256: hash, operatorCommit: 'd'.repeat(40), platform: 'linux', architecture: 'x64', nodeVersion: process.version });
    const previous = join(root, 'releases', name(old));
    mkdirSync(join(previous, 'runtime'), { recursive: true });
    symlinkSync(process.execPath, join(previous, 'runtime/node'));
    writeFileSync(join(previous, 'standby.json'), manifest(old, 'v1.0.0'));
    symlinkSync(`releases/${name(old)}`, join(root, 'current'));
    const oldEnv = `SECRET=never-print-me\nRIVALHUB_RELEASE_TAG=v1.0.0\nRIVALHUB_RELEASE_COMMIT=${old}\nGIT_COMMIT_SHA=${old}\n`;
    writeFileSync(config, oldEnv);
    writeFileSync(unit, 'old service');
    const candidate = join(dir, 'candidate');
    mkdirSync(join(candidate, 'runtime'), { recursive: true });
    mkdirSync(join(candidate, '.next/server'), { recursive: true });
    mkdirSync(join(candidate, 'scripts/standby'), { recursive: true });
    symlinkSync(process.execPath, join(candidate, 'runtime/node'));
    writeFileSync(join(candidate, 'standby.json'), manifest(next, 'v1.0.1'));
    writeFileSync(join(candidate, 'scripts/standby/start-production.mjs'), 'export function assertProductionStandbyEnvironment() {}');
    const archive = join(dir, `${name(next)}.tar.gz`);
    const pack = () => {
      execFileSync('tar', ['-czf', archive, '-C', candidate, '.']);
      const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
      writeFileSync(`${archive}.sha256`, `${digest}  ${name(next)}.tar.gz\n`);
      return join(root, 'releases', `${name(next)}-${digest.slice(0, 12)}`);
    };
    const failedRelease = pack();
    const mock = `#!${process.execPath}
const fs = require('fs'), cp = require('child_process'), path = require('path');
const cmd = path.basename(process.argv[1]), args = process.argv.slice(2), dir = ${JSON.stringify(dir)}, config = ${JSON.stringify(config)};
if (cmd === 'id') { if (args[0] === '-u') console.log('0'); }
else if (cmd === 'flock') { if(fs.existsSync(dir + '/locked')) process.exit(1); }
else if (['chown','sleep'].includes(cmd)) {}
else if (cmd === 'systemctl') { fs.appendFileSync(dir + '/events', args[0] + '\\n'); if(args[0] === 'stop' && fs.existsSync(dir + '/fail-stop')) process.exit(1); if(args[0] === 'restart' && fs.existsSync(dir + '/fail')) {fs.unlinkSync(dir + '/fail'); process.exit(1);} }
else if (cmd === 'curl') { if(fs.existsSync(dir + '/old-offline') && fs.readFileSync(config,'utf8').includes('RIVALHUB_RELEASE_TAG=v1.0.0')) process.exit(7); if(fs.existsSync(dir + '/fail-health') && fs.readFileSync(config,'utf8').includes('RIVALHUB_RELEASE_TAG=v1.0.1')) process.exit(22); if(args.at(-1).endsWith('/api/system/release')) {const env = fs.readFileSync(config, 'utf8'); const get = k => env.match(new RegExp('^'+k+'=(.*)$','m'))[1]; console.log(JSON.stringify({releaseTag:get('RIVALHUB_RELEASE_TAG'),releaseCommit:get('RIVALHUB_RELEASE_COMMIT')}));} }
else if (cmd === 'mv') {fs.renameSync(args.at(-2), args.at(-1));}
else if (cmd === 'sha256sum') { const crypto = require('crypto'); if(args[0] === '-c') {const [hash, file] = fs.readFileSync(args[1],'utf8').trim().split(/\\s+/); if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== hash) process.exit(1);} else console.log(crypto.createHash('sha256').update(fs.readFileSync(args[0])).digest('hex')+'  '+args[0]);}
else throw Error(cmd);
`;
    writeFileSync(join(bin, 'mock'), mock, { mode: 0o755 });
    for (const cmd of ['id','flock','chown','sleep','systemctl','curl','mv','sha256sum']) symlinkSync('mock', join(bin, cmd));
    const deployArgs = [archive, config, '--release', 'v1.0.1', next, 'v1.0.0', old];
    const run = args => spawnSync('bash', [join(dir, 'install-production.sh'), ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(run(['--rollback', 'v1.0.1', next, 'v1.0.0', old]).status, 0);
    writeFileSync(join(dir, 'old-offline'), '');
    let result = run([archive, config, '--release', 'v1.0.1', next, 'v1.0.0', 'e'.repeat(40)]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Current host differs from frozen previous release/);
    assert.equal(readlinkSync(join(root, 'current')), `releases/${name(old)}`);
    writeFileSync(join(dir, 'fail-drain'), '');
    result = run(deployArgs);
    assert.equal(result.status, 1);
    assert.equal(readFileSync(config, 'utf8'), oldEnv);
    assert.equal(readlinkSync(join(root, 'current')), `releases/${name(old)}`);
    assert.match(result.stderr, /Writer drain failed after service stop/);
    assert.ok(!readFileSync(join(dir, 'events'), 'utf8').includes('restart'));
    rmSync(join(dir, 'fail-drain'));
    rmSync(join(dir, 'old-offline'));
    writeFileSync(join(dir, 'events'), '');
    writeFileSync(join(dir, 'fail'), '');
    result = run(deployArgs);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(readFileSync(config, 'utf8'), oldEnv);
    assert.equal(readFileSync(unit, 'utf8'), 'old service');
    assert.match(result.stderr, /previous state restored/);
    assert.match(readFileSync(join(dir, 'events'), 'utf8'), /stop\ndrain [^\n]+\ndaemon-reload\nreset-failed\nrestart\nstop\ndrain [^\n]+\ndaemon-reload\nreset-failed\nstart/);
    assert.ok(!result.stderr.includes('never-print-me'));
    writeFileSync(join(failedRelease, '.next/server/route-cache/cached-route'), 'runtime response');
    writeFileSync(join(failedRelease, '.next/cache/cached-fetch'), 'runtime fetch');
    rmSync(join(failedRelease, '.archive-sha256'));
    writeFileSync(join(dir, 'fail-health'), '');
    result = run(deployArgs);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(readFileSync(config, 'utf8'), oldEnv);
    assert.match(result.stderr, /previous state restored/);
    rmSync(join(dir, 'fail-health'));
    writeFileSync(join(candidate, '.next/BUILD_ID'), 'new-build-same-source');
    const rebuiltRelease = pack();
    assert.notEqual(rebuiltRelease, failedRelease);
    writeFileSync(join(dir, 'old-offline'), '');
    result = run(deployArgs);
    assert.equal(result.status, 0, result.stderr);
    rmSync(join(dir, 'old-offline'));
    assert.ok(existsSync(failedRelease));
    assert.equal(readlinkSync(join(root, 'current')), `releases/${rebuiltRelease.split('/').at(-1)}`);
    const snapshot = readFileSync(join(root, 'previous-snapshot'), 'utf8').trim();
    assert.equal(readFileSync(join(snapshot, 'production.env'), 'utf8'), oldEnv);
    assert.match(readFileSync(config, 'utf8'), /RIVALHUB_RELEASE_TAG=v1.0.1/);
    assert.equal(execFileSync(process.execPath, [join(dir, 'production-host.mjs'), 'manifest', join(rebuiltRelease, 'standby.json'), rebuiltRelease.split('/').at(-1)], { encoding: 'utf8' }).trim(), `v1.0.1 ${next}`);
    const rollback = ['--rollback', 'v1.0.1', next, 'v1.0.0', old];
    writeFileSync(join(dir, 'fail-drain'), '');
    assert.equal(run(rollback).status, 1);
    assert.match(readFileSync(config, 'utf8'), /RIVALHUB_RELEASE_TAG=v1.0.1/);
    assert.equal(readlinkSync(join(root, 'current')), `releases/${rebuiltRelease.split('/').at(-1)}`);
    rmSync(join(dir, 'fail-drain'));
    assert.equal(run(rollback).status, 0);
    assert.equal(run(rollback).status, 0);
    assert.equal(readFileSync(config, 'utf8'), oldEnv);
    // Layered deployment is a different transport into the SAME recovery transaction.
    // A tiny executable wrapper keeps these fault fixtures independent of the real Node binary size.
    rmSync(join(candidate, 'runtime/node'));
    writeFileSync(join(candidate, 'runtime/node'), `#!/bin/sh\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 });
    mkdirSync(join(candidate, 'node_modules/pkg'), { recursive: true });
    writeFileSync(join(candidate, 'node_modules/pkg/index.js'), 'export default 1;');
    symlinkSync('pkg', join(candidate, 'node_modules/pkg-link'));
    mkdirSync(join(candidate, '.next/node_modules'));
    symlinkSync('../../node_modules/pkg', join(candidate, '.next/node_modules/pkg'));
    const incoming = join(dir, 'layers');
    const metadata = JSON.parse(manifest(next, 'v1.0.1'));
    const fullOutput = join(dir, 'whole-output');
    assert.equal(packageProduction(candidate, fullOutput, metadata).format, 'whole-tar');
    assert.deepEqual(readdirSync(fullOutput).sort(), [`${name(next)}.json`, `${name(next)}.tar.gz`, `${name(next)}.tar.gz.sha256`]);
    assert.throws(() => packageProduction(candidate, join(dir, 'invalid-mode'), metadata, '--unknown'));
    assert.ok(!existsSync(join(dir, 'invalid-mode')));
    assert.equal(packageProduction(candidate, incoming, metadata, '--layers').format, 'layers');
    assert.ok(!readdirSync(incoming).some(path => path.startsWith('rivalhub-production-') && path.endsWith('.tar.gz')));
    const layered = loadLayerManifest(join(incoming, `${name(next)}.layers.json`));
    const layeredPath = join(incoming, `${name(next)}.layers.json`);
    const updateManifest = value => {
      writeFileSync(layeredPath, JSON.stringify(value));
      writeFileSync(`${layeredPath}.sha256`, `${createHash('sha256').update(readFileSync(layeredPath)).digest('hex')}  ${name(next)}.layers.json\n`);
    };
    const cache = join(root, 'layers');
    const layeredArgs = [layeredPath, ...deployArgs.slice(1)];
    assert.deepEqual(missingLayers(layered, cache), layered.layers.map(layer => layer.archive));
    // Interrupted transfer: a truncated/missing layer must leave the previous version/config untouched.
    const runtimePath = join(incoming, layered.layers[0].archive);
    const runtimeArchive = readFileSync(runtimePath);
    writeFileSync(runtimePath, runtimeArchive.subarray(0, 12));
    result = run(layeredArgs);
    assert.equal(result.status, 1);
    assert.equal(readlinkSync(join(root, 'current')), `releases/${name(old)}`);
    assert.equal(readFileSync(config, 'utf8'), oldEnv);
    assert.ok(!readdirSync(join(root, 'releases')).some(path => path.startsWith('.staging.')));
    writeFileSync(runtimePath, runtimeArchive);
    writeFileSync(join(dir, 'fail'), '');
    result = run(layeredArgs);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /previous state restored/);
    assert.equal(readFileSync(config, 'utf8'), oldEnv);
    assert.deepEqual(missingLayers(layered, cache), []);
    result = run(layeredArgs);
    assert.equal(result.status, 0, result.stderr);
    const layeredRelease = join(root, readlinkSync(join(root, 'current')));
    assert.equal(statSync(layeredRelease).mode & 0o050, 0o050);
    assert.equal(statSync(join(layeredRelease, 'runtime/node')).mode & 0o050, 0o050);
    const cachedNode = join(cache, `runtime-${layered.layers[0].treeSha256}`, 'runtime/node');
    assert.notEqual(statSync(cachedNode).ino, statSync(join(layeredRelease, 'runtime/node')).ino);
    assert.equal(readlinkSync(join(layeredRelease, 'node_modules/pkg-link')), 'pkg');
    writeFileSync(join(layeredRelease, '.next/cache/live-value'), 'not a build input');
    assert.equal(run(layeredArgs).status, 1); // stale previous identity is rejected before mutation
    assert.equal(run(rollback).status, 0);
    result = run(layeredArgs); // retry the identical immutable package from its frozen previous version
    assert.equal(result.status, 0, result.stderr);
    assert.equal(run(rollback).status, 0);
    // Warm deploy needs only a changed app layer; corrupt cache is a miss, never silently reused.
    writeFileSync(join(candidate, '.next/BUILD_ID'), 'second-layered-build');
    const warm = packageLayers(candidate, incoming, metadata);
    assert.deepEqual(missingLayers(warm, cache), [warm.layers[2].archive]);
    writeFileSync(cachedNode, 'corrupt cache');
    assert.deepEqual(missingLayers(warm, cache), [warm.layers[0].archive, warm.layers[2].archive]);
    assert.ok(readFileSync(join(layeredRelease, 'runtime/node'), 'utf8').startsWith('#!/bin/sh'));
    result = run(layeredArgs);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(missingLayers(warm, cache), []);
    assert.equal(run(rollback).status, 0);
    // Missing upload fails even if some layers are already committed; no release is activated.
    const appPath = join(incoming, warm.layers[2].archive);
    const appArchive = readFileSync(appPath);
    rmSync(join(cache, `app-${warm.layers[2].treeSha256}`), { recursive: true });
    rmSync(appPath);
    result = run(layeredArgs);
    assert.equal(result.status, 1);
    assert.equal(readFileSync(config, 'utf8'), oldEnv);
    writeFileSync(appPath, appArchive);
    // A forged compressed checksum cannot bypass the extracted-content digest.
    writeFileSync(join(candidate, '.next/BUILD_ID'), 'tampered');
    const tampered = packageLayers(candidate, incoming, metadata);
    writeFileSync(appPath, readFileSync(join(incoming, tampered.layers[2].archive)));
    const frozen = { ...warm, layers: warm.layers.map((layer, index) => index === 2 ? { ...layer, sha256: tampered.layers[2].sha256, bytes: tampered.layers[2].bytes } : layer) };
    updateManifest(frozen);
    assert.equal(loadLayerManifest(layeredPath).sourceCommit, next);
    result = run(layeredArgs);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Extracted layer checksum mismatch/);
    assert.equal(readFileSync(config, 'utf8'), oldEnv);
    assert.ok(!readdirSync(cache).some(path => path.startsWith('.incoming-')));
    // Even a checksum-updated tar cannot substitute an escaping link for the typed build inventory.
    const deps = warm.layers[1];
    rmSync(join(candidate, 'node_modules/pkg-link'));
    symlinkSync('/etc/passwd', join(candidate, 'node_modules/pkg-link'));
    const depsArchive = join(incoming, deps.archive);
    execFileSync('tar', ['-czf', depsArchive, '-C', candidate, 'node_modules']);
    const unsafe = { ...warm, layers: warm.layers.map((layer, index) => index === 1 ? { ...layer, bytes: statSync(depsArchive).size, sha256: createHash('sha256').update(readFileSync(depsArchive)).digest('hex') } : layer) };
    updateManifest(unsafe);
    rmSync(join(cache, `deps-${deps.treeSha256}`), { recursive: true });
    result = run(layeredArgs);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /tar type or link mismatch/);
    assert.equal(readFileSync(config, 'utf8'), oldEnv);
    rmSync(join(candidate, 'node_modules/pkg-link'));
    symlinkSync('pkg', join(candidate, 'node_modules/pkg-link'));
    // Source/config changes are bound in standby.json, even with identical runtime/dependencies.
    writeFileSync(join(candidate, 'standby.json'), JSON.stringify({ ...metadata, sourceCommit: 'e'.repeat(40), configurationSha256: 'f'.repeat(64) }));
    const changed = packageLayers(candidate, incoming, { ...metadata, sourceCommit: 'e'.repeat(40), configurationSha256: 'f'.repeat(64) });
    assert.equal(changed.layers[0].treeSha256, warm.layers[0].treeSha256);
    assert.equal(changed.layers[1].treeSha256, warm.layers[1].treeSha256);
    assert.notEqual(changed.layers[2].treeSha256, warm.layers[2].treeSha256);
    writeFileSync(join(candidate, 'runtime/node'), readFileSync(join(candidate, 'runtime/node'), 'utf8') + '# upgraded runtime\n');
    const upgraded = packageLayers(candidate, incoming, { ...metadata, sourceCommit: 'e'.repeat(40), configurationSha256: 'f'.repeat(64) });
    assert.notEqual(upgraded.layers[0].treeSha256, changed.layers[0].treeSha256);
    // Cross-layer/absolute links cannot be published, nor can descendants of a symlink be extracted.
    for (const target of ['../../runtime/node', '/etc/passwd', '../../../outside']) {
      symlinkSync(target, join(candidate, 'node_modules/escape'));
      assert.throws(() => packageLayers(candidate, incoming, metadata));
      rmSync(join(candidate, 'node_modules/escape'));
    }
    // Stop failure preserves the current release and its service configuration.
    writeFileSync(join(dir, 'fail-stop'), '');
    const beforeStopFailure = readFileSync(unit, 'utf8');
    result = run(deployArgs);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /service state is unknown/);
    assert.equal(readFileSync(unit, 'utf8'), beforeStopFailure);
    assert.equal(readFileSync(config, 'utf8'), oldEnv);
    rmSync(join(dir, 'fail-stop'));
    writeFileSync(join(rebuiltRelease, 'standby.json'), '{}');
    assert.equal(run(deployArgs).status, 1);
    assert.equal(readFileSync(config, 'utf8'), oldEnv);
    writeFileSync(join(dir, 'locked'), '');
    assert.match(run(deployArgs).stderr, /Another production operation/);
    assert.ok(existsSync(snapshot));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
