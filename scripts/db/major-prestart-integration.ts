import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createMajorDefaultCapabilities } from "../../src/types/season";
import { evaluateRosterEducationEligibility, type EducationEligibilityMember } from "../../src/lib/education/eligibility";

const databaseUrl = process.env.RIVALHUB_LOCAL_DATABASE_URL;
if (!databaseUrl) throw new Error("RIVALHUB_LOCAL_DATABASE_URL 未设置。");
const target = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname)) {
  throw new Error("Major 赛前集成测试只允许 Local Supabase loopback 数据库。");
}

let expectedErrorIndex = 0;

async function expectPgError(client: import("pg").PoolClient, work: () => Promise<unknown>, code: string): Promise<void> {
  const savepoint = `expected_error_${expectedErrorIndex++}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await work();
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === code) return;
    throw error;
  }
  throw new Error(`预期 PostgreSQL 错误 ${code}，但操作成功。`);
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 1 });
  const client = await pool.connect();
  const seasonId = randomUUID();
  const teamIds = Array.from({ length: 32 }, () => randomUUID());
  const applicationIds = Array.from({ length: 32 }, () => randomUUID());
  const userIds = Array.from({ length: 160 }, () => randomUUID());
  const memberIds = Array.from({ length: 160 }, () => randomUUID());
  const entrantId = randomUUID();
  const capabilities = createMajorDefaultCapabilities();
  const keepBrowserFixture = process.env.RIVALHUB_LOCAL_KEEP_MAJOR_PRESTART_FIXTURE === "true";
  const browserSlug = `local-major-prestart-browser-${seasonId}`;
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO seasons (
        id, slug, name, kind, registration_mode, has_captain_voting, has_draft,
        stage_plan, registration_config, team_registration_config, affiliation_rules, min_team_size, max_team_size, starter_count, positions
      ) VALUES ($1, $2, 'Local Major Prestart', 'Major', $3, $4, $5, $6::json, $7::json, $8::json, $9::json, $10, $11, $12, $13::text[])`,
      [
        seasonId,
        keepBrowserFixture ? browserSlug : `local-major-prestart-${seasonId}`,
        capabilities.registrationMode,
        capabilities.hasCaptainVoting,
        capabilities.hasDraft,
        JSON.stringify(capabilities.stagePlan),
        JSON.stringify(capabilities.registrationConfig),
        JSON.stringify(capabilities.teamRegistrationConfig),
        JSON.stringify(capabilities.affiliationRules),
        capabilities.minTeamSize,
        capabilities.maxTeamSize,
        capabilities.starterCount,
        capabilities.positions,
      ],
    );
    await client.query(
      `INSERT INTO users (id, email, email_verified_at) SELECT value::uuid, 'prestart-' || value || '@local.test', now()
       FROM unnest($1::text[]) AS value`,
      [userIds],
    );
    await client.query(
      `INSERT INTO education_verifications (user_id, institution_id, academic_status, evidence_type, status, reviewed_by, reviewed_at)
       SELECT u.id, i.id, 'enrolled', 'manual_other', 'approved', 'local-admin', now()
       FROM users u CROSS JOIN institutions i
       WHERE u.id = ANY($1::uuid[]) AND i.moe_institution_code = '4132010284'`,
      [userIds],
    );
    await client.query(
      `INSERT INTO education_verifications (user_id, institution_id, academic_status, evidence_type, status, reviewed_by, reviewed_at)
       SELECT u.id, i.id, 'graduated', 'manual_other', 'approved', 'local-admin', now()
       FROM users u CROSS JOIN institutions i
       WHERE u.id = ANY($1::uuid[]) AND i.moe_institution_code = '4111010001'`,
      [userIds.slice(2, 5)],
    );
    const identityRows = await client.query<{
      id: string; user_id: string; email: string; email_verified_at: Date | null;
      moe_institution_code: string; name: string; academic_status: "enrolled" | "graduated";
    }>(`
      SELECT v.id, v.user_id, u.email, u.email_verified_at, i.moe_institution_code, i.name, v.academic_status
      FROM education_verifications v
      INNER JOIN users u ON u.id = v.user_id
      INNER JOIN institutions i ON i.id = v.institution_id
      WHERE v.user_id = ANY($1::uuid[]) AND v.status = 'approved'
    `, [userIds.slice(0, 5)]);
    const memberFor = (userId: string, code: string): EducationEligibilityMember => {
      const row = identityRows.rows.find((candidate) => candidate.user_id === userId && candidate.moe_institution_code === code);
      if (!row) throw new Error("Local identity fixture 缺少已批准的教育认证。 ");
      return {
        userId, email: row.email, emailVerifiedAt: row.email_verified_at,
        verification: { id: row.id, institutionCode: row.moe_institution_code, institutionName: row.name, academicStatus: row.academic_status, status: "approved" },
      };
    };
    const twoNju = [
      memberFor(userIds[0]!, "4132010284"), memberFor(userIds[1]!, "4132010284"),
      memberFor(userIds[2]!, "4111010001"), memberFor(userIds[3]!, "4111010001"), memberFor(userIds[4]!, "4111010001"),
    ];
    const insufficient = evaluateRosterEducationEligibility(twoNju, capabilities.affiliationRules);
    if (insufficient.eligible || !insufficient.blockers.some((blocker) => blocker.includes("当前已认证南京大学成员 2 人"))) {
      throw new Error("2 名南京大学成员没有被 Major roster eligibility 拒绝。 ");
    }
    const threeNju = [...twoNju];
    threeNju[2] = memberFor(userIds[2]!, "4132010284");
    if (!evaluateRosterEducationEligibility(threeNju, capabilities.affiliationRules).eligible) {
      throw new Error("3 名南京大学成员加已认证其他高校成员没有通过 Major roster eligibility。 ");
    }
    for (let index = 0; index < 32; index += 1) {
      await client.query(
        `INSERT INTO team_applications (id, season_id, name, captain_user_id, status)
         VALUES ($1, $2, $3, $4, 'approved')`,
        [applicationIds[index], seasonId, `Team ${index + 1}`, userIds[index * 5]],
      );
      await client.query(
        `INSERT INTO teams (id, season_id, name, captain_user_id, team_application_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [teamIds[index], seasonId, `Team ${index + 1}`, userIds[index * 5], applicationIds[index]],
      );
      for (let offset = 0; offset < 5; offset += 1) {
        const userId = userIds[index * 5 + offset];
        const memberId = memberIds[index * 5 + offset];
        await client.query(
          `INSERT INTO team_application_members (id, application_id, user_id, invited_by_user_id, status, confirmed_at)
           VALUES ($1, $2, $3, $4, 'confirmed', now())`,
          [memberId, applicationIds[index], userId, userIds[index * 5]],
        );
        await client.query(
          `INSERT INTO team_members (team_id, season_id, user_id, team_application_member_id)
           VALUES ($1, $2, $3, $4)`,
          [teamIds[index], seasonId, userId, memberId],
        );
      }
    }
    await client.query("INSERT INTO major_prestart_states (season_id) VALUES ($1)", [seasonId]);
    await client.query(
      "INSERT INTO major_prestart_entrants (id, season_id, team_id) VALUES ($1, $2, $3)",
      [entrantId, seasonId, teamIds[0]],
    );
    await client.query(
      "INSERT INTO major_prestart_roster_members (entrant_id, user_id) SELECT $1, unnest($2::uuid[])",
      [entrantId, userIds.slice(0, 5)],
    );
    await expectPgError(client, () => client.query(
      "INSERT INTO major_prestart_entrants (season_id, team_id) VALUES ($1, $2)", [seasonId, teamIds[0]],
    ), "23505");
    await expectPgError(client, () => client.query(
      "INSERT INTO major_prestart_roster_members (entrant_id, user_id) VALUES ($1, $2)", [entrantId, userIds[0]],
    ), "23505");
    const before = await client.query<{ selected: string; total: string }>(`
      SELECT
        (SELECT count(*) FROM major_prestart_entrants WHERE season_id = $1) AS selected,
        (SELECT count(*) FROM teams WHERE season_id = $1) AS total
    `, [seasonId]);
    if (before.rows[0]?.selected !== "1" || before.rows[0]?.total !== "32") {
      throw new Error("正式参赛队集合没有与所有正式 teams 保持分离。");
    }
    await client.query(
      "INSERT INTO major_prestart_issues (season_id, category, label) VALUES ($1, 'qualification', '资格材料复核'), ($1, 'administration', '裁判排班')",
      [seasonId],
    );
    const issues = await client.query<{ qualification: string; administration: string }>(`
      SELECT
        count(*) FILTER (WHERE category = 'qualification' AND resolved_at IS NULL) AS qualification,
        count(*) FILTER (WHERE category = 'administration' AND resolved_at IS NULL) AS administration
      FROM major_prestart_issues WHERE season_id = $1
    `, [seasonId]);
    if (issues.rows[0]?.qualification !== "1" || issues.rows[0]?.administration !== "1") {
      throw new Error("资格与管理事项未按持久化类别保存。");
    }
    await client.query("DELETE FROM major_prestart_entrants WHERE id = $1", [entrantId]);
    const rosterAfterDelete = await client.query<{ count: string }>(
      "SELECT count(*) FROM major_prestart_roster_members WHERE entrant_id = $1", [entrantId],
    );
    if (rosterAfterDelete.rows[0]?.count !== "0") throw new Error("最终名单快照没有随正式参赛队级联删除。");
    await client.query(
      `INSERT INTO major_prestart_entrants (season_id, team_id)
       SELECT $1, id FROM teams WHERE season_id = $1 ON CONFLICT DO NOTHING`,
      [seasonId],
    );
    const reinserted = await client.query<{ id: string }>(
      "SELECT id FROM major_prestart_entrants WHERE season_id = $1 AND team_id = $2", [seasonId, teamIds[0]],
    );
    const reinsertedEntrantId = reinserted.rows[0]?.id;
    if (!reinsertedEntrantId) throw new Error("正式参赛队未能重新建立。");
    await expectPgError(client, () => client.query(
      "INSERT INTO major_tournament_seeds (season_id, entrant_id, tournament_seed) VALUES ($1, $2, 33)",
      [seasonId, reinsertedEntrantId],
    ), "23514");
    await client.query(
      `INSERT INTO major_prestart_roster_members (entrant_id, user_id, education_verification_id)
       SELECT e.id, tm.user_id, v.id FROM major_prestart_entrants e
       INNER JOIN team_members tm ON tm.team_id = e.team_id AND tm.season_id = e.season_id
       INNER JOIN education_verifications v ON v.user_id = tm.user_id AND v.status = 'approved'
       INNER JOIN institutions i ON i.id = v.institution_id AND i.moe_institution_code = '4132010284'
       WHERE e.season_id = $1 ON CONFLICT DO NOTHING`,
      [seasonId],
    );
    const frozen = await client.query<{ education_verification_id: string }>(
      `SELECT r.education_verification_id
       FROM major_prestart_roster_members r
       INNER JOIN major_prestart_entrants e ON e.id = r.entrant_id
       WHERE e.season_id = $1 AND r.user_id = $2`,
      [seasonId, userIds[0]],
    );
    const frozenId = frozen.rows[0]?.education_verification_id;
    if (!frozenId) throw new Error("赛前名单没有冻结已批准教育认证引用。 ");
    await client.query(
      `INSERT INTO education_verifications (user_id, institution_id, academic_status, evidence_type, status, reviewed_by, reviewed_at)
       SELECT $1, id, 'graduated', 'manual_other', 'approved', 'local-admin', now()
       FROM institutions WHERE moe_institution_code = '4111010001'`,
      [userIds[0]],
    );
    const frozenAfterRevision = await client.query<{ education_verification_id: string }>(
      `SELECT r.education_verification_id
       FROM major_prestart_roster_members r
       INNER JOIN major_prestart_entrants e ON e.id = r.entrant_id
       WHERE e.season_id = $1 AND r.user_id = $2`,
      [seasonId, userIds[0]],
    );
    if (frozenAfterRevision.rows[0]?.education_verification_id !== frozenId) {
      throw new Error("新教育认证静默改写了已冻结 Major 名单的历史依据。 ");
    }
    await client.query(
      `INSERT INTO major_tournament_seeds (season_id, entrant_id, tournament_seed)
       SELECT $1, id, row_number() OVER (ORDER BY team_id)::int
       FROM major_prestart_entrants WHERE season_id = $1`,
      [seasonId],
    );
    const seedCount = await client.query<{ count: string }>(
      "SELECT count(*) FROM major_tournament_seeds WHERE season_id = $1", [seasonId],
    );
    if (seedCount.rows[0]?.count !== "32") throw new Error("独立赛事 1–32 种子未完整持久化。");
    await expectPgError(client, () => client.query(
      "UPDATE major_tournament_seeds SET tournament_seed = 1 WHERE season_id = $1 AND tournament_seed = 2", [seasonId],
    ), "23505");
    await client.query(
      "UPDATE major_prestart_states SET entrants_locked_at = now(), seed_revision = 1, confirmed_seed_revision = 1 WHERE season_id = $1",
      [seasonId],
    );
    const confirmation = await client.query<{ seed_revision: number; confirmed_seed_revision: number }>(
      "SELECT seed_revision, confirmed_seed_revision FROM major_prestart_states WHERE season_id = $1", [seasonId],
    );
    if (confirmation.rows[0]?.seed_revision !== confirmation.rows[0]?.confirmed_seed_revision) {
      throw new Error("确认的种子 revision 未持久化。");
    }
    await client.query("SET LOCAL ROLE anon");
    await expectPgError(client, () => client.query("SELECT evidence_url FROM education_verifications LIMIT 1"), "42501");
    await expectPgError(client, () => client.query("SELECT id FROM institutions LIMIT 1"), "42501");
    await client.query("RESET ROLE");
    if (keepBrowserFixture) {
      await client.query("UPDATE major_prestart_entrants SET roster_confirmed_at = now() WHERE season_id = $1", [seasonId]);
      await client.query("UPDATE major_prestart_issues SET resolved_at = now() WHERE season_id = $1", [seasonId]);
      await client.query("COMMIT");
      console.log(`Major prestart browser fixture committed: ${browserSlug}`);
    } else {
      await client.query("ROLLBACK");
    }
    console.log("Major prestart local integration passed: verified email → approved education, 2/3 NJU eligibility boundary, frozen verification references after later revisions, RLS denial, selected entrants, seeds, uniqueness, and cascade boundary.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
