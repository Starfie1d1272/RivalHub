import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

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

export const db = drizzle(pool, { schema });

export type DB = typeof db;
export type TxDb = Parameters<Parameters<DB["transaction"]>[0]>[0];

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
