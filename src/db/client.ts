import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Supabase direct connection requires SSL
// Production: use Supabase Transaction Pooler URL for connection pooling
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pgConfig: any = {
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  family: 4, // force IPv4 to avoid DNS resolution issues with Supabase
};
const pool = new Pool(pgConfig);

export const db = drizzle(pool, { schema });

export type DB = typeof db;
