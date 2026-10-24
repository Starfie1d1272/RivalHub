import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const kinds = ['runtime', 'deps', 'app'];
const digest = value => createHash('sha256').update(value).digest('hex');
const fileDigest = path => {
  const hash = createHash('sha256'), fd = openSync(path, 'r'), buffer = Buffer.allocUnsafe(64 * 1024);
  try { let bytes; while ((bytes = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes)); }
  finally { closeSync(fd); }
  return hash.digest('hex');
};
const hashPattern = /^[a-f0-9]{64}$/;
const cleanPath = path => typeof path === 'string' && path !== '' && !/[\x00-\x1f\x7f]/.test(path)
  && !posix.isAbsolute(path) && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
const belongs = (path, kind) => kind === 'runtime' ? path === 'runtime' || path.startsWith('runtime/')
  : kind === 'deps' ? path === 'node_modules' || path.startsWith('node_modules/')
  : !['runtime', 'node_modules'].includes(path.split('/')[0]);

// Dependency/runtime layers are closed; app may reference traced dependencies inside the assembled release.
function assertEntries(entries, kind) {
  const paths = new Map();
  for (const entry of entries) {
    if (!cleanPath(entry.path) || !belongs(entry.path, kind) || paths.has(entry.path)
      || !['file', 'dir', 'link'].includes(entry.type)) throw Error('Invalid layer entry.');
    if (entry.type === 'link' && (typeof entry.target !== 'string' || /[\x00-\x1f\x7f]/.test(entry.target)
      || posix.isAbsolute(entry.target) || !cleanPath(posix.normalize(posix.join(posix.dirname(entry.path), entry.target)))
      || !(belongs(posix.normalize(posix.join(posix.dirname(entry.path), entry.target)), kind)
        || kind === 'app' && belongs(posix.normalize(posix.join(posix.dirname(entry.path), entry.target)), 'deps')))) throw Error('Layer link escapes its boundary.');
    paths.set(entry.path, entry);
  }
  for (const path of paths.keys()) {
    for (let parent = posix.dirname(path); parent !== '.'; parent = posix.dirname(parent)) {
      if (paths.get(parent)?.type !== 'dir') throw Error('Layer entry has a non-directory parent.');
    }
  }
}

export function inventory(root) {
  const entries = [];
  function walk(relative = '') {
    for (const name of readdirSync(join(root, relative)).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      const absolute = join(root, path), stat = lstatSync(absolute);
      if (stat.mode & 0o7000) throw Error('Special package permissions are forbidden.');
      if (stat.isDirectory()) { entries.push({ path, type: 'dir' }); walk(path); }
      else if (stat.isSymbolicLink()) entries.push({ path, type: 'link', target: readlinkSync(absolute) });
      else if (stat.isFile()) entries.push({ path, type: 'file' });
      else throw Error('Unexpected package file type.');
    }
  }
  walk();
  return entries;
}

// Canonical JSON records bind names, types, executable bits and contents; ownership/mtime are irrelevant.
export function treeDigest(root, entries = inventory(root)) {
  const hash = createHash('sha256');
  for (const entry of entries) {
    const path = join(root, entry.path);
    const value = entry.type === 'file' ? [entry.path, entry.type, Boolean(lstatSync(path).mode & 0o100), fileDigest(path)]
      : entry.type === 'link' ? [entry.path, entry.type, entry.target] : [entry.path, entry.type];
    hash.update(JSON.stringify(value) + '\n');
  }
  return hash.digest('hex');
}

function verifyTree(root, layer) {
  if (!existsSync(root) || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) return false;
  try {
    const entries = inventory(root);
    assertEntries(entries, layer.kind);
    for (const entry of entries.filter(entry => entry.type === 'link' && layer.kind !== 'app')) {
      const target = realpathSync(join(root, entry.path));
      if (!target.startsWith(realpathSync(root) + '/')) return false;
    }
    return JSON.stringify(entries) === JSON.stringify(layer.entries) && treeDigest(root, entries) === layer.treeSha256;
  } catch { return false; }
}

