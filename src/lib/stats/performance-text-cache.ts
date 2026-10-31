import "server-only";

// Bound both memory and the lifetime of reusable wire representations. The
// current database fingerprint is still checked in every snapshot.
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 512;
const MAX_ENTRY_BYTES = 512 * 1024;
const TTL_MS = 5 * 60 * 1000;
const entries = new Map<string, { text: string; bytes: number; expires: number }>();
let totalBytes = 0;

export function getPerformanceText(key: string): string | undefined {
  try {
    const entry = entries.get(key);
    if (!entry) return undefined;
    entries.delete(key);
    if (entry.expires <= Date.now()) { totalBytes -= entry.bytes; return undefined; }
    entries.set(key, entry);
    return entry.text;
  } catch { return undefined; }
}

export function putPerformanceText(key: string, text: string): void {
  try {
    const bytes = Buffer.byteLength(key, "utf8") + Buffer.byteLength(text, "utf8");
    if (bytes > MAX_ENTRY_BYTES || bytes > MAX_BYTES) return;
    const previous = entries.get(key);
    if (previous) { entries.delete(key); totalBytes -= previous.bytes; }
    while (entries.size >= MAX_ENTRIES || totalBytes + bytes > MAX_BYTES) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      totalBytes -= entries.get(oldest)!.bytes;
      entries.delete(oldest);
    }
    entries.set(key, { text, bytes, expires: Date.now() + TTL_MS });
    totalBytes += bytes;
  } catch { /* Cache failures must not affect the database read. */ }
}
