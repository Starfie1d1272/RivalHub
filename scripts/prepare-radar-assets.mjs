import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cp, mkdir, readFile } from 'node:fs/promises';
const root = dirname(fileURLToPath(import.meta.resolve('@mizar-hud/radar-view')));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const version = manifest.dependencies['@mizar-hud/radar-view'];
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('radar-view must use an exact published version');
const destination = new URL(`../public/vendor/radar/${version}/`, import.meta.url);
await mkdir(destination, { recursive: true });
await cp(join(root, 'assets'), destination, { recursive: true });
for (const name of ['radar-provenance.json', 'icon-provenance.json', 'THIRD-PARTY-NOTICES.md']) {
  await cp(join(root, name), new URL(name, destination));
}
