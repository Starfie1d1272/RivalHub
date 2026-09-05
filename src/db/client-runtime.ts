import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
// This module is reserved for Node application/CLI entrypoints; the relative
// imports intentionally bypass the Next server-only facade.
import { captureException, logEvent } from "../lib/observability/logger";
import { traceOperation } from "../lib/observability/tracing";

function createPool(): Pool {
  const connectionString = requireDatabaseUrl();
  const url = new URL(connectionString);
  const ssl = shouldUseSsl(connectionString);
  logEvent({
    level: "info",
    event: "db.pool.created",
    scope: "database",
    operation: "pool.create",
    safeContext: { host: url.hostname, ssl },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pgConfig: any = {
    connectionString,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    // Transaction Pooler (port 6543) 共享连接池，适合 serverless
    // 回退 Session Pooler (port 5432) 时删除 prepare: false 并调回 max: 1
    prepare: false,
    max: process.env.NODE_ENV === "production" ? 3 : 10,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 10000,
  };

  return new Pool(pgConfig);
}

let pool: Pool | null = null;
let _db: DB | null = null;

// Proxy 确保 Pool 重建后 db 始终指向新 drizzle 实例
export const db = new Proxy({} as DB, {
  get(_target, prop) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (getDatabase() as any)[prop];
  },
});

export type DB = NodePgDatabase<typeof schema>;
export type TxDb = Parameters<Parameters<DB["transaction"]>[0]>[0];

// Vercel 冷启动 env 延迟保护：连接级错误时重读 DATABASE_URL 并重建 Pool，重试查询
let rebuilding: Promise<void> | null = null;

async function rebuildPool(): Promise<void> {
  // 合并并发重建请求
  if (rebuilding) return rebuilding;
  rebuilding = (async () => {
    await pool?.end().catch(() => {});
    pool = createPool();
    _db = drizzle(pool, { schema });
    setupPoolGuard(pool);
    logEvent({ level: "warn", event: "db.pool.rebuilt", scope: "database", operation: "pool.rebuild" });
  })().finally(() => {
    rebuilding = null;
  });
  return rebuilding;
}

function setupPoolGuard(p: Pool) {
  p.on("error", (err: NodeJS.ErrnoException) => {
    const connectionError = isConnectionError(err);
    captureException("db.pool.error", err, {
      scope: "database",
      operation: "pool.error",
      errorClass: "database",
      retryable: connectionError,
      safeContext: { phase: "guard" },
    });
    if (connectionError) {
      void rebuildPool().catch((rebuildError: unknown) => {
        captureException("db.pool.rebuild_failure", rebuildError, {
          scope: "database",
          operation: "pool.rebuild",
          errorClass: "database",
          retryable: true,
        });
      });
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _orig = (p as any).query.bind(p);
  // 将原始 query 挂到 pool 上，rebuildPool 后 retry 可通过 pool.__orig 拿到新 Pool 的原始 query
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (p as any).__orig = _orig;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (p as any).query = async function (...args: any[]) {
    const queryOperation = getQueryOperation(args);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // attempt 0：用当前 pool 的原始 query
        // attempt 1（rebuild 后）：pool 已指向新 Pool，用新 Pool 的原始 query
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const queryFn = attempt === 0 ? _orig : ((pool as any).__orig ?? _orig);
        return await traceOperation("db.query", {
          scope: "database",
          operation: "query",
          attributes: {
            "db.system": "postgresql",
            "db.operation": queryOperation,
            "rivalhub.attempt": attempt,
          },
        }, () => queryFn(...args));
      } catch (err: unknown) {
        if (attempt === 0 && isConnectionError(err)) {
          logEvent({
            level: "warn",
            event: "db.query.retry",
            scope: "database",
            operation: "query",
            errorClass: "database",
            retryable: true,
            safeContext: { attempt, queryOperation },
          });
          await rebuildPool();
          continue;
        }
        captureException("db.query.failure", err, {
          scope: "database",
          operation: "query",
          errorClass: "database",
          retryable: isConnectionError(err),
          safeContext: { attempt, queryOperation },
        });
        throw err;
      }
    }
  };
}

function getDatabase(): DB {
  if (_db) return _db;
  pool = createPool();
  _db = drizzle(pool, { schema });
  setupPoolGuard(pool);
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
  return value;
}

function shouldUseSsl(databaseUrl?: string): boolean {
  if (!databaseUrl) return false;

  try {
    const url = new URL(databaseUrl);
    if (url.searchParams.get("sslmode") === "disable") return false;
    return !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    logEvent({
      level: "warn",
      event: "db.connection_string.invalid",
      scope: "database",
      operation: "connection.configure",
      errorClass: "database",
      safeContext: { phase: "ssl_detection" },
    });
    return true;
  }
}

function isConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "ECONNREFUSED" || candidate.code === "ENOTFOUND" ||
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
