import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

function createPool(): Pool {
  const connectionString = requireDatabaseUrl();
  const url = new URL(connectionString);
  console.log("[db] 连接目标:", url.hostname, "SSL:", shouldUseSsl(connectionString) ? "on" : "off");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pgConfig: any = {
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
    // Transaction Pooler (port 6543) 共享连接池，适合 serverless
    // 回退 Session Pooler (port 5432) 时删除 prepare: false 并调回 max: 1
    prepare: false,
    max: process.env.NODE_ENV === "production" ? 3 : 10,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 10000,
  };

  const pool = new Pool(pgConfig);

  pool.on("error", (err) => {
    console.error("[db] pool error:", err.message);
  });

  return pool;
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
    console.error("[db] Pool 已重建");
    rebuilding = null;
  })();
  return rebuilding;
}

function setupPoolGuard(p: Pool) {
  p.on("error", (err: NodeJS.ErrnoException) => {
    console.error("[db] pool error:", err.message);
    if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
      rebuildPool();
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _orig = (p as any).query.bind(p);
  // 将原始 query 挂到 pool 上，rebuildPool 后 retry 可通过 pool.__orig 拿到新 Pool 的原始 query
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (p as any).__orig = _orig;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (p as any).query = async function (...args: any[]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // attempt 0：用当前 pool 的原始 query
        // attempt 1（rebuild 后）：pool 已指向新 Pool，用新 Pool 的原始 query
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const queryFn = attempt === 0 ? _orig : ((pool as any).__orig ?? _orig);
        return await queryFn(...args);
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException;
        if (
          attempt === 0 &&
          (e.code === "ECONNREFUSED" || e.code === "ENOTFOUND" || e.message?.includes("Connection terminated"))
        ) {
          await rebuildPool();
          continue;
        }
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
    console.error("[db] malformed DATABASE_URL, defaulting to SSL enabled");
    return true;
  }
}
