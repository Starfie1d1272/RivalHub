import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('journal opt-in preserves existing policy and never restarts services', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rivalhub-journal-'));
  try {
    const source = dirname(fileURLToPath(import.meta.url));
    const etc = join(dir, 'etc');
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    mkdirSync(join(dir, 'journal'));
    for (const file of ['journald.conf', 'service.conf']) copyFileSync(join(source, 'journal', file), join(dir, 'journal', file));
    writeFileSync(join(dir, 'configure-journal.sh'), readFileSync(join(source, 'configure-journal.sh'), 'utf8').replaceAll('/etc/systemd', etc));
    writeFileSync(join(bin, 'systemctl'), `#!/bin/sh
printf '%s\\n' "$*" >> '${dir}/calls'
case "$1" in
 --version) echo 'systemd 252';;
 show) echo loaded;;
 cat|daemon-reload) exit 0;;
 *) exit 1;;
esac
`, { mode: 0o755 });
    writeFileSync(join(bin, 'id'), '#!/bin/sh\necho 0\n', { mode: 0o755 });
    const run = (...args) => spawnSync('bash', [join(dir, 'configure-journal.sh'), ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(run().status, 0);
    assert.equal(existsSync(etc), false);
    assert.equal(run('--apply', 'other-service').status, 1);
    assert.equal(run('--apply').status, 0);
    const journal = join(etc, 'journald@rivalhub.conf');
    assert.match(readFileSync(journal, 'utf8'), /SystemMaxUse=256M/);
    assert.equal(run('--apply', 'rivalhub-standby').status, 0);
    assert.equal(run('--apply').status, 0);
    writeFileSync(journal, 'operator policy');
    assert.equal(run('--apply').status, 1);
    assert.equal(readFileSync(journal, 'utf8'), 'operator policy');
    assert.doesNotMatch(readFileSync(join(dir, 'calls'), 'utf8'), /restart|stop|vacuum/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