// Compare BOTH standard tar listings with the build's typed inventory before root extracts anything.
// This rejects hard links/devices, duplicate members, path traversal and symlink-parent writes.
function verifyArchive(path, layer) {
  if (!lstatSync(path).isFile() || statSync(path).size !== layer.bytes || fileDigest(path) !== layer.sha256) throw Error('Layer archive checksum mismatch.');
  const names = execFileSync('tar', ['-tzf', path], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trimEnd().split('\n');
  const verbose = execFileSync('tar', ['-tvzf', path], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trimEnd().split('\n');
  if (names.length !== layer.entries.length || verbose.length !== names.length) throw Error('Layer tar inventory mismatch.');
  const expected = new Map(layer.entries.map(entry => [entry.path, entry]));
  for (let i = 0; i < names.length; i++) {
    const name = names[i], entry = expected.get(name.replace(/\/$/, ''));
    if (!entry) throw Error('Unexpected layer tar member.');
    const type = { file: '-', dir: 'd', link: 'l' }[entry.type];
    const suffix = ` ${name}${entry.type === 'link' ? ` -> ${entry.target}` : ''}`;
    if (verbose[i][0] !== type || /[sStT]/.test(verbose[i].slice(1, 10)) || !verbose[i].endsWith(suffix)) throw Error('Layer tar type or link mismatch.');
    expected.delete(entry.path);
  }
  if (expected.size) throw Error('Missing layer tar member.');
}

/** @returns {{sourceCommit: string, releaseTag: string, operatorCommit: string, layers: {archive: string, bytes: number, kind: string, treeSha256: string, sha256: string, entries: object[]}[]}} */
export function loadLayerManifest(path) {
  const raw = readFileSync(path);
  if (readFileSync(`${path}.sha256`, 'utf8').trim() !== `${digest(raw)}  ${basename(path)}`) throw Error('Layer manifest checksum mismatch.');
  const manifest = JSON.parse(raw.toString('utf8'));
  if (manifest.format !== 1 || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit ?? '')
    || !/^[a-f0-9]{40}$/.test(manifest.operatorCommit ?? '') || !/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.releaseTag ?? '')
    || !hashPattern.test(manifest.configurationSha256 ?? '') || !hashPattern.test(manifest.bundleTreeSha256 ?? '')
    || manifest.platform !== 'linux' || manifest.architecture !== 'x64' || manifest.layers?.length !== 3) throw Error('Invalid layered package manifest.');
  for (let i = 0; i < kinds.length; i++) {
    const layer = manifest.layers[i];
    if (layer.kind !== kinds[i] || !hashPattern.test(layer.treeSha256 ?? '') || !hashPattern.test(layer.sha256 ?? '')
      || layer.archive !== `${layer.kind}-${layer.treeSha256}.tar.gz` || !Number.isSafeInteger(layer.bytes) || layer.bytes <= 0 || !Array.isArray(layer.entries) || !layer.entries.length) throw Error('Invalid layer descriptor.');
    assertEntries(layer.entries, layer.kind);
  }
  return manifest;
}

function assertClosedLinks(root, entries) {
  const base = realpathSync(root) + '/';
  for (const entry of entries.filter(entry => entry.type === 'link')) {
    if (!realpathSync(join(root, entry.path)).startsWith(base)) throw Error('Package link escapes its boundary.');
  }
}

export function packageLayers(bundle, output, manifest) {
  mkdirSync(output, { recursive: true });
  const all = inventory(bundle);
  assertClosedLinks(bundle, all);
  const layers = kinds.map(kind => {
    const entries = all.filter(entry => belongs(entry.path, kind));
    assertEntries(entries, kind);
    // Build and host use precisely the same projection; lockfile identity alone cannot identify traced dependencies.
    const treeSha256 = treeDigest(bundle, entries);
    const archive = `${kind}-${treeSha256}.tar.gz`;
    const roots = entries.filter(entry => !entry.path.includes('/')).map(entry => entry.path);
    execFileSync('tar', ['-czf', join(output, archive), '-C', bundle, '--', ...roots]);
    const layer = { kind, treeSha256, archive, bytes: statSync(join(output, archive)).size, sha256: fileDigest(join(output, archive)), entries };
    verifyArchive(join(output, archive), layer);
    return layer;
  });
  const result = { ...manifest, format: 1, bundleTreeSha256: treeDigest(bundle, all), layers };
  const name = `rivalhub-production-${manifest.sourceCommit}-${manifest.configurationSha256.slice(0, 12)}.layers.json`;
  const raw = JSON.stringify(result) + '\n';
  writeFileSync(join(output, name), raw);
  writeFileSync(join(output, `${name}.sha256`), `${digest(raw)}  ${name}\n`);
  return result;
}

