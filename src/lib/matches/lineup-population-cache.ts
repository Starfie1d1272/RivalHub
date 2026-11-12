import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LineupCareer } from "./lineup-comparison";

const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 32;
const builds = new Map<string, Promise<LineupCareer[]>>();
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

async function readPopulation(path: string): Promise<LineupCareer[] | undefined> {
  try {
    const file = await open(path, "r");
    try {
      if ((await file.stat()).size > MAX_ENTRY_BYTES) return;
      const contents = await file.readFile("utf8");
      const json = contents.slice(65);
      if (contents[64] === "\n" && contents.slice(0, 64) === digest(json)) return JSON.parse(json);
    } finally {
      await file.close();
    }
  } catch {
    // Missing or damaged disposable entries are rebuilt from a verified snapshot.
  }
}

async function writePopulation(directory: string, path: string, population: LineupCareer[]) {
  const json = JSON.stringify(population);
  if (Buffer.byteLength(json) + 65 > MAX_ENTRY_BYTES) return;
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(temporary, `${digest(json)}\n${json}`, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
    const entries = await Promise.all(
      (await readdir(directory))
        .filter((name) => /^[a-f0-9]{64}\.json(?:\.[a-f0-9-]+\.tmp)?$/.test(name))
        .map(async (name) => {
          const file = join(directory, name);
          const info = await stat(file).catch(() => undefined);
          return { file, mtime: info?.mtimeMs ?? 0, temporary: name.endsWith(".tmp") };
        }),
    );
    const expired = entries.filter(
      ({ temporary, mtime }) => temporary && Date.now() - mtime > 86_400_000,
    );
    const overflow = entries
      .filter(({ temporary }) => !temporary)
      .sort((left, right) => right.mtime - left.mtime)
      .slice(MAX_ENTRIES);
    await Promise.all(
      [...expired, ...overflow].map(({ file }) => unlink(file).catch(() => undefined)),
    );
  } catch {
    await unlink(temporary).catch(() => undefined);
  }
}

/** Only concurrent fills share a promise. Next owns the bounded process-local result cache. */
export async function reuseLineupPopulation(
  key: string,
  load: () => Promise<LineupCareer[]>,
  compatibleKeys?: () => Promise<string[]>,
) {
  const existing = builds.get(key);
  if (existing) return existing;
  const build = (async () => {
    const directory = process.env.RIVALHUB_LINEUP_CACHE_DIRECTORY;
    if (!directory) return load();
    const path = join(directory, `${digest(key)}.json`);
    const cached = await readPopulation(path);
    if (cached) return cached;
    if (compatibleKeys) {
      for (const compatible of await compatibleKeys()) {
        const older = await readPopulation(join(directory, `${digest(compatible)}.json`));
        if (older) return older;
      }
    }
    const population = await load();
    await writePopulation(directory, path, population);
    return population;
  })();
  builds.set(key, build);
  try {
    return await build;
  } finally {
    builds.delete(key);
  }
}
