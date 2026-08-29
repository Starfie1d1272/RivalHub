import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

type Globals = {
  schema: typeof import("../../src/db/schema");
  transferFormalTeamCaptainInTransaction: typeof import("../../src/lib/teams/captain-transfer")["transferFormalTeamCaptainInTransaction"];
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
  const { transferFormalTeamCaptainInTransaction } = await import("../../src/lib/teams/captain-transfer");
  const { assertSeasonHasNoHistoricalFacts, freezeCompetitiveContext } = await import("../../src/lib/seasons/lifecycle");
  const typeSeasons = await import("../../src/types/season");
  globals.schema = schemaModule;
  globals.transferFormalTeamCaptainInTransaction = transferFormalTeamCaptainInTransaction;
  globals.assertSeasonHasNoHistoricalFacts = assertSeasonHasNoHistoricalFacts;
  globals.freezeCompetitiveContext = freezeCompetitiveContext;
  globals.MAJOR_CONFIG = typeSeasons.MAJOR_TEAM_CONFIG;
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 6 });
  try {
    await exerciseCompetitiveFreezeLifecycle(pool);
    await exerciseEmptySeasonGuards(pool);
    await exerciseCaptainTransfer(pool);
    console.log("Season Governance local integration passed: competitive freeze lifecycle, empty-season guards, and captain transfer concurrency semantics.");
  } finally {
    await pool.end();
  }
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

  // A team application blocks too.
  const captain = randomUUID();
  await seedUser(pool, captain);
  await pool.query(
    `INSERT INTO team_applications (id, season_id, name, captain_user_id, status)
     VALUES ($1, $2, 'Guarded Application', $3, 'draft')`,
    [randomUUID(), emptySeason, captain],
  );
  await db.transaction(async (tx) => {
    await expectFailure(() => globals.assertSeasonHasNoHistoricalFacts(tx, emptySeason), "不能删除");
  });
  await pool.query("DELETE FROM team_applications WHERE season_id = $1", [emptySeason]);
  await pool.query("DELETE FROM users WHERE id = $1", [captain]);

  await pool.query("DELETE FROM seasons WHERE id = $1", [emptySeason]);
}

// ── Formal team captain transfer ────────────────────────────────────────────

function unauthorized(): Promise<never> {
  return Promise.reject(new Error("UNAUTHORIZED: 非当前赛季管理员"));
}

