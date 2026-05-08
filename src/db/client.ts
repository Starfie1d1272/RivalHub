import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Supabase direct connection requires SSL
// Production: use Supabase Transaction Pooler URL for connection pooling
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });

export type DB = typeof db;
