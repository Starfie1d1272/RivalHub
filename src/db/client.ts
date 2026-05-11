import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import dns from "dns/promises";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

// Pre-resolve Supabase hostname to IPv4 to work around Vercel DNS issues.
async function resolveHostname(url: string): Promise<string> {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    if (["localhost", "127.0.0.1", "::1"].includes(hostname)) return url;

    let ip: string;
    try {
      ip = (await dns.resolve4(hostname))[0];
    } catch {
      const resolver = new dns.Resolver();
      resolver.setServers(["8.8.8.8", "1.1.1.1"]);
      ip = (await resolver.resolve4(hostname))[0];
    }
    parsed.hostname = ip;
    return parsed.toString();
  } catch {
    console.error("[db] failed to resolve hostname, using original URL");
    return url;
  }
}

const resolvedUrl = connectionString ? await resolveHostname(connectionString) : connectionString;

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
