import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

/**
 * Rewrite Supabase direct-connection hostnames to their known IPs.
 * Some Supabase project hostnames fail DNS on Vercel's US East infra
 * but the underlying IPs are reachable. This is a sync bypass — no
 * async DNS calls needed.
 */
function rewriteSupabaseHost(dbUrl: string): string {
  try {
    const parsed = new URL(dbUrl);
    const hostname = parsed.hostname;

    // Known mappings: Supabase project ref → IPv4
    const SUPABASE_IPS: Record<string, string> = {
      "db.feontmsggbbligghjrhl.supabase.co": "198.18.8.125",
    };

    const ip = SUPABASE_IPS[hostname];
    if (ip) {
      parsed.hostname = ip;
      return parsed.toString();
    }
    return dbUrl;
  } catch {
    return dbUrl;
  }
}

const finalUrl = connectionString ? rewriteSupabaseHost(connectionString) : connectionString;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pgConfig: any = {
  connectionString: finalUrl,
  ssl: shouldUseSsl(finalUrl) ? { rejectUnauthorized: false } : undefined,
  family: 4,
  max: 10,
  idleTimeoutMillis: 30000,
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