// The historical CLI remains whole-tar; only Release explicitly opts into layered transfer.
export function packageProduction(bundle, output, manifest, mode) {
  if (mode !== undefined && mode !== '--layers') throw Error('Unknown production package mode.');
  if (mode === '--layers') {
    const layered = packageLayers(bundle, output, manifest);
    const manifestBytes = Buffer.byteLength(JSON.stringify(layered) + '\n');
    return { format: 'layers', manifestBytes, coldLayerBytes: layered.layers.reduce((sum, layer) => sum + layer.bytes, 0),
      warmLayerBytes: layered.layers.find(layer => layer.kind === 'app').bytes };
  }
  mkdirSync(output, { recursive: true });
  const name = `rivalhub-production-${manifest.sourceCommit}-${manifest.configurationSha256.slice(0, 12)}`;
  const archive = join(output, `${name}.tar.gz`);
  execFileSync('tar', ['-czf', archive, '-C', bundle, '.']);
  const sha256 = fileDigest(archive);
  writeFileSync(`${archive}.sha256`, `${sha256}  ${name}.tar.gz\n`);
  writeFileSync(join(output, `${name}.json`), JSON.stringify({ ...manifest, sha256 }, null, 2) + '\n');
  return { format: 'whole-tar', sha256 };
}

export function missingLayers(manifest, cache) {
  return manifest.layers.filter(layer => !verifyTree(join(cache, `${layer.kind}-${layer.treeSha256}`), layer)).map(layer => layer.archive);
}

export function assembleLayers(manifestPath, incoming, cache, staging, tag, commit) {
  const manifest = loadLayerManifest(manifestPath);
  if (manifest.releaseTag !== tag || manifest.sourceCommit !== commit) throw Error('Layered release identity mismatch.');
  mkdirSync(cache, { recursive: true, mode: 0o700 });
  if (!lstatSync(cache).isDirectory() || lstatSync(cache).isSymbolicLink()) throw Error('Layer cache must be a real directory.');
  if (readdirSync(staging).length) throw Error('Layer staging must be empty.');
  for (const layer of manifest.layers) {
    const target = join(cache, `${layer.kind}-${layer.treeSha256}`);
    if (!verifyTree(target, layer)) {
      const archive = join(incoming, layer.archive);
      verifyArchive(archive, layer);
      const temporary = mkdtempSync(join(cache, '.incoming-'));
      try {
        execFileSync('tar', ['-xpzf', archive, '-C', temporary, '--no-same-owner']);
        if (!verifyTree(temporary, layer)) throw Error('Extracted layer checksum mismatch.');
        rmSync(target, { recursive: true, force: true });
        renameSync(temporary, target);
      } finally { rmSync(temporary, { recursive: true, force: true }); }
    }
    // Releases stay self-contained: no shared hardlinks or references into mutable runtime caches.
    cpSync(target, staging, { recursive: true, dereference: false, verbatimSymlinks: true });
  }
  assertClosedLinks(staging, inventory(staging));
  // cp under the installer umask must still leave the service group able to traverse/read the release.
  for (const entry of inventory(staging)) {
    if (entry.type !== 'link') chmodSync(join(staging, entry.path), entry.type === 'dir' || lstatSync(join(staging, entry.path)).mode & 0o100 ? 0o750 : 0o640);
  }
  chmodSync(staging, 0o750);
  if (treeDigest(staging) !== manifest.bundleTreeSha256) throw Error('Assembled package checksum mismatch.');
  const identity = Object.fromEntries(Object.entries(manifest).filter(([key]) => !['format', 'bundleTreeSha256', 'layers'].includes(key)));
  if (JSON.stringify(JSON.parse(readFileSync(join(staging, 'standby.json'), 'utf8'))) !== JSON.stringify(identity)) throw Error('Assembled package metadata mismatch.');
  return digest(readFileSync(manifestPath));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, path, ...args] = process.argv.slice(2);
  if (mode === 'missing') console.log(JSON.stringify(missingLayers(loadLayerManifest(path), args[0])));
  else if (mode === 'assemble') console.log(assembleLayers(path, ...args));
  else throw Error('Unknown layer operation.');
}
