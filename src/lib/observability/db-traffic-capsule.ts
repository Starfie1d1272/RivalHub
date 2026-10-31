import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { link, open, readFile, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { isSafeDbTrafficBatch } from "./db-traffic-contract";

type Capsule = { version: 1; batches: string[]; unknownAt: number | null };
type File = { name: string; capsule: Capsule };
const namePattern = /^exit-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;

/** Only called by the locked owner from a synchronous process exit hook. */
export function writeExitCapsule(directory: string, capsule: Capsule): void {
  if (capsule.version !== 1 || !Array.isArray(capsule.batches) || capsule.batches.length > 2 || (capsule.unknownAt !== null && !Number.isSafeInteger(capsule.unknownAt))) throw new Error("invalid exit capsule");
  for (const body of capsule.batches) {
    if (typeof body !== "string" || Buffer.byteLength(body) > 40000 || !isSafeDbTrafficBatch(JSON.parse(body))) throw new Error("invalid exit capsule batch");
  }
  const token = crypto.randomUUID(); const temporary = join(directory, `.exit-${token}.tmp`); const target = join(directory, `exit-${token}.json`);
  let file: number | undefined; let reserved = false;
  try {
    file = openSync(temporary, "wx", 0o600); writeFileSync(file, JSON.stringify(capsule)); fsyncSync(file); closeSync(file); file = undefined;
    // Reserve the target exclusively so even a UUID collision cannot replace
    // another capsule. A crash leaves a corrupt placeholder that fails closed.
    const placeholder = openSync(target, "wx", 0o600); closeSync(placeholder); reserved = true;
    renameSync(temporary, target); reserved = false;
    const dir = openSync(directory, "r"); try { fsyncSync(dir); } finally { closeSync(dir); }
  } finally { if (file !== undefined) closeSync(file); if (reserved) { try { unlinkSync(target); } catch { /* Preserve the original failure. */ } } try { unlinkSync(temporary); } catch { /* Already renamed or absent. */ } }
}

/** Invalid capsules remain evidence; they cannot block the verified spool. */
export async function readExitCapsules(directory: string): Promise<{ files: File[]; invalid: Array<{ name: string; at: number }>; truncated: boolean }> {
  const names = (await readdir(directory)).filter(name => namePattern.test(name)).sort();
  const files: File[] = []; const invalid: Array<{ name: string; at: number }> = [];
  for (const name of names.slice(0, 128)) {
    const info = await stat(join(directory, name));
    const at = Number.isSafeInteger(Math.floor(info.mtimeMs)) ? Math.floor(info.mtimeMs) : Date.now();
    if (info.size > 128 * 1024) { invalid.push({ name, at }); continue; }
    const raw = await readFile(join(directory, name), "utf8");
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid exit capsule");
      const capsule = value as Capsule;
      if (Object.keys(capsule).sort().join() !== "batches,unknownAt,version" || capsule.version !== 1 || !Array.isArray(capsule.batches) || capsule.batches.length > 2 || (capsule.unknownAt !== null && !Number.isSafeInteger(capsule.unknownAt))) throw new Error("invalid exit capsule");
      for (const body of capsule.batches) {
        if (typeof body !== "string" || Buffer.byteLength(body) > 40000 || !isSafeDbTrafficBatch(JSON.parse(body))) throw new Error("invalid exit capsule batch");
      }
      files.push({ name, capsule });
    } catch { invalid.push({ name, at }); }
  }
  return { files, invalid, truncated: names.length > 128 };
}

/** Preserve invalid content under a name excluded from active recovery. */
export async function isolateInvalidCapsules(directory: string, invalid: Array<{ name: string }>): Promise<void> {
  for (const item of invalid) {
    const source = join(directory, item.name); const target = join(directory, `invalid-${crypto.randomUUID()}-${item.name}`);
    await link(source, target); await unlink(source);
  }
  if (invalid.length) { const dir = await open(directory, "r"); try { await dir.sync(); } finally { await dir.close(); } }
}

export async function deleteExitCapsules(directory: string, files: File[]): Promise<void> {
  for (const file of files) await unlink(join(directory, file.name));
  if (files.length) { const dir = await open(directory, "r"); try { await dir.sync(); } finally { await dir.close(); } }
}
