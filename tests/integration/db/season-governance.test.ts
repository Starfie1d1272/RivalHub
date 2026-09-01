import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deleteCompetitivePlatformCatalog, seedCompetitivePlatformCatalog } from "./harness/competitive-catalog-fixtures";
import { localDatabaseUrl } from "./harness/database";

type Globals = {
  schema: typeof import("../../../src/db/schema");
  assertSeasonHasNoHistoricalFacts: typeof import("../../../src/lib/seasons/lifecycle")["assertSeasonHasNoHistoricalFacts"];
  freezeCompetitiveContext: typeof import("../../../src/lib/seasons/lifecycle")["freezeCompetitiveContext"];
  openSeasonRegistrationInTx: typeof import("../../../src/lib/seasons/lifecycle")["openSeasonRegistrationInTx"];
  transitionSeasonStatusInTx: typeof import("../../../src/lib/seasons/lifecycle")["transitionSeasonStatusInTx"];
  MAJOR_CONFIG: typeof import("../../../src/types/season")["MAJOR_TEAM_CONFIG"];
};
const globals = {} as Globals;

const RANK_ORDER = ["D", "C", "B", "A", "S"];

async function main(): Promise<void> {
  // Domain owners lazily connect through @/db/client, which reads DATABASE_URL;
  // env must be set before those imports resolve.
  const databaseUrl = localDatabaseUrl();
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? databaseUrl;
  const schemaModule = await import("../../../src/db/schema");
  const { assertSeasonHasNoHistoricalFacts, freezeCompetitiveContext, openSeasonRegistrationInTx, transitionSeasonStatusInTx } = await import("../../../src/lib/seasons/lifecycle");
  const typeSeasons = await import("../../../src/types/season");
  globals.schema = schemaModule;
  globals.assertSeasonHasNoHistoricalFacts = assertSeasonHasNoHistoricalFacts;
  globals.freezeCompetitiveContext = freezeCompetitiveContext;
  globals.openSeasonRegistrationInTx = openSeasonRegistrationInTx;
  globals.transitionSeasonStatusInTx = transitionSeasonStatusInTx;
  globals.MAJOR_CONFIG = typeSeasons.MAJOR_TEAM_CONFIG;
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 6 });
  try {
    await exerciseCompetitiveFreezeLifecycle(pool);
    await exerciseEmptySeasonGuards(pool);
    await exerciseQualificationPlatformIsolation(pool);
    await exerciseTerminalTransitions(pool);
    console.log("Season Governance local integration passed: competitive freeze lifecycle, empty-season guards, qualification platform isolation, and row-locked terminal transitions with atomic audits.");
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
    `INSERT INTO users (id, email, display_name, steam64, perfect_name, qq, email_verified_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [id, email, "Governance 选手", `76561198${id.replaceAll("-", "").slice(0, 12)}`, `Perfect 选手 ${seq}`, `99000${seq}`],
  );
  await pool.query(
    `INSERT INTO education_verifications (user_id, institution_id, academic_status, evidence_type, status)
     SELECT $1, i.id, 'enrolled', 'chsi_enrollment_report', 'approved'
     FROM institutions i WHERE i.moe_institution_code = '4132010284'`,
    [id],
  );
}

async function exerciseQualificationPlatformIsolation(pool: Pool): Promise<void> {
  const { getParticipantReadinessBatch } = await import("../../../src/lib/qualification/service");
  const platform = `govqual-${randomUUID()}`;
  const otherPlatform = `govother-${randomUUID()}`;
  const rankOrder = ["D", "C", "B", "A", "S"];

  // Only a foreign-platform user: if the loader ever leaks facts across
  // platforms, this participant would incorrectly pass qualification.
  const foreignOnlyUser = randomUUID();
  const homeUser = randomUUID();
  await seedFullyReadyUser(pool, foreignOnlyUser, 1);
  await seedFullyReadyUser(pool, homeUser, 2);

  await seedCompetitivePlatformCatalog(pool, platform, [
    { seasonKey: "S20", label: "S20", sortOrder: 0, isCurrent: false },
    { seasonKey: "S21", label: "S21", sortOrder: 1, isCurrent: true },
  ], rankOrder);

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
  expect(foreign.ready === false,  `外部平台资料不得满足 ${platform} 资格；实际 ready=${foreign.ready}`).toBe(true);
  expect(foreign.blockers.some((blocker) => blocker.includes("缺少历史最高段位及 Rating")),
    `外部平台资料缺失时应报缺少历史最高；实际 blockers: ${foreign.blockers.join(" ")}`).toBe(true);
  const home = readiness.get(homeUser)!;
  expect(home.ready === true,  `本平台资料齐全的用户应 ready；实际 blockers: ${home.blockers.join(" ")}`).toBe(true);

  await pool.query("DELETE FROM competitive_rank_facts WHERE user_id = ANY($1::uuid[])", [[foreignOnlyUser, homeUser]]);
  await pool.query("DELETE FROM education_verifications WHERE user_id = ANY($1::uuid[])", [[foreignOnlyUser, homeUser]]);
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[foreignOnlyUser, homeUser]]);
  await deleteCompetitivePlatformCatalog(pool, platform);
  // otherPlatform only ever carried rank facts (no catalog rows).
}

// ── Competitive freeze lifecycle ────────────────────────────────────────────

async function seedCatalog(pool: Pool, platform: string): Promise<{ s21: string; s22: string }> {
  await seedCompetitivePlatformCatalog(pool, platform, [
    { seasonKey: "S19", label: "S19 赛季", sortOrder: 0, isCurrent: false },
    { seasonKey: "S20", label: "S20 赛季", sortOrder: 1, isCurrent: false },
    { seasonKey: "S21", label: "S21 赛季", sortOrder: 2, isCurrent: true },
    { seasonKey: "S22", label: "S22 赛季", sortOrder: 3, isCurrent: false, active: false },
  ], RANK_ORDER);
  const catalog = await pool.query<{ id: string; season_key: string; is_current: boolean }>(
    "SELECT id, season_key, is_current FROM competitive_platform_seasons WHERE platform = $1", [platform],
  );
  const byKey = new Map(catalog.rows.map((row) => [row.season_key, row.id]));
  return { s21: byKey.get("S21")!, s22: byKey.get("S22")! };
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
  // Registration-open freeze resolves two complete seasons plus the ongoing
  // catalog season without changing catalog chronology.
  await pool.query("UPDATE seasons SET status = 'registration', registration_opens_at = now() - interval '1 minute' WHERE id = $1", [seasonId]);
  let frozen: { competitiveProfile: Record<string, unknown> } | null = null;
  await db.transaction(async (tx) => {
    const opened = await globals.openSeasonRegistrationInTx(tx, { seasonId, actorId: "system" });
    expect(opened.opened, "报名开放必须在同一事务中冻结竞技参考策略。").toBe(true);
    const [season] = await tx.select().from(globals.schema.seasons).where(eq(globals.schema.seasons.id, seasonId));
    frozen = season.teamRegistrationConfig as unknown as { competitiveProfile: Record<string, unknown> };
  });
  const profile = frozen!.competitiveProfile;
  expect(profile.currentSeasonKey === "S20" && profile.previousSeasonKey === "S19",  "冻结应保留两届完整赛季").toBe(true);
  expect((profile.evidencePolicy as unknown as { recentSeasonKeys?: string[] })?.recentSeasonKeys?.join(",") === "S20,S21", "冻结策略应把当前进行中赛季作为近期可选补充").toBe(true);
  const openAudit = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM audit_logs WHERE season_id = $1 AND action = 'season.registration_open'", [seasonId]);
  expect(openAudit.rows[0]?.count === "1", "报名开放与冻结必须留下同一事务内的审计事实。").toBe(true);

  // The catalog later advances to S22; the frozen result held by the caller
  // (or a published season row) is never re-resolved.
  await pool.query("UPDATE competitive_platform_seasons SET is_current = false WHERE id = $1", [catalog.s21]);
  await pool.query("UPDATE competitive_platform_seasons SET active = true, is_current = true WHERE id = $1", [catalog.s22]);

  // Persist the first freeze as a published season would have done; the row
  // must remain untouched by the catalog change above.
  const published = await pool.query<{ team_registration_config: { competitiveProfile: Record<string, string> } }>(
    "SELECT team_registration_config FROM seasons WHERE id = $1", [seasonId]);
  expect(published.rows[0]?.team_registration_config.competitiveProfile.currentSeasonKey === "S20",
    "已发布赛季的冻结上下文不受目录变化影响").toBe(true);

  // A future publish of a NEW draft season re-resolves from the new catalog state.
  const secondDraft = await createMajorDraft(pool, `gov-freeze-2-${randomUUID()}`, platform);
  let refrozen: { competitiveProfile: Record<string, string> } | null = null;
  await db.transaction(async (tx) => {
    const [season] = await tx.select().from(globals.schema.seasons).where(eq(globals.schema.seasons.id, secondDraft));
    refrozen = await globals.freezeCompetitiveContext(tx, season) as unknown as { competitiveProfile: Record<string, string> };
  });
  const newProfile = refrozen!.competitiveProfile;
  expect(newProfile.currentSeasonKey === "S21" && newProfile.previousSeasonKey === "S20",
    `目录推进到 S22 后，下一次开放应重新解析完整赛季；实际：${JSON.stringify(newProfile)}`).toBe(true);
  expect((newProfile.evidencePolicy as unknown as { recentSeasonKeys?: string[] })?.recentSeasonKeys?.join(",") === "S21,S22",
    "新的冻结策略应消费 S21 与 S22 作为近期证据。").toBe(true);

  await pool.query("DELETE FROM seasons WHERE id = $1", [seasonId]);
  await pool.query("DELETE FROM seasons WHERE id = $1", [secondDraft]);
  await deleteCompetitivePlatformCatalog(pool, platform);
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
    const deletionError = await globals.assertSeasonHasNoHistoricalFacts(tx, emptySeason).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(deletionError).toHaveProperty("message", expect.stringContaining("不能删除"));
  });
  await db.transaction(async (tx) => {
    const draftReversionError = await globals.assertSeasonHasNoHistoricalFacts(
      tx,
      emptySeason,
      "该赛季已经产生报名、队伍或赛程事实，不能撤回至草稿。",
    ).then(() => undefined, (error: unknown) => error);
    expect(draftReversionError).toHaveProperty("message", expect.stringContaining("不能撤回至草稿"));
  });
  await pool.query("DELETE FROM season_registrations WHERE season_id = $1", [emptySeason]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);

  // A CompetitionEntry blocks too.
  const captain = randomUUID();
  const entryId = randomUUID();
  const revisionId = randomUUID();
  await seedUser(pool, captain);
  const entryClient = await pool.connect();
  try {
    await entryClient.query("BEGIN");
    await entryClient.query(
      `INSERT INTO competition_entries (id, competition_id, source, name, representative_user_id, current_roster_revision_id, registration_status)
       VALUES ($1, $2, 'event_native', 'Guarded Entry', $3, $4, 'draft')`,
      [entryId, emptySeason, captain, revisionId],
    );
    await entryClient.query("INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id) VALUES ($1, NULL, $2, 'local-admin')", [entryId, captain]);
    await entryClient.query("INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by) VALUES ($1, $2, 1, 'draft', 'local-admin')", [revisionId, entryId]);
    await entryClient.query("COMMIT");
  } catch (error) {
    await entryClient.query("ROLLBACK");
    throw error;
  } finally {
    entryClient.release();
  }
  await db.transaction(async (tx) => {
    const entryDeletionError = await globals.assertSeasonHasNoHistoricalFacts(tx, emptySeason).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(entryDeletionError).toHaveProperty("message", expect.stringContaining("不能删除"));
  });
  const entryCleanup = await pool.connect();
  try {
    await entryCleanup.query("BEGIN");
    await entryCleanup.query("SET LOCAL session_replication_role = replica");
    await entryCleanup.query("DELETE FROM competition_entry_roster_revisions WHERE entry_id = $1", [entryId]);
    await entryCleanup.query("DELETE FROM competition_entry_representative_changes WHERE entry_id = $1", [entryId]);
    await entryCleanup.query("DELETE FROM competition_entries WHERE id = $1", [entryId]);
    await entryCleanup.query("COMMIT");
  } catch (error) {
    await entryCleanup.query("ROLLBACK");
    throw error;
  } finally {
    entryCleanup.release();
  }
  await pool.query("DELETE FROM users WHERE id = $1", [captain]);

  await pool.query("DELETE FROM seasons WHERE id = $1", [emptySeason]);
}

// ── Row-locked terminal transitions with atomic audits ──────────────────────

async function seedStatusSeason(pool: Pool, status: string): Promise<string> {
  const seasonId = randomUUID();
  await pool.query(
    `INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft, team_registration_config)
     VALUES ($1, $2, 'Governance Terminal', '自定义赛事', $3::season_status, 'team', false, false, '{}'::json)`,
    [seasonId, `gov-terminal-${randomUUID()}`, status],
  );
  return seasonId;
}

async function readTerminalState(pool: Pool, seasonId: string): Promise<{ status: string; audits: string }> {
  const result = await pool.query<{ status: string; audits: string }>(
    `SELECT status::text AS status,
            (SELECT count(*)::text FROM audit_logs WHERE season_id = $1 AND target_type = 'season') AS audits
     FROM seasons WHERE id = $1`,
    [seasonId],
  );
  return result.rows[0] ?? { status: "missing", audits: "0" };
}

async function exerciseTerminalTransitions(pool: Pool): Promise<void> {
  const db = drizzle(pool, { schema: globals.schema });
  const transition = globals.transitionSeasonStatusInTx;

  // 非法迁移 fail closed：状态与审计都不落库。
  const registrationSeason = await seedStatusSeason(pool, "registration");
  await db.transaction(async (tx) => {
    const invalidTransitionError = await transition(tx, {
      seasonId: registrationSeason,
      from: "playing",
      to: "finished",
      action: "season.force_finish",
      actorId: "local-admin",
      failureMessage: "只有 playing 状态可手动结束",
    }).then(() => undefined, (error: unknown) => error);
    expect(invalidTransitionError).toHaveProperty("message", expect.stringContaining("只有 playing 状态可手动结束"));
  });
  const untouched = await readTerminalState(pool, registrationSeason);
  expect(untouched.status === "registration" && untouched.audits === "0",  "非法终态迁移不能留下状态或审计。").toBe(true);
  await pool.query("DELETE FROM seasons WHERE id = $1", [registrationSeason]);

  // 合法迁移：状态与审计同一事务落库。
  const playingSeason = await seedStatusSeason(pool, "playing");
  await db.transaction(async (tx) => {
    const result = await transition(tx, { seasonId: playingSeason, from: "playing", to: "finished", action: "season.force_finish", actorId: "local-admin", failureMessage: "只有 playing 状态可手动结束" });
    expect(typeof result.slug === "string" && result.slug.length > 0,  "终态迁移应返回 slug。").toBe(true);
  });
  const finished = await readTerminalState(pool, playingSeason);
  expect(finished.status === "finished" && finished.audits === "1",  "playing → finished 应原子写入状态与审计。").toBe(true);

  // 并发双迁移：行锁 + 状态复验，恰好一次成功、一次失败，且只有一条审计。
  const concurrentSeason = await seedStatusSeason(pool, "playing");
  const attempts = await Promise.allSettled([
    db.transaction((tx) => transition(tx, { seasonId: concurrentSeason, from: "playing", to: "finished", action: "season.force_finish", actorId: "local-admin-a", failureMessage: "只有 playing 状态可手动结束" })),
    db.transaction((tx) => transition(tx, { seasonId: concurrentSeason, from: "playing", to: "finished", action: "season.force_finish", actorId: "local-admin-b", failureMessage: "只有 playing 状态可手动结束" })),
  ]);
  const succeeded = attempts.filter((attempt) => attempt.status === "fulfilled").length;
  const rejected = attempts.filter((attempt) => attempt.status === "rejected").length;
  expect(succeeded === 1 && rejected === 1,  `并发终态迁移应收敛为一次成功一次拒绝；实际 ${succeeded}/${rejected}。`).toBe(true);
  const concurrentState = await readTerminalState(pool, concurrentSeason);
  expect(concurrentState.status === "finished" && concurrentState.audits === "1",  "并发终态迁移后状态与审计应恰好各一份。").toBe(true);

  // finished → archived 合法迁移；archived 之后不可再转换。
  await db.transaction(async (tx) => {
    await transition(tx, { seasonId: playingSeason, from: "finished", to: "archived", action: "season.archive", actorId: "local-admin", failureMessage: "只有 finished 状态可归档" });
  });
  await db.transaction(async (tx) => {
    const repeatedArchiveError = await transition(tx, {
      seasonId: playingSeason,
      from: "finished",
      to: "archived",
      action: "season.archive",
      actorId: "local-admin",
      failureMessage: "只有 finished 状态可归档",
    }).then(() => undefined, (error: unknown) => error);
    expect(repeatedArchiveError).toHaveProperty("message", expect.stringContaining("只有 finished 状态可归档"));
  });
  const archived = await readTerminalState(pool, playingSeason);
  expect(archived.status === "archived" && archived.audits === "2",  "finished → archived 应记录审计且不可重复。").toBe(true);

  await pool.query("DELETE FROM audit_logs WHERE season_id IN ($1, $2)", [playingSeason, concurrentSeason]);
  await pool.query("DELETE FROM seasons WHERE id IN ($1, $2)", [playingSeason, concurrentSeason]);
}

describe("season governance PostgreSQL invariants", () => {
  it("serializes terminal transitions and preserves competitive freeze", async () => {
    await main();
  });
});
