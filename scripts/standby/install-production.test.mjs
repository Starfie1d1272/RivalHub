import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, existsSync, realpathSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

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
    for (const file of ['production-host.mjs', 'rivalhub-production.service']) writeFileSync(join(dir, file), readFileSync(join(source, file)));
    const old = 'a'.repeat(40), next = 'b'.repeat(40), hash = 'c'.repeat(64);
    const name = sha => `rivalhub-production-${sha}-${hash.slice(0, 12)}`;
    const manifest = (sha, tag) => JSON.stringify({ sourceCommit: sha, releaseTag: tag, configurationSha256: hash });
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
    mkdirSync(join(candidate, '.next'));
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
else if (cmd === 'systemctl') { if(args[0] === 'restart' && fs.existsSync(dir + '/fail')) {fs.unlinkSync(dir + '/fail'); process.exit(1);} }
else if (cmd === 'curl') { if(fs.existsSync(dir + '/fail-health') && fs.readFileSync(config,'utf8').includes('RIVALHUB_RELEASE_TAG=v1.0.1')) process.exit(22); if(args.at(-1).endsWith('/api/system/release')) {const env = fs.readFileSync(config, 'utf8'); const get = k => env.match(new RegExp('^'+k+'=(.*)$','m'))[1]; console.log(JSON.stringify({releaseTag:get('RIVALHUB_RELEASE_TAG'),releaseCommit:get('RIVALHUB_RELEASE_COMMIT')}));} }
else if (cmd === 'mv') {fs.renameSync(args.at(-2), args.at(-1));}
else if (cmd === 'sha256sum') { const crypto = require('crypto'); if(args[0] === '-c') {const [hash, file] = fs.readFileSync(args[1],'utf8').trim().split(/\\s+/); if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== hash) process.exit(1);} else console.log(crypto.createHash('sha256').update(fs.readFileSync(args[0])).digest('hex')+'  '+args[0]);}
else throw Error(cmd);
`;
    writeFileSync(join(bin, 'mock'), mock, { mode: 0o755 });
    for (const cmd of ['id','flock','chown','sleep','systemctl','curl','mv','sha256sum']) symlinkSync('mock', join(bin, cmd));
    const deployArgs = [archive, config, '--release', 'v1.0.1', next, 'v1.0.0', old];
    const run = args => spawnSync('bash', [join(dir, 'install-production.sh'), ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(run(['--rollback', 'v1.0.1', next, 'v1.0.0', old]).status, 0);
    writeFileSync(join(dir, 'fail'), '');
    let result = run(deployArgs);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(readFileSync(config, 'utf8'), oldEnv);
    assert.equal(readFileSync(unit, 'utf8'), 'old service');
    assert.match(result.stderr, /previous state restored/);
    assert.ok(!result.stderr.includes('never-print-me'));
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
    result = run(deployArgs);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(failedRelease));
    assert.equal(readlinkSync(join(root, 'current')), `releases/${rebuiltRelease.split('/').at(-1)}`);
    const snapshot = readFileSync(join(root, 'previous-snapshot'), 'utf8').trim();
    assert.equal(readFileSync(join(snapshot, 'production.env'), 'utf8'), oldEnv);
    assert.match(readFileSync(config, 'utf8'), /RIVALHUB_RELEASE_TAG=v1.0.1/);
    assert.equal(execFileSync(process.execPath, [join(dir, 'production-host.mjs'), 'manifest', join(rebuiltRelease, 'standby.json'), rebuiltRelease.split('/').at(-1)], { encoding: 'utf8' }).trim(), `v1.0.1 ${next}`);
    const rollback = ['--rollback', 'v1.0.1', next, 'v1.0.0', old];
    assert.equal(run(rollback).status, 0);
    assert.equal(run(rollback).status, 0);
    assert.equal(readFileSync(config, 'utf8'), oldEnv);
    writeFileSync(join(rebuiltRelease, 'standby.json'), '{}');
    assert.equal(run(deployArgs).status, 1);
    assert.equal(readFileSync(config, 'utf8'), oldEnv);
    writeFileSync(join(dir, 'locked'), '');
    assert.match(run(deployArgs).stderr, /Another production operation/);
    assert.ok(existsSync(snapshot));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
