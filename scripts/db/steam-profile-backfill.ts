import { and, asc, eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/db/schema";
import type { DB } from "../../src/db/client-runtime";
import { assertLocalDatabaseUrl } from "./local-environment";
import { getSteamPlayerSummaries, type SteamProfileSummary } from "../../src/lib/steam";
import { upsertSteamProfile } from "../../src/lib/steam-profiles";

const PROTECTED_WRITE_TARGET = "production";
const PRODUCTION_WRITE_CONFIRMATION = "I_UNDERSTAND_STEAM_PROFILE_CACHE_WRITE";

interface BackfillArguments {
  apply: boolean;
  limit?: number;
}

interface BackfillPlan {
  requested: number;
  resolved: number;
  unresolvedSteam64: string[];
  profilesToWrite: SteamProfileSummary[];
}

function parseArguments(argv: readonly string[]): BackfillArguments {
  let apply = false;
  let limit: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    if (argument === "--limit") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1) throw new Error("--limit 必须是正整数。");
      limit = value;
      continue;
    }
    throw new Error("用法：steam-profile-backfill.ts [--apply] [--limit N]");
  }
  return { apply, limit };
}

function databaseTarget(
  apply: boolean,
  env: NodeJS.ProcessEnv = process.env,
): { target: string; databaseUrl: string } {
  const target = env.RIVALHUB_DB_TARGET;
  if (target === "local") {
    return { target, databaseUrl: assertLocalDatabaseUrl(env.DATABASE_URL) };
  }
  if (target === PROTECTED_WRITE_TARGET && env.RIVALHUB_PROTECTED_WRITE_TARGET === target) {
    const databaseUrl = env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error("DATABASE_URL 未设置；拒绝执行 production Steam profile backfill。");
    if (apply && env.RIVALHUB_STEAM_PROFILE_WRITE_CONFIRM !== PRODUCTION_WRITE_CONFIRMATION) {
      throw new Error(`production backfill 需要显式设置 RIVALHUB_STEAM_PROFILE_WRITE_CONFIRM=${PRODUCTION_WRITE_CONFIRMATION}。`);
    }
    return { target, databaseUrl };
  }
  throw new Error("Steam profile backfill 只接受 local，或由 protected production wrapper 调用。");
}

async function buildPlan(
  database: DB,
  limit?: number,
): Promise<BackfillPlan> {
  const query = database.select({ id: schema.users.id, steam64: schema.users.steam64 })
    .from(schema.users)
    .where(and(eq(schema.users.status, "active"), isNotNull(schema.users.steam64)))
    .orderBy(asc(schema.users.steam64));
  const candidates = limit === undefined ? await query : await query.limit(limit);
  const steam64s = candidates
    .map((candidate) => candidate.steam64)
    .filter((value): value is string => value !== null && /^\d{17}$/.test(value));
  const lookup = await getSteamPlayerSummaries(steam64s);
  if (lookup.status !== "ok") {
    throw new Error(lookup.status === "unconfigured" ? "STEAM_PROFILE_UNCONFIGURED" : "STEAM_PROFILE_PROVIDER_FAILED");
  }

  // Apply every resolved current primary so the N/N+1 rollback shadow is also
  // repaired when the official cache already contains the same values.
  const profilesToWrite = [...lookup.profiles.values()];
  return {
    requested: steam64s.length,
    resolved: lookup.profiles.size,
    unresolvedSteam64: steam64s.filter((steam64) => !lookup.profiles.has(steam64)),
    profilesToWrite,
  };
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const { target, databaseUrl } = databaseTarget(args.apply);
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: target === PROTECTED_WRITE_TARGET ? { rejectUnauthorized: false } : false,
    max: 1,
  });
  try {
    const database = drizzle(pool, { schema });
    const plan = await buildPlan(database, args.limit);
    if (args.apply) {
      for (const profile of plan.profilesToWrite) await upsertSteamProfile(database, profile);
    }
    console.log(JSON.stringify({
      target,
      mode: args.apply ? "apply" : "dry-run",
      requested: plan.requested,
      resolved: plan.resolved,
      unresolvedSteam64: plan.unresolvedSteam64,
      wouldUpdate: plan.profilesToWrite.length,
      updated: args.apply ? plan.profilesToWrite.length : 0,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
