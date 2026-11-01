import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';

test('Preview install verifies the candidate and leaves the service disabled and stopped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rivalhub-preview-install-'));
  try {
    const src = dirname(fileURLToPath(import.meta.url));
    const root = join(dir, 'root'); const etc = join(dir, 'etc'); const bin = join(dir, 'bin');
    for (const p of [root, etc, bin, join(dir, 'candidate/runtime'), join(dir, 'candidate/scripts/standby')]) mkdirSync(p, { recursive: true });
    const script = readFileSync(join(src, 'install-preview.sh'), 'utf8')
      .replaceAll('/opt/rivalhub-standby', root)
      .replaceAll('/etc/rivalhub-standby', etc)
      .replaceAll('/etc/systemd/system/rivalhub-standby.service', join(etc, 'rivalhub-standby.service'));
    writeFileSync(join(dir, 'install-preview.sh'), script);
    writeFileSync(join(dir, 'rivalhub-standby.service'), 'service');
    writeFileSync(join(dir, 'preview.env'), 'NODE_ENV=production\n');
    writeFileSync(join(dir, 'candidate/runtime/node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(dir, 'candidate/standby.json'), '{}');
    writeFileSync(join(dir, 'candidate/scripts/standby/start.mjs'), '');
    const sha = 'b'.repeat(40); const archive = join(dir, `rivalhub-standby-${sha}.tar.gz`);
    execFileSync('tar', ['-czf', archive, '-C', join(dir, 'candidate'), '.']);
    writeFileSync(archive + '.sha256', 'fixture');
    for (const [name, body] of Object.entries({
      id: 'if [ "$1" = "-u" ]; then echo 0; fi; exit 0',
      sha256sum: 'exit 0', chown: 'exit 0', sleep: 'exit 0',
      mv: 'if [ "$1" = "-Tf" ]; then shift; fi; exec python3 -c \"import os,sys; os.replace(sys.argv[1],sys.argv[2])\" "$@"',
      curl: `printf '%s' '{"releaseCommit":"${sha}"}'`,
      systemctl: `printf '%s\\n' "$*" >> '${join(dir, 'events')}'`,
    })) writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    const run = spawnSync('bash', [join(dir, 'install-preview.sh'), archive, join(dir, 'preview.env')], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(run.status, 0, run.stderr);
    const events = readFileSync(join(dir, 'events'), 'utf8').trim().split('\n');
    assert.deepEqual(events, ['daemon-reload', 'disable rivalhub-standby', 'restart rivalhub-standby', 'stop rivalhub-standby']);
    assert.equal(readlinkSync(join(root, 'current')), `releases/rivalhub-standby-${sha}`);
    writeFileSync(join(bin, 'curl'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    writeFileSync(join(dir, 'events'), '');
    const failedSha = 'c'.repeat(40); const failedArchive = join(dir, `rivalhub-standby-${failedSha}.tar.gz`);
    execFileSync('tar', ['-czf', failedArchive, '-C', join(dir, 'candidate'), '.']);
    writeFileSync(failedArchive + '.sha256', 'fixture');
    const failed = spawnSync('bash', [join(dir, 'install-preview.sh'), failedArchive, join(dir, 'preview.env')], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(failed.status, 1);
    assert.equal(readlinkSync(join(root, 'current')), `releases/rivalhub-standby-${sha}`);
    assert.deepEqual(readFileSync(join(dir, 'events'), 'utf8').trim().split('\n'), ['daemon-reload', 'disable rivalhub-standby', 'restart rivalhub-standby', 'stop rivalhub-standby']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
