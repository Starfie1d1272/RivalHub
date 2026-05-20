import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error("[db] DATABASE_URL 为空，pg 将回退到 localhost:5432");
  } else {
    try {
      const url = new URL(connectionString);
      console.error("[db] 连接目标:", url.hostname, "SSL:", shouldUseSsl(connectionString) ? "on" : "off");
    } catch {
      console.error("[db] DATABASE_URL 格式异常，pg 可能解析失败:", String(connectionString).slice(0, 80));
    }
  }

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

let pool = createPool();
let _db = drizzle(pool, { schema });

// Proxy 确保 Pool 重建后 db 始终指向新 drizzle 实例
export const db = new Proxy({} as DB, {
  get(_target, prop) {
    return (_db as Record<string | symbol, unknown>)[prop];
  },
});

export type DB = typeof db;
export type TxDb = Parameters<Parameters<DB["transaction"]>[0]>[0];

// Vercel 冷启动 env 延迟保护：连接级错误时重读 DATABASE_URL 并重建 Pool
function rebuildPool() {
  pool.end().catch(() => {});
  pool = createPool();
  _db = drizzle(pool, { schema });
  setupPoolGuard(pool);
  console.error("[db] Pool 已重建");
}

function setupPoolGuard(p: Pool) {
  p.on("error", (err) => {
    console.error("[db] pool error:", err.message);
    if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
      rebuildPool();
    }
  });

  const _orig = p.query.bind(p);
  p.query = async function (...args: Parameters<typeof p.query>) {
    try {
      return await _orig(...args);
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ECONNREFUSED" || e.code === "ENOTFOUND" || e.message?.includes("Connection terminated")) {
        rebuildPool();
      }
      throw err;
    }
  };
}

setupPoolGuard(pool);

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
