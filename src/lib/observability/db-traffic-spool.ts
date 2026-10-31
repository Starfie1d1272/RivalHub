import { mkdir, open, readFile, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { digestDbTraffic } from "./db-traffic-contract";

/** The whole state is committed together so queue and loss evidence cannot diverge. */
export type SpoolItem = { id: string; body: string; digest: string; at: number; attempted: boolean; nextAttemptAt: number; attempts: number; coverageRevision?: number };
export type SpoolGap = SpoolItem;
export type SpoolState = { version: 1; globalNextAttemptAt: number; globalFailures: number; quarantineNextAttemptAt: number; gapNextAttemptAt: number; batches: SpoolItem[]; gaps: SpoolGap[]; coverageUnknownSince: number | null; coverageReportedSince: number | null; openWindowSince: number | null; openWindowIdentity?: { process: string; release: string; deployment: string }; coverageIdentity?: { process: string; release: string; deployment: string }; coverageRevision?: number; coverageReportedRevision?: number; coverageNextAttemptAt?: number };
const empty = (): SpoolState => ({ version: 1, globalNextAttemptAt: 0, globalFailures: 0, quarantineNextAttemptAt: 0, gapNextAttemptAt: 0, batches: [], gaps: [], coverageUnknownSince: null, coverageReportedSince: null, openWindowSince: null });
const maxBytes = 10 * 1024 * 1024;

function valid(value: unknown): value is SpoolState {
  if (!value || typeof value !== "object") return false;
  const state = value as SpoolState;
  const item = (x: SpoolItem) => !!x && typeof x.id === "string" && typeof x.body === "string" && typeof x.digest === "string" && Number.isSafeInteger(x.at) && typeof x.attempted === "boolean" && Number.isSafeInteger(x.nextAttemptAt) && Number.isSafeInteger(x.attempts) && x.attempts >= 0 && (x.coverageRevision === undefined || (Number.isSafeInteger(x.coverageRevision) && x.coverageRevision >= 0));
  const identity = (x: SpoolState["openWindowIdentity"]) => x === undefined || (!!x && typeof x.process === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x.process) && typeof x.release === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(x.release) && typeof x.deployment === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(x.deployment));
  const optionalCounter = (x: number | undefined) => x === undefined || (Number.isSafeInteger(x) && x >= 0);
  return identity(state.openWindowIdentity) && identity(state.coverageIdentity) && optionalCounter(state.coverageRevision) && optionalCounter(state.coverageReportedRevision) && optionalCounter(state.coverageNextAttemptAt) && state.version === 1 && Number.isSafeInteger(state.globalNextAttemptAt) && state.globalNextAttemptAt >= 0 && Number.isSafeInteger(state.globalFailures) && state.globalFailures >= 0 && Number.isSafeInteger(state.quarantineNextAttemptAt) && state.quarantineNextAttemptAt >= 0 && Number.isSafeInteger(state.gapNextAttemptAt) && state.gapNextAttemptAt >= 0 && Array.isArray(state.batches) && state.batches.length <= 256 && state.batches.every(item) && state.batches.reduce((sum, entry) => sum + Buffer.byteLength(entry.body), 0) <= maxBytes && Array.isArray(state.gaps) && state.gaps.length <= 32 && state.gaps.every(item) && state.gaps.reduce((sum, entry) => sum + Buffer.byteLength(entry.body), 0) <= 128 * 1024 && (state.coverageUnknownSince === null || Number.isSafeInteger(state.coverageUnknownSince)) && (state.coverageReportedSince === null || Number.isSafeInteger(state.coverageReportedSince)) && (state.openWindowSince === null || Number.isSafeInteger(state.openWindowSince));
}

async function verifyBodies(state: SpoolState): Promise<void> {
  for (const [items, gap] of [[state.batches, false], [state.gaps, true]] as const) {
    for (const item of items) {
      if (Buffer.byteLength(item.body) > (gap ? 4096 : 40000)) throw new Error("invalid spool body size");
      const body: unknown = JSON.parse(item.body);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid spool body");
      const value = body as { id?: unknown; at?: unknown; reportedAt?: unknown };
      if (value.id !== item.id || (gap ? value.reportedAt : value.at) !== item.at || await digestDbTraffic(value) !== item.digest) throw new Error("spool body integrity mismatch");
    }
  }
}

/** A failure is surfaced; an unreadable/corrupt state is never replaced with an empty queue. */
export class DbTrafficSpool {
  private constructor(readonly directory: string, private current: SpoolState, private readonly lock: DatabaseSync, readonly orphanSince: number | null, private readonly orphans: string[]) {}
  static async open(directory: string): Promise<DbTrafficSpool> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await stat(directory);
    if (!info.isDirectory() || (info.mode & 0o077) !== 0) throw new Error("unsafe spool directory");
    // SQLite holds an OS-level exclusive writer lock for the life of this owner;
    // process death releases it without stale-PID recovery or a helper process.
    const { DatabaseSync } = await import("node:sqlite");
    const lock = new DatabaseSync(join(directory, "owner.sqlite"));
    try {
      lock.exec("BEGIN IMMEDIATE");
      const orphans = (await readdir(directory)).filter(name => /^\.(?:state|exit)-[0-9a-f-]{36}\.tmp$/i.test(name));
      let orphanSince: number | null = null;
      for (const name of orphans) { const info = await stat(join(directory, name)); const at = Math.floor(info.mtimeMs); orphanSince = Math.min(orphanSince ?? at, at); }
      let raw: string;
      try { raw = await readFile(join(directory, "state.json"), "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return new DbTrafficSpool(directory, empty(), lock, orphanSince, orphans); throw error; }
      if (Buffer.byteLength(raw) > maxBytes + 1024 * 1024) throw new Error("spool state exceeds limit");
      const parsed: unknown = JSON.parse(raw);
      if (!valid(parsed)) throw new Error("invalid spool state");
      await verifyBodies(parsed);
      return new DbTrafficSpool(directory, parsed, lock, orphanSince, orphans);
    } catch (error) { lock.close(); throw error; }
  }
  async cleanupOrphans(): Promise<void> { for (const name of this.orphans) if (name.startsWith(".state-")) await unlink(join(this.directory, name)).catch(() => {}); }
  close(): void { this.lock.close(); }
  snapshot(): SpoolState { return structuredClone(this.current); }
  async commit(next: SpoolState): Promise<void> {
    if (!valid(next)) throw new Error("invalid spool state");
    await verifyBodies(next);
    const body = JSON.stringify(next);
    if (Buffer.byteLength(body) > maxBytes + 1024 * 1024) throw new Error("spool state exceeds limit");
    const tmp = join(this.directory, `.state-${crypto.randomUUID()}.tmp`);
    let file;
    try {
      file = await open(tmp, "wx", 0o600);
      await file.writeFile(body, "utf8"); await file.sync(); await file.close(); file = undefined;
      await rename(tmp, join(this.directory, "state.json"));
      const dir = await open(this.directory, "r");
      try { await dir.sync(); } finally { await dir.close(); }
      this.current = structuredClone(next);
    } finally {
      if (file) await file.close().catch(() => {});
      await unlink(tmp).catch(() => {});
    }
  }
}
