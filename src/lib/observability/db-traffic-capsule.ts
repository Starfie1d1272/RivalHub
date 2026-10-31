import { createHash } from "node:crypto";
import { closeSync, fsyncSync, linkSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { link, open, readFile, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { isSafeDbTrafficBatch } from "./db-traffic-contract";

type Capsule = { version: 1; batches: string[]; unknownAt: number | null };
function capsuleChecksum(capsule: Capsule): string {
  return createHash("sha256").update(JSON.stringify({ version: capsule.version, batches: capsule.batches, unknownAt: capsule.unknownAt })).digest("hex");
}
type File = { name: string; at: number; capsule: Capsule };
const namePattern = /^exit-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;

/** Only called by the locked owner from a synchronous process exit hook. */
export function writeExitCapsule(directory: string, capsule: Capsule): void {
  if (capsule.version !== 1 || !Array.isArray(capsule.batches) || capsule.batches.length > 2 || (capsule.unknownAt !== null && !Number.isSafeInteger(capsule.unknownAt))) throw new Error("invalid exit capsule");
  for (const body of capsule.batches) {
    if (typeof body !== "string" || Buffer.byteLength(body) > 40000 || !isSafeDbTrafficBatch(JSON.parse(body))) throw new Error("invalid exit capsule batch");
  }
  const token = crypto.randomUUID(); const temporary = join(directory, `.exit-${token}.tmp`); const target = join(directory, `exit-${token}.json`);
  let file: number | undefined;
  try {
    file = openSync(temporary, "wx", 0o600); writeFileSync(file, JSON.stringify({ version: capsule.version, batches: capsule.batches, unknownAt: capsule.unknownAt, checksum: capsuleChecksum(capsule) })); fsyncSync(file); closeSync(file); file = undefined;
    // A same-directory hard link publishes without replacing an existing ID.
    // Never fall back to an empty target if links are unavailable.
    linkSync(temporary, target);
    const dir = openSync(directory, "r");
    try { fsyncSync(dir); unlinkSync(temporary); fsyncSync(dir); } finally { closeSync(dir); }
  } finally { if (file !== undefined) closeSync(file); }

}

/** Invalid capsules remain evidence; they cannot block the verified spool. */
export async function readExitCapsules(directory: string): Promise<{ files: File[]; invalid: Array<{ name: string; at: number }>; truncated: boolean }> {
  const names = (await readdir(directory)).filter(name => namePattern.test(name)).sort();
  if (names.length > 128) throw new Error("too many database traffic exit capsules");
  const files: File[] = []; const invalid: Array<{ name: string; at: number }> = [];
  for (const name of names) {
    const info = await stat(join(directory, name));
    const at = Number.isSafeInteger(Math.floor(info.mtimeMs)) ? Math.floor(info.mtimeMs) : Date.now();
    if (info.size > 128 * 1024) { invalid.push({ name, at }); continue; }
    const raw = await readFile(join(directory, name), "utf8");
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid exit capsule");
      const capsule = value as Capsule & { checksum?: unknown };
      if (Object.keys(capsule).sort().join() !== "batches,checksum,unknownAt,version" || capsule.version !== 1 || !Array.isArray(capsule.batches) || capsule.batches.length > 2 || (capsule.unknownAt !== null && !Number.isSafeInteger(capsule.unknownAt))) throw new Error("invalid exit capsule");
      if (typeof capsule.checksum !== "string" || !/^[0-9a-f]{64}$/.test(capsule.checksum) || capsule.checksum !== capsuleChecksum(capsule)) throw new Error("invalid exit capsule checksum");
      for (const body of capsule.batches) {
        if (typeof body !== "string" || Buffer.byteLength(body) > 40000 || !isSafeDbTrafficBatch(JSON.parse(body))) throw new Error("invalid exit capsule batch");
      }
      files.push({ name, at, capsule });
    } catch { invalid.push({ name, at }); }
  }
  return { files, invalid, truncated: false };
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
