import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

type Globals = {
  schema: typeof import("../../src/db/schema");
  assertSeasonHasNoHistoricalFacts: typeof import("../../src/lib/seasons/lifecycle")["assertSeasonHasNoHistoricalFacts"];
  freezeCompetitiveContext: typeof import("../../src/lib/seasons/lifecycle")["freezeCompetitiveContext"];
  MAJOR_CONFIG: typeof import("../../src/types/season")["MAJOR_TEAM_CONFIG"];
};
const globals = {} as Globals;

let checkIndex = 0;
function check(condition: boolean, message: string): void {
  checkIndex++;
  if (!condition) throw new Error(`断言失败 (#${checkIndex}): ${message}`);
}

async function expectFailure(work: () => Promise<unknown>, keyword: string): Promise<void> {
  try {
    await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(keyword)) return;
    throw new Error(`预期错误包含「${keyword}」，实际为：${message}`);
  }
  throw new Error(`预期错误包含「${keyword}」，但操作成功。`);
}

const RANK_ORDER = ["D", "C", "B", "A", "S"];

async function main(): Promise<void> {
  // Domain owners lazily connect through @/db/client, which reads DATABASE_URL;
  // env must be set before those imports resolve.
  const databaseUrl = process.env.RIVALHUB_LOCAL_DATABASE_URL;
  if (!databaseUrl) throw new Error("RIVALHUB_LOCAL_DATABASE_URL 未设置。");
  const target = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname)) {
    throw new Error("Season Governance 集成测试只允许 Local Supabase loopback 数据库。");
  }
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? databaseUrl;
  const schemaModule = await import("../../src/db/schema");
  const { assertSeasonHasNoHistoricalFacts, freezeCompetitiveContext } = await import("../../src/lib/seasons/lifecycle");
  const typeSeasons = await import("../../src/types/season");
  globals.schema = schemaModule;
  globals.assertSeasonHasNoHistoricalFacts = assertSeasonHasNoHistoricalFacts;
  globals.freezeCompetitiveContext = freezeCompetitiveContext;
  globals.MAJOR_CONFIG = typeSeasons.MAJOR_TEAM_CONFIG;
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 6 });
  try {
    await exerciseCompetitiveFreezeLifecycle(pool);
    await exerciseEmptySeasonGuards(pool);
    await exerciseQualificationPlatformIsolation(pool);
    console.log("Season Governance local integration passed: competitive freeze lifecycle, empty-season guards, and qualification platform isolation.");
  } finally {
    await pool.end();
  }
}


// ── Qualification platform isolation ────────────────────────────────────────

async function seedFullyReadyUser(pool: Pool, id: string, seq: number): Promise<void> {
  const email = `gov-qual-${id}@local.test`;
  await pool.query("DELETE FROM education_verifications WHERE user_id IN (SELECT id FROM users WHERE email = $1)", [email]);
  await pool.query("DELETE FROM competitive_rank_facts WHERE user_id IN (SELECT id FROM users WHERE email = $1)", [email]);
  await pool.query("DELETE FROM users WHERE email = $1", [email]);
  await pool.query(
    `INSERT INTO users (id, email, display_name, steam64, perfect_id, perfect_name, qq, email_verified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
    [id, email, "Governance 选手", `76561198${id.replaceAll("-", "").slice(0, 12)}`, `gq-${id}`, `Perfect 选手 ${seq}`, `99000${seq}`],
  );
  await pool.query(
    `INSERT INTO education_verifications (user_id, institution_id, academic_status, evidence_type, status)
     SELECT $1, i.id, 'enrolled', 'chsi_enrollment_report', 'approved'
     FROM institutions i WHERE i.moe_institution_code = '4132010284'`,
    [id],
  );
}

async function exerciseQualificationPlatformIsolation(pool: Pool): Promise<void> {
  const { getParticipantReadinessBatch } = await import("../../src/lib/qualification/service");
  const platform = `govqual-${randomUUID()}`;
  const otherPlatform = `govother-${randomUUID()}`;
  const rankOrder = ["D", "C", "B", "A", "S"];

  // Only a foreign-platform user: if the loader ever leaks facts across
  // platforms, this participant would incorrectly pass qualification.
  const foreignOnlyUser = randomUUID();
  const homeUser = randomUUID();
  await seedFullyReadyUser(pool, foreignOnlyUser, 1);
  await seedFullyReadyUser(pool, homeUser, 2);

  await pool.query(
    `INSERT INTO competitive_platform_seasons (id, platform, season_key, label, rank_order, active, sort_order, is_current)
     VALUES ($1, $2, 'S20', 'S20', $4::json, true, 0, false),
            ($3, $2, 'S21', 'S21', $4::json, true, 1, true)`,
    [randomUUID(), platform, randomUUID(), JSON.stringify(rankOrder)],
  );

  const foreignFact = (userId: string, kind: "historical_peak" | "season_peak", seasonKey: string | null, rank: string, rating: string) =>
    pool.query(
      `INSERT INTO competitive_rank_facts (user_id, platform, kind, platform_season_key, rank, rating)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, otherPlatform, kind, seasonKey, rank, rating],
    );

  // Same season keys and rank labels as the Perfect World-style context, but
  // recorded under the foreign platform only.
  await foreignFact(foreignOnlyUser, "historical_peak", null, "S", "2.60");
  await foreignFact(foreignOnlyUser, "season_peak", "S20", "A", "2.10");
  await foreignFact(foreignOnlyUser, "season_peak", "S21", "S", "2.55");
  await pool.query(
    `INSERT INTO competitive_rank_facts (user_id, platform, kind, platform_season_key, rank, rating)
     VALUES ($1, $2, 'historical_peak', NULL, 'S', '2.60'), ($1, $2, 'season_peak', 'S20', 'A', '2.10'), ($1, $2, 'season_peak', 'S21', 'S', '2.55')`,
    [homeUser, platform],
  );

  const readiness = await getParticipantReadinessBatch([foreignOnlyUser, homeUser], {
    platform,
    currentSeasonKey: "S21",
    previousSeasonKey: "S20",
    rankOrder,
  });

  const foreign = readiness.get(foreignOnlyUser)!;
  check(foreign.ready === false, `外部平台资料不得满足 ${platform} 资格；实际 ready=${foreign.ready}`);
  check(foreign.blockers.some((blocker) => blocker.includes("缺少历史最高段位及 Rating")),
    `外部平台资料缺失时应报缺少历史最高；实际 blockers: ${foreign.blockers.join(" ")}`);
  const home = readiness.get(homeUser)!;
  check(home.ready === true, `本平台资料齐全的用户应 ready；实际 blockers: ${home.blockers.join(" ")}`);

  await pool.query("DELETE FROM competitive_rank_facts WHERE user_id = ANY($1::uuid[])", [[foreignOnlyUser, homeUser]]);
  await pool.query("DELETE FROM education_verifications WHERE user_id = ANY($1::uuid[])", [[foreignOnlyUser, homeUser]]);
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[foreignOnlyUser, homeUser]]);
  await pool.query("DELETE FROM competitive_platform_seasons WHERE platform = ANY($1::text[])", [[platform, otherPlatform]]);
}

