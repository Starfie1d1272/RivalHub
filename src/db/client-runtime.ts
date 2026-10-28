import { createHash } from "node:crypto";
import { postgresConnection } from "./postgres-connection";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DatabasePool } from "./pool";
import { databaseRuntimeSlot, type DatabaseRuntimeOwner, type RuntimeEntry, type RuntimeConfiguration } from "./runtime-owner";
import * as schema from "./schema";
// This module is reserved for Node application/CLI entrypoints; the relative
// imports intentionally bypass the Next server-only facade.
import { captureException, logEvent } from "../lib/observability/logger";
import { assertPreviewDatabaseUrl } from "../lib/runtime/preview";

let configurationCache: { source: string; value: RuntimeConfiguration } | null = null;
function readConfiguration(): RuntimeConfiguration {
  const source = JSON.stringify([process.env.DATABASE_URL, process.env.NODE_ENV, process.env.VERCEL,
    process.env.NEXT_RUNTIME, process.env.VERCEL_ENV, process.env.RIVALHUB_RELEASE_COMMIT]);
  if (configurationCache?.source === source) return configurationCache.value;
  const connectionString = requireDatabaseUrl();
  const url = new URL(connectionString);
  const connection = postgresConnection(connectionString);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pgConfig: any = {
    ...connection,
    // Persistent hosts serve concurrent pages, transactions and LIVE in one pool.
    max: process.env.NODE_ENV === "production" && process.env.VERCEL === "1" ? 3 : 10,
    // Retain two established application connections across quiet page visits.
    // CLI and serverless pools retain their existing shutdown behavior.
    min: process.env.NODE_ENV === "production" && process.env.NEXT_RUNTIME === "nodejs" && process.env.VERCEL !== "1" ? 2 : 0,
    // Persistent Node hosts reuse TLS connections between page visits.
    idleTimeoutMillis: process.env.NEXT_RUNTIME === "nodejs" && process.env.VERCEL !== "1" ? 30000 : 5000,
    connectionTimeoutMillis: 10000,
  };

  const scopeUrl = new URL(connection.connectionString);
  scopeUrl.password = "";
  scopeUrl.searchParams.delete("password");
  const version = { protocol: 1, environment: process.env.NODE_ENV, deployment: process.env.VERCEL_ENV,
    release: process.env.RIVALHUB_RELEASE_COMMIT || "unknown" };
  const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const value: RuntimeConfiguration = {
    identity: digest({ ...pgConfig, version }),
    scope: digest({ ...pgConfig, connectionString: scopeUrl.href, version }),
    createPool() {
      logEvent({ level: "info", event: "db.pool.created", scope: "database", operation: "pool.create",
        safeContext: { host: url.hostname, ssl: connection.ssl !== false } });
      return new DatabasePool(pgConfig);
    },
  };
  configurationCache = { source, value };
  return value;
}

const runtime = databaseRuntimeSlot();
let binding: { owner: DatabaseRuntimeOwner; release(): Promise<void> } | null = null;
let databaseGeneration = 0;
let _db: DB | null = null;

/** Counters come from the creating owner, including across API/RSC graphs. */
export function getDatabasePoolSnapshot() {
  return runtime.snapshot();
}

/** HMR/tests release this module binding; the final binding closes its owner. */
export async function disposeDatabaseBinding(): Promise<void> {
  const previous = binding;
  binding = null; _db = null; databaseGeneration = 0; configurationCache = null;
  await previous?.release();
}

if (process.env.NODE_ENV === "development" && typeof module !== "undefined") {
  const hot = (module as NodeModule & { hot?: { dispose(callback: () => void): void } }).hot;
  hot?.dispose(() => { void disposeDatabaseBinding(); });
}

// Proxy 确保 Pool 重建后 db 始终指向新 drizzle 实例
export const db = new Proxy({} as DB, {
  get(_target, prop) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (getDatabase() as any)[prop];
  },
});

export type DB = NodePgDatabase<typeof schema>;
export type TxDb = Parameters<Parameters<DB["transaction"]>[0]>[0];

