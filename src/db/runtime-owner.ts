import type { Pool } from "pg";
import type { DatabasePool } from "./pool";

export interface RuntimeConfiguration {
  /** Digest only. Never included in snapshots, errors or logs. */
  identity: string;
  scope: string;
  createPool(): DatabasePool;
}
export interface RuntimeEntry {
  pool: DatabasePool;
  // pg.query is overloaded; preserve its arguments and callback return value.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (...args: any[]) => any;
}
export interface RuntimeDependencies {
  readConfiguration(): RuntimeConfiguration;
  installGuard(entry: RuntimeEntry, owner: DatabaseRuntimeOwner): void;
  rebuilt(): void;
  rebuildFailed(error: unknown): void;
}

const SLOT = Symbol.for("rivalhub.database-runtime.v1");
interface Slot { version: 1; owner: DatabaseRuntimeOwner | null }

/** One bounded slot per Node process, shared by distinct API/RSC module graphs.
 * Methods close over the creating graph; consumers never use instanceof. */
export class DatabaseRuntimeOwner {
  generation = 1;
  disposed = false;
  private current: RuntimeEntry;
  private rebuilding: Promise<void> | null = null;
  private rebuildingFrom: Pool | null = null;
  private retiring: DatabasePool | null = null;
  private bindings = 0;

  constructor(public identity: string, configuration: RuntimeConfiguration,
    private readonly dependencies: RuntimeDependencies, private readonly slot: Slot) {
    this.current = this.createEntry(configuration);
    this.scope = configuration.scope;
  }
  private readonly scope: string;

  private createEntry(configuration: RuntimeConfiguration): RuntimeEntry {
    const pool = configuration.createPool();
    const entry = { pool, query: pool.query.bind(pool) };
    this.dependencies.installGuard(entry, this);
    return entry;
  }

  get pool(): Pool { return this.current.pool; }
  get entry(): RuntimeEntry { return this.current; }
  isCurrent(pool: Pool): boolean { return !this.disposed && pool === this.current.pool; }

  snapshot() {
    if (this.disposed) return null;
    const pool = this.current.pool;
    return { generation: this.generation, total: pool.totalCount, idle: pool.idleCount,
      waiting: pool.waitingCount, max: pool.options.max ?? null,
      rebuilding: this.rebuilding !== null,
      retiring: { total: this.retiring?.totalCount ?? 0, idle: this.retiring?.idleCount ?? 0, waiting: this.retiring?.waitingCount ?? 0 },
      client: pool.getClientSnapshot(), acquire: pool.getAcquireSnapshot() };
  }

  retain(): () => Promise<void> {
    this.bindings++;
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      if (--this.bindings === 0) await this.dispose();
    };
  }

  /** A retired pool cannot replace or end a later generation. Only an explicitly
   * pre-connect failure may use the new entry to retry; this method replays nothing. */
  rebuild(expected: Pool): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.rebuilding) {
      if (expected === this.rebuildingFrom || !this.isCurrent(expected)) return this.rebuilding;
      // A failure from the published replacement is independent of a late
      // error from the draining pool; recover it after the current drain.
      return this.rebuilding.then(() => this.rebuild(expected));
    }
    if (!this.isCurrent(expected)) return Promise.resolve();
    const old = this.current;
    const rebuilding = Promise.resolve().then(async () => {
      if (!this.isCurrent(expected)) return;
      const configuration = this.dependencies.readConfiguration();
      if (configuration.scope !== this.scope) throw new Error("[db] Database runtime scope changed; restart required.");
      const next = this.createEntry(configuration);
      this.retiring = old.pool;
      this.current = next;
      this.identity = configuration.identity;
      this.generation++;
      // Publish the guarded replacement before draining the old generation.
      // Existing checked-out transactions finish on their original clients.
      await old.pool.end().catch(() => {});
      if (this.retiring === old.pool) this.retiring = null;
      this.dependencies.rebuilt();
    }).catch((error: unknown) => {
      this.dependencies.rebuildFailed(error);
      throw error;
    }).finally(() => {
      if (this.rebuilding === rebuilding) { this.rebuilding = null; this.rebuildingFrom = null; }
    });
    this.rebuilding = rebuilding;
    this.rebuildingFrom = expected;
    return rebuilding;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    if (this.slot.owner === this) this.slot.owner = null;
    await Promise.all([this.current.pool.end().catch(() => {}), this.rebuilding?.catch(() => {})]);
  }
}

/** An isolated host object gives tests their own lifecycle. Production passes
 * process, whose identity is common to Next's API and RSC module graphs. */
export function databaseRuntimeSlot(host: object = process) {
  const storage = host as Record<symbol, Slot | undefined>;
  const slot = storage[SLOT] ??= { version: 1, owner: null };
  if (slot.version !== 1) throw new Error("[db] Incompatible database runtime; restart required.");
  return {
    acquire(configuration: RuntimeConfiguration, dependencies: RuntimeDependencies) {
      const current = slot.owner;
      if (current && !current.disposed) {
        if (current.identity !== configuration.identity) {
          throw new Error("[db] Database runtime configuration changed; dispose or restart before reuse.");
        }
        return current;
      }
      const owner = new DatabaseRuntimeOwner(configuration.identity, configuration, dependencies, slot);
      slot.owner = owner;
      return owner;
    },
    snapshot: () => slot.owner?.snapshot() ?? null,
  };
}