// ── Competitive freeze lifecycle ────────────────────────────────────────────

async function seedCatalog(pool: Pool, platform: string): Promise<{ s20: string; s21: string; s22: string }> {
  const s20 = randomUUID();
  const s21 = randomUUID();
  const s22 = randomUUID();
  await pool.query(
    `INSERT INTO competitive_platform_seasons (id, platform, season_key, label, rank_order, active, sort_order, is_current)
     VALUES ($1, $2, 'S20', 'S20 赛季', $5::json, true, 0, false),
            ($3, $2, 'S21', 'S21 赛季', $5::json, true, 1, true),
            ($4, $2, 'S22', 'S22 赛季', $5::json, false, 2, false)`,
    [s20, platform, s21, s22, JSON.stringify(RANK_ORDER)],
  );
  return { s20, s21, s22 };
}

async function createMajorDraft(pool: Pool, slug: string, platform: string): Promise<string> {
  const seasonId = randomUUID();
  const config = { ...globals.MAJOR_CONFIG, competitiveProfile: { ...globals.MAJOR_CONFIG.competitiveProfile, platform } };
  await pool.query(
    `INSERT INTO seasons (id, slug, name, kind, competition_template, status, registration_mode, has_captain_voting, has_draft, min_team_size, max_team_size, team_registration_config)
     VALUES ($1, $2, 'Governance Major', 'Major', 'major', 'draft', 'team', false, false, 5, 9, $3::json)`,
    [seasonId, slug, JSON.stringify(config)],
  );
  return seasonId;
}