async function exerciseCaptainTransfer(pool: Pool): Promise<void> {
  const db = drizzle(pool, { schema: globals.schema });
  const seasonId = randomUUID();
  await pool.query(
    `INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft,
       registration_deadline, team_registration_config)
     VALUES ($1, $2, 'Governance Transfer', '自定义赛事', 'registration', 'team', false, false,
       now() + interval '7 days', $3::json)`,
    [seasonId, `gov-transfer-${randomUUID()}`, JSON.stringify(globals.MAJOR_CONFIG)],
  );

  const captainA = randomUUID();
  const memberB = randomUUID();
  const memberC = randomUUID();
  for (const user of [captainA, memberB, memberC]) await seedUser(pool, user);

  const teamId = randomUUID();
  // Formal teams require a provenance source; seed a minimal approved application.
  const applicationId = randomUUID();
  await pool.query(
    `INSERT INTO team_applications (id, season_id, name, captain_user_id, status)
     VALUES ($1, $2, 'Transfer Team', $3, 'approved')`,
    [applicationId, seasonId, captainA],
  );
  await pool.query(
    `INSERT INTO teams (id, season_id, name, captain_user_id, team_application_id, draft_order) VALUES ($1, $2, 'Transfer Team', $3, $4, 1)`,
    [teamId, seasonId, captainA, applicationId],
  );
  const applicationMemberIds = new Map<string, string>();
  for (const user of [captainA, memberB, memberC]) {
    const applicationMemberId = randomUUID();
    applicationMemberIds.set(user, applicationMemberId);
    await pool.query(
      `INSERT INTO team_application_members (id, application_id, user_id, invited_by_user_id, status, confirmed_at)
       VALUES ($1, $2, $3, $4, 'confirmed', now())`,
      [applicationMemberId, applicationId, user, captainA],
    );
    await pool.query(
      "INSERT INTO team_members (id, team_id, season_id, user_id, team_application_member_id, is_starter) VALUES ($1, $2, $3, $4, $5, false)",
      [randomUUID(), teamId, seasonId, user, applicationMemberId],
    );
  }

  const transfer = (actorId: string, toUserId: string, admin: (seasonId: string) => Promise<void> = unauthorized) =>
    db.transaction(async (tx) => globals.transferFormalTeamCaptainInTransaction(tx, {
      teamId,
      toUserId,
      actorUserId: actorId,
      assertSeasonAdmin: (targetSeasonId) => admin(targetSeasonId),
    }));

  // 1. Captain transfer to a confirmed roster member succeeds.
  await transfer(captainA, memberB);
  let row = await pool.query<{ captain_user_id: string }>("SELECT captain_user_id FROM teams WHERE id = $1", [teamId]);
  check(row.rows[0]?.captain_user_id === memberB, "A → B 交接后队长应为 B");
  const audit = await pool.query<{ count: string }>(
    "SELECT count(*) FROM audit_logs WHERE action = 'team.transfer_captain' AND target_id = $1", [teamId]);
  check(Number(audit.rows[0]?.count) === 1, "交接应写入一条审计日志");

  // 2. The former captain loses transfer authority.
  await expectFailure(() => transfer(captainA, memberC), "UNAUTHORIZED");

  // 3. Transfer to a non-member is refused and leaves state untouched.
  const outsider = randomUUID();
  await seedUser(pool, outsider);
  await expectFailure(() => transfer(memberB, outsider), "新队长必须是当前正式队伍成员");
  row = await pool.query<{ captain_user_id: string }>("SELECT captain_user_id FROM teams WHERE id = $1", [teamId]);
  check(row.rows[0]?.captain_user_id === memberB, "失败的交接不改变队长");

  // 4. Admin override may transfer for the current captain.
  await transfer(captainA, memberC, () => Promise.resolve());
  row = await pool.query<{ captain_user_id: string }>("SELECT captain_user_id FROM teams WHERE id = $1", [teamId]);
  check(row.rows[0]?.captain_user_id === memberC, "管理员覆盖交接后队长应为 C");
  // restore B as captain for the concurrency test
  await transfer(memberC, memberB, () => Promise.resolve());

  // 5. Two concurrent transfers A→B / A→C race on the locked current captain;
  //    exactly one succeeds per the serialized captain state.
  await pool.query("UPDATE teams SET captain_user_id = $2 WHERE id = $1", [teamId, captainA]);
  const results = await Promise.allSettled([
    transfer(captainA, memberB),
    transfer(captainA, memberC),
  ]);
  const succeeded = results.filter((result) => result.status === "fulfilled");
  const failed = results.filter((result) => result.status === "rejected");
  check(succeeded.length === 1 && failed.length === 1, "并发交接只能有一个成功");
  row = await pool.query<{ captain_user_id: string }>("SELECT captain_user_id FROM teams WHERE id = $1", [teamId]);
  const finalCaptain = row.rows[0]?.captain_user_id;
  check(finalCaptain === memberB || finalCaptain === memberC, "并发交接后队长必须是 B 或 C");
  check(finalCaptain === (succeeded[0] as PromiseFulfilledResult<{ toUserId: string }>).value.toUserId,
    "成功的事务与最终队长一致");

  // 6. Roster lock (confirmed Major entrant) closes the transfer window for a
  //    normal captain; admin override remains available.
  await pool.query("UPDATE teams SET captain_user_id = $2 WHERE id = $1", [teamId, memberB]);
  await pool.query(
    "INSERT INTO major_prestart_entrants (id, season_id, team_id, roster_confirmed_at) VALUES ($1, $2, $3, now())",
    [randomUUID(), seasonId, teamId],
  );
  await expectFailure(() => transfer(memberB, memberC), "正式名单已锁定");
  await transfer(captainA, memberC, () => Promise.resolve());
  row = await pool.query<{ captain_user_id: string }>("SELECT captain_user_id FROM teams WHERE id = $1", [teamId]);
  check(row.rows[0]?.captain_user_id === memberC, "名单锁定后管理员仍可覆盖交接");

  // 7. Member removal vs transfer: a removal that commits first makes the
  //    racing transfer fail closed; the captain never ends up outside the roster.
  await pool.query("DELETE FROM major_prestart_entrants WHERE season_id = $1", [seasonId]);
  await pool.query("UPDATE teams SET captain_user_id = $2 WHERE id = $1", [teamId, memberB]);
  const remover = await pool.connect();
  try {
    await remover.query("BEGIN");
    await remover.query("DELETE FROM team_members WHERE team_id = $1 AND user_id = $2", [teamId, memberC]);
    const pending = transfer(memberB, memberC).then(
      () => { throw new Error("并发移除后交接不应成功"); },
      (error: Error) => error,
    );
    await remover.query("COMMIT");
    const error = await pending;
    check(error.message.includes("新队长必须是当前正式队伍成员"), `并发移除应使交接失败，实际：${error.message}`);
  } finally {
    remover.release();
  }
  row = await pool.query<{ captain_user_id: string }>("SELECT captain_user_id FROM teams WHERE id = $1", [teamId]);
  check(row.rows[0]?.captain_user_id === memberB, "并发移除场景不改变队长");
  const captainStillOnRoster = await pool.query<{ count: string }>(
    "SELECT count(*) FROM team_members WHERE team_id = $1 AND user_id = $2", [teamId, memberB]);
  check(Number(captainStillOnRoster.rows[0]?.count) === 1, "队长仍属于队伍名单");

  await pool.query("DELETE FROM major_prestart_entrants WHERE season_id = $1", [seasonId]);
  await pool.query("DELETE FROM team_members WHERE season_id = $1", [seasonId]);
  await pool.query("DELETE FROM teams WHERE season_id = $1", [seasonId]);
  await pool.query("DELETE FROM team_applications WHERE season_id = $1", [seasonId]);
  await pool.query("DELETE FROM audit_logs WHERE target_id = $1", [teamId]);
  await pool.query("DELETE FROM seasons WHERE id = $1", [seasonId]);
  for (const user of [captainA, memberB, memberC, outsider]) {
    await pool.query("DELETE FROM users WHERE id = $1", [user]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
