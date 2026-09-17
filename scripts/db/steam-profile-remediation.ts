import { Pool, type PoolClient } from "pg";
import { assertLocalDatabaseUrl } from "./local-environment";

const PROTECTED_READ_ONLY_TARGET = "production";

export interface DuplicateSteam64Value {
  steam64: string;
  activeUserIds: string[];
  activeUserCount: number;
}

export interface InvalidSteam64Value {
  userId: string;
  steam64: string;
}

export interface SteamProfileRemediationReport {
  mode: "read-only";
  activeUsers: number;
  duplicateSteam64Values: DuplicateSteam64Value[];
  invalidSteam64Values: InvalidSteam64Value[];
  migrationReady: boolean;
}

export async function inspectSteam64Remediation(
  client: Pick<PoolClient, "query">,
): Promise<SteamProfileRemediationReport> {
  const [activeUsers, duplicates, invalid] = await Promise.all([
    client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM users WHERE status = 'active'",
    ),
    client.query<{ steam64: string; active_user_ids: string[]; active_user_count: string }>(
      `SELECT steam64,
              array_agg(id::text ORDER BY id) AS active_user_ids,
              count(*)::text AS active_user_count
         FROM users
        WHERE status = 'active' AND steam64 IS NOT NULL
        GROUP BY steam64
       HAVING count(*) > 1
        ORDER BY steam64`,
    ),
    client.query<{ user_id: string; steam64: string }>(
      `SELECT id::text AS user_id, steam64
         FROM users
        WHERE status = 'active'
          AND steam64 IS NOT NULL
          AND steam64 !~ '^[0-9]{17}$'
        ORDER BY id`,
    ),
  ]);

  return {
    mode: "read-only",
    activeUsers: Number(activeUsers.rows[0]?.count ?? 0),
    duplicateSteam64Values: duplicates.rows.map((row) => ({
      steam64: row.steam64,
      activeUserIds: row.active_user_ids,
      activeUserCount: Number(row.active_user_count),
    })),
    invalidSteam64Values: invalid.rows.map((row) => ({
      userId: row.user_id,
      steam64: row.steam64,
    })),
    migrationReady: duplicates.rows.length === 0 && invalid.rows.length === 0,
  };
}

function databaseTarget(env: NodeJS.ProcessEnv = process.env): { target: string; databaseUrl: string } {
  const target = env.RIVALHUB_DB_TARGET;
  if (target === "local") {
    return { target, databaseUrl: assertLocalDatabaseUrl(env.DATABASE_URL) };
  }
  if (target === PROTECTED_READ_ONLY_TARGET && env.RIVALHUB_PROTECTED_READ_ONLY_TARGET === target) {
    const databaseUrl = env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error("DATABASE_URL 未设置；拒绝执行 production read-only remediation。");
    return { target, databaseUrl };
  }
  throw new Error("Steam64 remediation 只接受 local，或由 protected production read-only wrapper 调用。");
}

async function main(): Promise<void> {
  const { target, databaseUrl } = databaseTarget();
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: target === PROTECTED_READ_ONLY_TARGET ? { rejectUnauthorized: false } : false,
    max: 1,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const state = await client.query<{ transaction_read_only: string }>("SHOW transaction_read_only");
    if (state.rows[0]?.transaction_read_only !== "on") {
      throw new Error("PostgreSQL 未确认 read-only transaction，拒绝执行 Steam64 remediation。");
    }
    const report = await inspectSteam64Remediation(client);
    await client.query("ROLLBACK");
    console.log(JSON.stringify({ target, ...report }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
