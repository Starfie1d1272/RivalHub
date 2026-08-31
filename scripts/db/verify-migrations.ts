import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { assertLocalDatabaseUrl } from "./local-environment";
import { assertStagingDatabaseUrl } from "./staging-environment";
import { isLegacyStandardMajorWithoutAffiliation } from "../../src/lib/competition/definition";
import type { SeasonCapabilities } from "../../src/types/season";

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
    ssl: target === "staging" ? { rejectUnauthorized: false } : false,
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
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error("Drizzle migration ledger 与 active migration chain 不完全一致。");
    }

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

    console.log(`Migration verification passed for ${target}: ${expected.length} active migrations; no legacy standard Major affiliation backfill is required.`);
  } finally {
    await pool.end();
  }
}

function databaseUrlFor(target: string | undefined, value: string | undefined): string {
  if (target === "local") return assertLocalDatabaseUrl(value);
  if (target === "staging") return assertStagingDatabaseUrl(value);
  throw new Error("Migration verification 目标必须由受保护命令声明为 local 或 staging。");
}

function readExpectedMigrations(): Array<{ hash: string; when: number }> {
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