// Configuration is validated before joining the one process owner. The owner
// re-reads it on recovery; only same-scope credential rotation can be retried.
function getRuntimeOwner(): DatabaseRuntimeOwner {
  const owner = runtime.acquire(readConfiguration(), {
    readConfiguration, installGuard: setupPoolGuard,
    rebuilt: () => logEvent({ level: "warn", event: "db.pool.rebuilt", scope: "database", operation: "pool.rebuild" }),
    rebuildFailed: (error) => captureException("db.pool.rebuild_failure", error, {
      scope: "database", operation: "pool.rebuild", errorClass: "database", retryable: true,
    }),
  });
  if (binding?.owner !== owner) {
    const previous = binding;
    binding = { owner, release: owner.retain() };
    _db = null; databaseGeneration = 0;
    void previous?.release();
  }
  return owner;
}

function setupPoolGuard(entry: RuntimeEntry, owner: DatabaseRuntimeOwner) {
  const p = entry.pool;
  p.on("error", (err: NodeJS.ErrnoException) => {
    if (!owner.isCurrent(p)) return;
    const connectionError = isConnectionError(err);
    captureException("db.pool.error", err, {
      scope: "database",
      operation: "pool.error",
      errorClass: "database",
      retryable: connectionError,
      safeContext: { phase: "guard" },
    });
    if (connectionError) {
      // The shared rebuild owner records failure once, including query retries.
      void owner.rebuild(p).catch(() => {});
    }
  });

  const original = entry.query;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p.query = function (...args: any[]) {
    // Preserve pg's callback channel and return value. Callback statements are
    // never replayed; statement counters remain owned by DatabasePool.
    if (typeof args.at(-1) === "function") return original(...args);
    return guardedQuery(args);
  } as typeof p.query;

  async function guardedQuery(args: unknown[]) {
    const queryOperation = getQueryOperation(args);
    for (let attempt = 0; attempt < 2; attempt++) {
      // Capture the actual execution entry for this attempt. A concurrent
      // recovery may replace owner.entry before this query rejects.
      const active = attempt === 0 ? entry : owner.entry;
      try {
        const queryFn = active.query;
        return await queryFn(...args);
      } catch (err: unknown) {
        if (attempt === 0 && isPreConnectionError(err) && !owner.disposed) {
          logEvent({
            level: "warn",
            event: "db.query.retry",
            scope: "database",
            operation: "query",
            errorClass: "database",
            retryable: true,
            safeContext: { attempt, queryOperation },
          });
          await owner.rebuild(active.pool);
          continue;
        }
        const outcomeUnknown = isConnectionError(err) && !isPreConnectionError(err);
        captureException(outcomeUnknown ? "db.query.outcome_unknown" : "db.query.failure", err, {
          scope: "database",
          operation: "query",
          errorClass: "database",
          retryable: isPreConnectionError(err),
          safeContext: { attempt, queryOperation },
        });
        // Recover future requests, never replay a statement whose commit is unknown.
        if (outcomeUnknown) void owner.rebuild(active.pool).catch(() => {});
        throw err;
      }
    }
  }
}

function getDatabase(): DB {
  const owner = getRuntimeOwner();
  if (!_db || databaseGeneration !== owner.generation) {
    _db = drizzle(owner.pool, { schema });
    databaseGeneration = owner.generation;
  }
  return _db;
}

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new Error("[db] DATABASE_URL 未设置；拒绝使用 pg 默认连接参数。");
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new Error("[db] DATABASE_URL 格式无效。");
  }
  assertPreviewDatabaseUrl(value);
  return value;
}

function isPreConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "ECONNREFUSED" || code === "ENOTFOUND";
}

function isConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return isPreConnectionError(error) || candidate.code === "ECONNRESET" ||
    candidate.code === "EPIPE" || candidate.code === "ETIMEDOUT" ||
    (typeof candidate.message === "string" && candidate.message.includes("Connection terminated"));
}

function getQueryOperation(args: unknown[]): string {
  const first = args[0];
  const text = typeof first === "string"
    ? first
    : first && typeof first === "object" && "text" in first && typeof first.text === "string"
      ? first.text
      : "unknown";
  const operation = text.trim().split(/\s+/, 1)[0]?.toLowerCase();
  return operation && /^[a-z]+$/.test(operation) ? operation : "unknown";
}