async function exerciseCompetitiveFreezeLifecycle(pool: Pool): Promise<void> {
  const platform = `pw-${randomUUID()}`;
  const catalog = await seedCatalog(pool, platform);
  const seasonId = await createMajorDraft(pool, `gov-freeze-${randomUUID()}`, platform);

  const db = drizzle(pool, { schema: globals.schema });
  // Publish-time freeze resolves S20/S21 from the catalog.
  let frozen: { competitiveProfile: Record<string, string> } | null = null;
  await db.transaction(async (tx) => {
    const [season] = await tx.select().from(globals.schema.seasons).where(eq(globals.schema.seasons.id, seasonId));
    frozen = await globals.freezeCompetitiveContext(tx, season) as unknown as { competitiveProfile: Record<string, string> };
  });
  const profile = frozen!.competitiveProfile;
  check(profile.currentSeasonKey === "S21" && profile.previousSeasonKey === "S20", "发布冻结应解析 S21/S20");

  // The catalog later advances to S22; the frozen result held by the caller
  // (or a published season row) is never re-resolved.
  await pool.query("UPDATE competitive_platform_seasons SET is_current = false WHERE id = $1", [catalog.s21]);
  await pool.query("UPDATE competitive_platform_seasons SET active = true, is_current = true WHERE id = $1", [catalog.s22]);

  // Persist the first freeze as a published season would have done; the row
  // must remain untouched by the catalog change above.
  await pool.query("UPDATE seasons SET status = 'registration', team_registration_config = $2::json WHERE id = $1",
    [seasonId, JSON.stringify({ ...globals.MAJOR_CONFIG, competitiveProfile: profile })]);
  const published = await pool.query<{ team_registration_config: { competitiveProfile: Record<string, string> } }>(
    "SELECT team_registration_config FROM seasons WHERE id = $1", [seasonId]);
  check(published.rows[0]?.team_registration_config.competitiveProfile.currentSeasonKey === "S21",
    "已发布赛季的冻结上下文不受目录变化影响");

  // A future publish of a NEW draft season re-resolves from the new catalog state.
  const secondDraft = await createMajorDraft(pool, `gov-freeze-2-${randomUUID()}`, platform);
  let refrozen: { competitiveProfile: Record<string, string> } | null = null;
  await db.transaction(async (tx) => {
    const [season] = await tx.select().from(globals.schema.seasons).where(eq(globals.schema.seasons.id, secondDraft));
    refrozen = await globals.freezeCompetitiveContext(tx, season) as unknown as { competitiveProfile: Record<string, string> };
  });
  const newProfile = refrozen!.competitiveProfile;
  check(newProfile.currentSeasonKey === "S22" && newProfile.previousSeasonKey === "S21",
    `目录推进到 S22 后，下一次发布应重新解析 S22/S21；实际：${JSON.stringify(newProfile)}`);

  await pool.query("DELETE FROM seasons WHERE id = $1", [seasonId]);
  await pool.query("DELETE FROM seasons WHERE id = $1", [secondDraft]);
  await pool.query("DELETE FROM competitive_platform_seasons WHERE platform = $1", [platform]);
}

// ── Empty-season delete/revert guards ───────────────────────────────────────

async function seedGovernedSeason(pool: Pool): Promise<string> {
  const seasonId = randomUUID();
  await pool.query(
    `INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft, team_registration_config)
     VALUES ($1, $2, 'Governance Draft', '自定义赛事', 'draft', 'team', false, false, '{}'::json)`,
    [seasonId, `gov-guard-${randomUUID()}`],
  );
  return seasonId;
}

async function seedUser(pool: Pool, id: string): Promise<void> {
  await pool.query("INSERT INTO users (id, email) VALUES ($1, $2)", [id, `gov-${id}@local.test`]);
}

async function exerciseEmptySeasonGuards(pool: Pool): Promise<void> {
  const db = drizzle(pool, { schema: globals.schema });

  // Empty draft: the shared guard passes.
  const emptySeason = await seedGovernedSeason(pool);
  await db.transaction(async (tx) => {
    await globals.assertSeasonHasNoHistoricalFacts(tx, emptySeason);
  });

  // A solo registration blocks the guard.
  const userId = randomUUID();
  await seedUser(pool, userId);
  await pool.query(
    `INSERT INTO season_registrations (id, user_id, season_id, primary_position, secondary_position, peak_rank, peak_rank_season, peak_rating, current_season_peak_rank, current_rating, gameplay_style)
     VALUES ($1, $2, $3, 'opener', 'closer', 'A+', 'S20', 1800, 'A', 1700, '突破手')`,
    [randomUUID(), userId, emptySeason],
  );
  await db.transaction(async (tx) => {
    await expectFailure(() => globals.assertSeasonHasNoHistoricalFacts(tx, emptySeason), "不能删除");
  });
  await db.transaction(async (tx) => {
    await expectFailure(
      () => globals.assertSeasonHasNoHistoricalFacts(tx, emptySeason, "该赛季已经产生报名、队伍或赛程事实，不能撤回至草稿。"),
      "不能撤回至草稿",
    );
  });
  await pool.query("DELETE FROM season_registrations WHERE season_id = $1", [emptySeason]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);

  // A CompetitionEntry blocks too.
  const captain = randomUUID();
  await seedUser(pool, captain);
  await pool.query(
    `INSERT INTO competition_entries (id, competition_id, source, name, representative_user_id, registration_status)
     VALUES ($1, $2, 'event_native', 'Guarded Entry', $3, 'draft')`,
    [randomUUID(), emptySeason, captain],
  );
  await db.transaction(async (tx) => {
    await expectFailure(() => globals.assertSeasonHasNoHistoricalFacts(tx, emptySeason), "不能删除");
  });
  await pool.query("DELETE FROM competition_entries WHERE competition_id = $1", [emptySeason]);
  await pool.query("DELETE FROM users WHERE id = $1", [captain]);

  await pool.query("DELETE FROM seasons WHERE id = $1", [emptySeason]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
