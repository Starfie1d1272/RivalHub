import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { assertLocalDatabaseUrl } from "./local-environment";
import { assertStagingDatabaseUrl } from "./staging-environment";
import { assertProductionConfirmations, assertProductionDatabaseUrl } from "./production-environment";
import { isLegacyStandardMajorWithoutAffiliation } from "../../src/lib/competition/definition";
import type { SeasonCapabilities } from "../../src/types/season";
import { verifyDatabaseAccessMatrix } from "./access-matrix";

interface MigrationJournalEntry {
  tag: string;
  when: number;
}

async function main(): Promise<void> {
  const target = process.env.RIVALHUB_DB_TARGET;
  const databaseUrl = databaseUrlFor(target, process.env.DATABASE_URL);
  const expected = readExpectedMigrations();
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: target === "staging" || target === "production" ? { rejectUnauthorized: false } : false,
    max: 1,
  });

  try {
    const result = await pool.query<{
      seasons_table: string | null;
      teams_table: string | null;
      ledger: Array<{ hash: string; created_at: string }>;
      seasons: Array<{
        id: string;
        slug: string;
        registration_mode: SeasonCapabilities["registrationMode"];
        has_captain_voting: boolean;
        has_draft: boolean;
        stage_plan: SeasonCapabilities["stagePlan"];
        registration_config: SeasonCapabilities["registrationConfig"];
        team_registration_config: SeasonCapabilities["teamRegistrationConfig"];
        affiliation_rules: SeasonCapabilities["affiliationRules"];
        min_team_size: number;
        max_team_size: number;
        starter_count: number;
        positions: string[];
      }>;
    }>(`
      SELECT
        to_regclass('public.seasons')::text AS seasons_table,
        to_regclass('public.teams')::text AS teams_table,
        COALESCE(
          (SELECT json_agg(row_to_json(m) ORDER BY m.created_at)
           FROM (SELECT hash, created_at FROM drizzle.__drizzle_migrations) AS m),
          '[]'::json
        ) AS ledger,
        COALESCE(
          (SELECT json_agg(row_to_json(s))
           FROM (
             SELECT id, slug, registration_mode, has_captain_voting, has_draft,
               stage_plan, registration_config, team_registration_config,
               affiliation_rules, min_team_size, max_team_size, starter_count, positions
             FROM public.seasons
           ) AS s),
          '[]'::json
        ) AS seasons
    `);
    const facts = result.rows[0];
    if (!facts?.seasons_table || !facts.teams_table) {
      throw new Error("Drizzle baseline 关键业务表缺失。");
    }

    const actual = facts.ledger.map((entry) => ({
      hash: entry.hash,
      when: Number(entry.created_at),
    }));
    assertCompleteMigrationLedger(actual, expected);

    const legacyStandardRows = facts.seasons.filter((season) =>
      isLegacyStandardMajorWithoutAffiliation({
        registrationMode: season.registration_mode,
        hasCaptainVoting: season.has_captain_voting,
        hasDraft: season.has_draft,
        stagePlan: season.stage_plan,
        registrationConfig: season.registration_config,
        teamRegistrationConfig: season.team_registration_config,
        affiliationRules: season.affiliation_rules,
        minTeamSize: season.min_team_size,
        maxTeamSize: season.max_team_size,
        starterCount: season.starter_count,
        positions: season.positions,
      }),
    );
    if (legacyStandardRows.length > 0) {
      throw new Error(`发现 ${legacyStandardRows.length} 个 pre-0008 标准 Major 能力行缺少 affiliation_rules；拒绝猜测回填：${legacyStandardRows.map((row) => row.slug).join(", ")}`);
    }

    const terminalSchema = await pool.query<{
      evidence_code: boolean;
      evidence_url: boolean;
      perfect_id: boolean;
      roles: string[];
    }>(`
      SELECT
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'education_verifications' AND column_name = 'evidence_code') AS evidence_code,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'education_verifications' AND column_name = 'evidence_url') AS evidence_url,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'perfect_id') AS perfect_id,
        COALESCE((SELECT json_agg(enumlabel ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid = 'public.cs2_role'::regtype), '[]'::json) AS roles
    `);
    assertCurrentTerminalSchema(terminalSchema.rows[0]);
    await verifyDatabaseAccessMatrix(pool, `Migration verification (${target})`);

    console.log(`Migration verification passed for ${target}: ${expected.length} active migrations; active terminal schema contract is present.`);
  } finally {
    await pool.end();
  }
}

function databaseUrlFor(target: string | undefined, value: string | undefined): string {
  if (target === "local") return assertLocalDatabaseUrl(value);
  if (target === "staging") return assertStagingDatabaseUrl(value);
  if (target === "production") {
    assertProductionConfirmations(process.env);
    return assertProductionDatabaseUrl(value);
  }
  throw new Error("Migration verification 目标必须由受保护命令声明为 local、staging 或 production。");
}

export function readExpectedMigrations(): Array<{ hash: string; when: number }> {
  const migrationsDirectory = resolve(process.cwd(), "drizzle/migrations");
  const journal = JSON.parse(
    readFileSync(resolve(migrationsDirectory, "meta/_journal.json"), "utf8"),
  ) as { entries: MigrationJournalEntry[] };

  return journal.entries.map((entry) => ({
    hash: createHash("sha256")
      .update(readFileSync(resolve(migrationsDirectory, `${entry.tag}.sql`), "utf8"))
      .digest("hex"),
    when: entry.when,
  }));
}

export function assertCompleteMigrationLedger(
  actual: readonly { hash: string; when: number }[],
  expected: readonly { hash: string; when: number }[],
): void {
  if (actual.length < expected.length) {
    throw new Error("Drizzle migration ledger 落后于 active migration chain；存在 pending migration。");
  }
  if (actual.length > expected.length) {
    throw new Error("Drizzle migration ledger 包含 unexpected migration；拒绝继续。");
  }
  if (actual.some((entry, index) => entry.hash !== expected[index]?.hash || entry.when !== expected[index]?.when)) {
    throw new Error("Drizzle migration ledger hash divergence；拒绝继续。");
  }
}

export function assertCurrentTerminalSchema(facts: {
  evidence_code: boolean;
  evidence_url: boolean;
  perfect_id: boolean;
  roles: readonly string[];
} | undefined): void {
  const canonicalRoles = ["igl", "awper", "opener", "closer", "anchor"];
  if (!facts?.evidence_code || facts.evidence_url || facts.perfect_id || JSON.stringify(facts.roles) !== JSON.stringify(canonicalRoles)) {
    throw new Error("Active terminal schema contract 不完整：需要 evidence_code、无 evidence_url/perfect_id，且 cs2_role 为 canonical 集合。");
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
