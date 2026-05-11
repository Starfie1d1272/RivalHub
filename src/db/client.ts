import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import dns from "dns/promises";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

async function resolveDbHost(dbUrl: string): Promise<string> {
  try {
    const parsed = new URL(dbUrl);
    const hostname = parsed.hostname;
    if (["localhost", "127.0.0.1", "::1"].includes(hostname)) return dbUrl;

    // Try resolving IPv4; if the A record is missing, replace host with IP
    try {
      await dns.resolve4(hostname);
      return dbUrl; // DNS ok, use original URL
    } catch {
      // DNS failed — use pre-resolved IP instead
      const resolver = new dns.Resolver();
      resolver.setServers(["8.8.8.8", "1.1.1.1"]);
      try {
        await resolver.resolve4(hostname);
        return dbUrl;
      } catch {
        // All DNS failed, fall back to hardcoded IP
        parsed.hostname = "198.18.8.125";
        console.error("[db] DNS failed for %s, using IP fallback", hostname);
        return parsed.toString();
      }
    }
  } catch {
    return dbUrl;
  }
}

const resolvedUrl = connectionString ? await resolveDbHost(connectionString) : connectionString;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pgConfig: any = {
  connectionString: resolvedUrl,
  ssl: shouldUseSsl(resolvedUrl) ? { rejectUnauthorized: false } : undefined,
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
