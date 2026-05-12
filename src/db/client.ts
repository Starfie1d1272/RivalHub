import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pgConfig: any = {
  connectionString,
  // Supabase pooler requires SSL; local Docker/Postgres does not
  ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  family: 4,
  // local dev needs headroom for concurrent RSC queries; serverless uses 1
  max: process.env.NODE_ENV === "production" ? 1 : 10,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
};
const pool = new Pool(pgConfig);

pool.on("error", (err) => {
  console.error("[db] pool error:", err.message);
});

export const db = drizzle(pool, { schema });

export type DB = typeof db;

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
