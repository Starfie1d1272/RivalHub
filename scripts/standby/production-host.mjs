import { readFileSync, writeFileSync, readdirSync, lstatSync, readlinkSync, openSync, readSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [mode, ...args] = process.argv.slice(2);
const json = path => JSON.parse(readFileSync(path, 'utf8'));
if (mode === 'runtime-identity') {
  if (process.env.RIVALHUB_RELEASE_TAG !== args[0] || process.env.RIVALHUB_RELEASE_COMMIT !== args[1] || process.env.GIT_COMMIT_SHA !== args[1]) throw Error('Runtime environment identity mismatch.');
} else if (mode === 'identity') {
  const [path, tag, commit] = args;
  const actual = json(path);
  if (Object.keys(actual).sort().join(',') !== 'releaseCommit,releaseTag' || actual.releaseTag !== tag || actual.releaseCommit !== commit) throw Error('Release identity mismatch.');
} else if (mode === 'manifest') {
  const [path, name, tag, commit] = args;
  const manifest = json(path);
  const base = `rivalhub-production-${manifest.sourceCommit}-${manifest.configurationSha256.slice(0, 12)}`;
  if (!(name === base || (name.startsWith(`${base}-`) && /^[a-f0-9]{12}$/.test(name.slice(base.length + 1)))) || (tag && (manifest.releaseTag !== tag || manifest.sourceCommit !== commit))) throw Error('Package identity mismatch.');
  console.log(manifest.releaseTag, manifest.sourceCommit);
} else if (mode === 'environment') {
  const [input, output, tag, commit] = args;
  let env = readFileSync(input, 'utf8');
  for (const [key, value] of Object.entries({ RIVALHUB_RELEASE_TAG: tag, RIVALHUB_RELEASE_COMMIT: commit, GIT_COMMIT_SHA: commit })) {
    env = env.replace(new RegExp(`^(?:export\\s+)?${key}\\s*=.*(?:\\r?\\n|$)`, 'gm'), '');
    env += `\n${key}=${value}\n`;
  }
  writeFileSync(output, env, { mode: 0o600 });
} else if (mode === 'tree') {
  const hash = createHash('sha256');
  function walk(root, relative = '') {
    for (const entry of readdirSync(`${root}/${relative}`).sort()) {
      const name = relative ? `${relative}/${entry}` : entry;
      if (name === '.next/cache' || name === '.archive-sha256') continue;
      const path = `${root}/${name}`;
      const stat = lstatSync(path);
      hash.update(`${name}\0`);
      if (stat.isSymbolicLink()) hash.update(`link:${readlinkSync(path)}\0`);
      else if (stat.isDirectory()) walk(root, name);
      else if (stat.isFile()) {
        const fd = openSync(path, 'r');
        const buffer = Buffer.allocUnsafe(64 * 1024);
        try {
          let bytes;
          while ((bytes = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
        } finally { closeSync(fd); }
      }
      else throw Error('Unexpected package file type.');
    }
  }
  walk(args[0]);
  console.log(hash.digest('hex'));
} else throw Error('Unknown host operation.');
