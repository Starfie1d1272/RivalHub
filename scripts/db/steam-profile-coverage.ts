import { Pool, type PoolClient } from "pg";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalDatabaseUrl } from "./local-environment";

const PROTECTED_READ_ONLY_TARGET = "production";

export interface SteamProfileCoverageReport {
  mode: "read-only";
  activePrimaryUsers: number;
  cachedProfiles: number;
  missingProfiles: number;
  legacyShadowMismatches: number;
  coveragePercent: number;
  ready: boolean;
}

export async function inspectSteamProfileCoverage(
  client: Pick<PoolClient, "query">,
): Promise<SteamProfileCoverageReport> {
  const result = await client.query<{
    active_primary_users: string;
    cached_profiles: string;
    missing_profiles: string;
    legacy_shadow_mismatches: string;
  }>(`
    SELECT
      count(users.id)::text AS active_primary_users,
      count(steam_profiles.steam64)::text AS cached_profiles,
      count(*) FILTER (WHERE steam_profiles.steam64 IS NULL)::text AS missing_profiles,
      count(*) FILTER (
        WHERE steam_profiles.steam64 IS NOT NULL
          AND (
            users.steam_name IS DISTINCT FROM steam_profiles.persona_name
            OR users.steam_profile_url IS DISTINCT FROM steam_profiles.profile_url
            OR users.avatar_url IS DISTINCT FROM steam_profiles.avatar_url
          )
      )::text AS legacy_shadow_mismatches
    FROM users
    LEFT JOIN steam_profiles ON steam_profiles.steam64 = users.steam64
    WHERE users.status = 'active' AND users.steam64 IS NOT NULL
  `);
  const row = result.rows[0];
  const activePrimaryUsers = Number(row?.active_primary_users ?? 0);
  const cachedProfiles = Number(row?.cached_profiles ?? 0);
  const missingProfiles = Number(row?.missing_profiles ?? 0);
  const legacyShadowMismatches = Number(row?.legacy_shadow_mismatches ?? 0);

  return {
    mode: "read-only",
    activePrimaryUsers,
    cachedProfiles,
    missingProfiles,
    legacyShadowMismatches,
    coveragePercent: activePrimaryUsers === 0 ? 100 : (cachedProfiles / activePrimaryUsers) * 100,
    ready: missingProfiles === 0 && legacyShadowMismatches === 0,
  };
}

export function assertSteamProfileCoverage(report: SteamProfileCoverageReport): void {
  if (report.ready) return;
  throw new Error(
    `Steam profile coverage 未通过：missing=${report.missingProfiles}, legacy shadow mismatches=${report.legacyShadowMismatches}。旧 Production 保持不变。`,
  );
}

function databaseTarget(env: NodeJS.ProcessEnv = process.env): { target: string; databaseUrl: string } {
  const target = env.RIVALHUB_DB_TARGET;
  if (target === "local") {
    return { target, databaseUrl: assertLocalDatabaseUrl(env.DATABASE_URL) };
  }
  if (target === PROTECTED_READ_ONLY_TARGET && env.RIVALHUB_PROTECTED_READ_ONLY_TARGET === target) {
    const databaseUrl = env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error("DATABASE_URL 未设置；拒绝执行 production Steam profile coverage verify。");
    return { target, databaseUrl };
  }
  throw new Error("Steam profile coverage 只接受 local，或由 protected production read-only wrapper 调用。");
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
      throw new Error("PostgreSQL 未确认 read-only transaction，拒绝执行 Steam profile coverage verify。");
    }
    const report = await inspectSteamProfileCoverage(client);
    assertSteamProfileCoverage(report);
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

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
