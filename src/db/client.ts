import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

// Supabase direct connection requires SSL; local Docker/Postgres does not.
// Production: use Supabase Transaction Pooler URL for connection pooling.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pgConfig: any = {
  connectionString,
  ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  family: 4, // force IPv4 to avoid DNS resolution issues with Supabase
};
const pool = new Pool(pgConfig);

export const db = drizzle(pool, { schema });

export type DB = typeof db;

function shouldUseSsl(databaseUrl?: string): boolean {
  if (!databaseUrl) return false;

  const url = new URL(databaseUrl);
  if (url.searchParams.get("sslmode") === "disable") return false;
  return !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}
