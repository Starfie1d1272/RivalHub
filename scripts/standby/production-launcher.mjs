// Host-owned entrypoint: kept outside the versioned release tree.
import { lstatSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = '/opt/rivalhub-production';
try {
  lstatSync(`${root}/recovery-hold`);
  throw new Error('Recovery hold present; production startup blocked.');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const entry = realpathSync(`${root}/current/scripts/standby/start-production.mjs`);
process.argv[1] = entry;
await import(pathToFileURL(entry).href);
