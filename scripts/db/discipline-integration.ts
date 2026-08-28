/**
 * PR H1 — 纪律与资格边界真实 PostgreSQL 集成测试。
 *
 * 覆盖：
 *  1. active registration_block 拦截本人报名、队友不受影响
 *  2. 过期处罚不拦截（含显式 markSanctionExpired 幂等）
 *  3. revoked 处罚不拦截；重复撤销幂等且只产生一条审计
 *  4. match_participation_block 禁止进入本场阵容（首发校验文案）
 *     ——撤销后同阵容恢复可用（retry-safe），期间另一队完全不受影响
 *  5. internalEvidence 绝不出现在公开序列化中
 *  6. 处罚不连带队伍事实（teams / entrants / roster_members 原样）
 *
 * 只允许 loopback Local Supabase。
 */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "../../src/db/schema";
import {
  assertStartingLineupAllowedInTx,
  lockMatchInTx,
} from "../../src/lib/match-rosters/service";
import {
  issueSanctionInTx,
  loadActiveSanctionsInTx,
  assertUsersNotBlockedInTx,
  markSanctionExpiredInTx,
  resolveSanctionStatus,
  revokeSanctionInTx,
  serializeSanctionPublic,
} from "../../src/lib/discipline/service";
import { AppError } from "../../src/lib/errors";
import { createMajorDefaultCapabilities } from "../../src/types/season";

const databaseUrl = process.env.RIVALHUB_LOCAL_DATABASE_URL;
if (!databaseUrl) throw new Error("RIVALHUB_LOCAL_DATABASE_URL 未设置。");
const target = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname)) {
  throw new Error("纪律集成测试只允许 Local Supabase loopback 数据库。");
}

const ACTOR = "local-admin-h1";

function assertCondition(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const NJU_CODE = "4132010284";
const OTHER_CODE = "4111010001";
const COMPETITIVE_PROFILE = {
  platform: "perfect_world",
  currentSeasonKey: "major-current",
  previousSeasonKey: "major-previous",
  rankOrder: ["C", "B", "A", "S", "S+"],
} as const;

interface DisciplineFixture {
  seasonId: string;
  runId: string;
  teamAId: string;
  teamBId: string;
  memberAIds: string[];
  memberBIds: string[];
  emailsA: string[];
}

/** Team layout: seeds 0–2 NJU enrolled, 3–4 other-institution graduated/enrolled. */
async function prepareFixture(pool: Pool, label: string): Promise<DisciplineFixture> {
  const client = await pool.connect();
  const seasonId = randomUUID();
  const capabilities = createMajorDefaultCapabilities();
  capabilities.teamRegistrationConfig.competitiveProfile = { ...COMPETITIVE_PROFILE, rankOrder: [...COMPETITIVE_PROFILE.rankOrder] };
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO seasons (
        id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft,
        stage_plan, registration_config, team_registration_config, affiliation_rules, min_team_size, max_team_size, starter_count, positions
      ) VALUES ($1, $2, 'Local Discipline', 'Major', 'playing', $3, $4, $5, $6::json, $7::json, $8::json, $9::json, $10, $11, $12, $13::text[])`,
      [
        seasonId,
        `local-discipline-${label}-${seasonId}`,
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

    const layouts = [0, 1].map((side) =>
      [0, 1, 2].map(() => NJU_CODE).concat([OTHER_CODE, OTHER_CODE]).map((code, index) => ({
        side,
        index,
        code,
        academicStatus: code === OTHER_CODE && index === 3 ? ("graduated" as const) : ("enrolled" as const),
      })),
    );
    const emailByKey = new Map<string, string>();
    const memberIdByKey = new Map<string, string>();

    for (const side of [0, 1]) {
      const applicationId = randomUUID();
      const teamId = randomUUID();
      const layoutRows = layouts[side]!;
      const userIds = layoutRows.map(() => randomUUID());
      for (let i = 0; i < layoutRows.length; i += 1) {
        await client.query(`INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now())`, [
          userIds[i], `${side}-${i}-${userIds[i]}@local.test`,
        ]);
        await client.query(
          `INSERT INTO competitive_rank_facts (user_id, platform, kind, platform_season_key, rank, rating)
           VALUES
             ($1, $2, 'historical_peak', NULL, 'A', 1000),
             ($1, $2, 'season_peak', $3, 'A', 1000),
             ($1, $2, 'season_peak', $4, 'A', 1000)`,
          [userIds[i], COMPETITIVE_PROFILE.platform, COMPETITIVE_PROFILE.previousSeasonKey, COMPETITIVE_PROFILE.currentSeasonKey],
        );
        await client.query(
          `INSERT INTO education_verifications (user_id, institution_id, academic_status, evidence_type, status, reviewed_by, reviewed_at)
           SELECT $1, i.id, $2, 'manual_other', 'approved', 'local-admin', now()
           FROM institutions i WHERE i.moe_institution_code = $3`,
          [userIds[i], layoutRows[i]!.academicStatus, layoutRows[i]!.code],
        );
      }
      await client.query(
        `INSERT INTO team_applications (id, season_id, name, captain_user_id, status)
         VALUES ($1, $2, $3, $4, 'approved')`,
        [applicationId, seasonId, side === 0 ? "Team Alpha" : "Team Beta", userIds[0]],
      );
      await client.query(
        `INSERT INTO teams (id, season_id, name, captain_user_id, team_application_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [teamId, seasonId, side === 0 ? "Team Alpha" : "Team Beta", userIds[0], applicationId],
      );
      for (let i = 0; i < layoutRows.length; i += 1) {
        const userId = userIds[i]!;
        const appMemberId = randomUUID();
        emailByKey.set(`${side}-${i}`, `${side}-${i}-${userId}@local.test`);
        memberIdByKey.set(`${side}-${i}`, appMemberId);
        await client.query(
          `INSERT INTO team_application_members (id, application_id, user_id, invited_by_user_id, status, confirmed_at)
           VALUES ($1, $2, $3, $4, 'confirmed', now())`,
          [appMemberId, applicationId, userId, userIds[0]],
        );
        await client.query(
          `INSERT INTO team_members (team_id, season_id, user_id, team_application_member_id)
           VALUES ($1, $2, $3, $4)`,
          [teamId, seasonId, userId, appMemberId],
        );
      }
    }

    await client.query(
      `INSERT INTO major_prestart_states (season_id, entrants_locked_at, entrants_locked_by, seed_revision, confirmed_seed_revision)
       VALUES ($1, now(), 'local-admin', 1, 1)`,
      [seasonId],
    );
    // Minimal stage run with the frozen affiliation ruleset.
    const ruleSnapshot = {
      version: 2,
      stage: { key: "stage1", type: "swiss", teamCount: 16, matchFormat: "bo1" },
      affiliationRules: [
        { institutionCode: NJU_CODE, eligibleAcademicStatuses: ["enrolled", "graduated"], minRosterMembers: 3, minStartingMembers: 3 },
      ],
      competitiveProfile: { ...COMPETITIVE_PROFILE, rankOrder: [...COMPETITIVE_PROFILE.rankOrder] },
      stagePlan: [{ key: "stage1" }, { key: "playoff" }],
      tournamentEntrants: [],
      tournamentSeeds: [],
    };
    const runResult = await client.query<{ id: string }>(
      `INSERT INTO major_stage_runs (season_id, stage_key, rule_snapshot, started_by)
       VALUES ($1, 'stage1', $2::jsonb, 'local-admin') RETURNING id`,
      [seasonId, JSON.stringify(ruleSnapshot)],
    );

    // Entrants are optional in this suite: the roster gate exercises frozen
    // membership only when an entrant exists, so create them for realism.
    for (const side of [0, 1]) {
      const teamRow = await client.query<{ id: string }>(
        `SELECT id FROM teams WHERE season_id = $1 AND name = $2`,
        [seasonId, side === 0 ? "Team Alpha" : "Team Beta"],
      );
      const teamId = teamRow.rows[0]!.id;
      const entrant = await client.query<{ id: string }>(
        `INSERT INTO major_prestart_entrants (season_id, team_id, roster_confirmed_at, roster_confirmed_by)
         VALUES ($1, $2, now(), 'local-admin') RETURNING id`,
        [seasonId, teamId],
      );
      const layoutRows = layouts[side]!;
      for (let i = 0; i < layoutRows.length; i += 1) {
        const userRow = await client.query<{ id: string }>(
          `SELECT id FROM users WHERE email = $1`, [emailByKey.get(`${side}-${i}`)!]);
        const verification = await client.query<{ id: string }>(
          `SELECT v.id FROM education_verifications v
           INNER JOIN institutions i ON i.id = v.institution_id
           WHERE v.user_id = $1 AND i.moe_institution_code = $2`,
          [userRow.rows[0]!.id, layoutRows[i]!.code],
        );
        await client.query(
          `INSERT INTO major_prestart_roster_members (entrant_id, user_id, education_verification_id)
           VALUES ($1, $2, $3)`,
          [entrant.rows[0]!.id, userRow.rows[0]!.id, verification.rows[0]!.id],
        );
      }
    }

    await client.query("COMMIT");

    const memberIdsFor = async (side: number): Promise<string[]> => {
      const rows = await client.query<{ id: string }>(
        `SELECT m.id FROM team_members m JOIN teams t ON t.id = m.team_id
         WHERE m.season_id = $1 AND t.name = $2 ORDER BY m.user_id`,
        [seasonId, side === 0 ? "Team Alpha" : "Team Beta"],
      );
      return rows.rows.map((row) => row.id);
    };
    const emailsA = [0, 1, 2, 3, 4].map((i) => emailByKey.get(`0-${i}`)!);

    return {
      seasonId,
      runId: runResult.rows[0]!.id,
      teamAId: (await pool.query(`SELECT id FROM teams WHERE season_id = $1 AND name = 'Team Alpha'`, [seasonId])).rows[0]!.id,
      teamBId: (await pool.query(`SELECT id FROM teams WHERE season_id = $1 AND name = 'Team Beta'`, [seasonId])).rows[0]!.id,
      memberAIds: await memberIdsFor(0),
      memberBIds: await memberIdsFor(1),
      emailsA,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function snapshotTeamFacts(client: PoolClient, fixture: DisciplineFixture) {
  return client.query(
    `SELECT
       (SELECT COUNT(*) FROM major_prestart_entrants e WHERE e.season_id = $1) AS entrants,
       (SELECT COUNT(*) FROM team_members WHERE season_id = $1 AND team_id = $2) AS members_a,
       (SELECT captain_user_id FROM teams WHERE id = $2) AS team_a_captain,
       (SELECT captain_user_id FROM teams WHERE id = $3) AS team_b_captain`,
    [fixture.seasonId, fixture.teamAId, fixture.teamBId],
  );
}

async function auditCount(client: PoolClient, action: string, targetId: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM audit_logs WHERE action = $1 AND target_id = $2`,
    [action, targetId],
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function cleanup(pool: Pool, fixtures: DisciplineFixture[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const fixture of [...fixtures].reverse()) {
      await client.query("DELETE FROM audit_logs WHERE season_id = $1", [fixture.seasonId]);
      await client.query("DELETE FROM matches WHERE season_id = $1", [fixture.seasonId]);
      await client.query(`DELETE FROM disciplinary_case_idempotency i USING disciplinary_cases d
        WHERE i.case_id = d.id AND d.season_id = $1`, [fixture.seasonId]);
      await client.query("DELETE FROM disciplinary_cases WHERE season_id = $1", [fixture.seasonId]);
      await client.query("DELETE FROM major_stage_runs WHERE season_id = $1", [fixture.seasonId]);
      await client.query(`DELETE FROM major_prestart_roster_members r USING major_prestart_entrants e
        WHERE r.entrant_id = e.id AND e.season_id = $1`, [fixture.seasonId]);
      await client.query("DELETE FROM major_prestart_entrants WHERE season_id = $1", [fixture.seasonId]);
      await client.query("DELETE FROM major_prestart_states WHERE season_id = $1", [fixture.seasonId]);
      await client.query("DELETE FROM team_members WHERE season_id = $1", [fixture.seasonId]);
      await client.query(`DELETE FROM team_application_members m USING team_applications a
        WHERE m.application_id = a.id AND a.season_id = $1`, [fixture.seasonId]);
      await client.query("DELETE FROM teams WHERE season_id = $1", [fixture.seasonId]);
      await client.query("DELETE FROM team_applications WHERE season_id = $1", [fixture.seasonId]);
      await client.query(`DELETE FROM education_verifications WHERE user_id IN (
        SELECT id FROM users WHERE email LIKE '%@local.test' AND email LIKE $1)`, [`%${fixture.seasonId}%`]);
      await client.query(`DELETE FROM users WHERE email LIKE $1`, [`%${fixture.seasonId}%`]);
      await client.query("DELETE FROM seasons WHERE id = $1", [fixture.seasonId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 6 });
  const database = drizzle(pool, { schema });
  const fixtures: DisciplineFixture[] = [];

  try {
    const fixture = await prepareFixture(pool, "h1");
    fixtures.push(fixture);
    const { seasonId, runId, teamAId, teamBId, memberAIds, memberBIds, emailsA } = fixture;

    const matchInsert = await pool.query<{ id: string }>(
      `INSERT INTO matches (
         season_id, team_a_id, team_b_id, stage, round, format, status,
         ownership, major_stage_run_id, managed_key
       ) VALUES ($1, $2, $3, 'stage1', 1, 'bo1', 'scheduled', 'major_stage', $4, 'r1-1')
       RETURNING id`,
      [seasonId, teamAId, teamBId, runId],
    );
    const matchId = matchInsert.rows[0]!.id;

    const userLookupByEmail = async (email: string): Promise<string> => {
      const row = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
      return row.rows[0]!.id;
    };

    const legalLineupA = { starterIds: memberAIds.slice(0, 5), substituteIds: [] };
    const legalLineupB = { starterIds: memberBIds.slice(0, 5), substituteIds: [] };

    // Baseline：两队阵容本可通过完整校验。
    let beforeSnapshot!: Awaited<ReturnType<typeof snapshotTeamFacts>>;
    {
      const c = await pool.connect();
      try { beforeSnapshot = await snapshotTeamFacts(c, fixture); } finally { c.release(); }
    }

    // ── S1/S2/S3：registration_block 生命周期 ──────────────────────────
    let captainCaseId = "";
    {
      const captainUser = await userLookupByEmail(emailsA[0]!);
      captainCaseId = (
        await database.transaction((tx) =>
          issueSanctionInTx(tx, {
            seasonId,
            subjectUserId: captainUser,
            effects: ["registration_block"],
            internalEvidence: "内部证据：externally hosted secret-evidence-link.example",
            publicExplanation: "因违规被取消本赛季报名资格",
            actorId: ACTOR,
          }),
        )
      ).caseId;

      const client = await pool.connect();
      try {
        // active blocks the subject at registration.
        let threw = false;
        try {
          const labels = new Map<string, string>();
          for (let i = 0; i < emailsA.length; i += 1) labels.set(await userLookupByEmail(emailsA[i]!), emailsA[i]!);
          await database.transaction((tx) =>
            assertUsersNotBlockedInTx(tx, {
              seasonId,
              userLabels: labels,
              effect: "registration_block",
              message: "存在处于有效期内的报名禁赛处罚成员",
            }),
          );
        } catch (e) {
          threw = true;
          if (!(e instanceof AppError)) throw e;
          if (!e.message.includes(emailsA[0]!)) throw new Error("S1 拦截名单未包含受罚者邮箱");
        }
        assertCondition(threw, "S1 active registration_block 必须拦截");

        // Teammate unaffected: probing everyone EXCEPT the banned subject passes.
        const labelsWithoutCaptain = new Map<string, string>();
        for (let i = 1; i < emailsA.length; i += 1) labelsWithoutCaptain.set(await userLookupByEmail(emailsA[i]!), emailsA[i]!);
        await database.transaction((tx) =>
          assertUsersNotBlockedInTx(tx, {
            seasonId,
            userLabels: labelsWithoutCaptain,
            effect: "registration_block",
            message: "存在处于有效期内的报名禁赛处罚成员",
          }),
        );

        // Evidence never appears publicly.
        const caseRow = (await client.query(
          `SELECT id, season_id AS "seasonId", subject_user_id AS "subjectUserId", status, effects,
                  public_explanation AS "publicExplanation", effective_from AS "effectiveFrom",
                  effective_until AS "effectiveUntil", created_at AS "createdAt"
           FROM disciplinary_cases WHERE id = $1`, [captainCaseId])).rows[0];
        const serializedJson = JSON.stringify(serializeSanctionPublic(caseRow, new Date()));
        assertCondition(!serializedJson.includes("secret-evidence-link"), "S1 公开序列化不得泄露内部证据");
      } finally {
        client.release();
      }
    }

    // ── S2：窗口过期后不再拦截 + 显式过期幂等 ────────────────────────
    {
      const client = await pool.connect();
      try {
        await client.query(
          `UPDATE disciplinary_cases SET effective_from = now() - interval '2 days',
             effective_until = now() - interval '1 day' WHERE id = $1`,
          [captainCaseId],
        );
        const blocked = await loadActiveSanctionsInTx(
          // read-only loader works against plain drizzle db handle too
          database as unknown as Parameters<typeof loadActiveSanctionsInTx>[0],
          { seasonId, effect: "registration_block" },
        );
        assertCondition(blocked.size === 0, "S2 过期处罚不得再拦截");
        const refreshed = (await client.query(
          `SELECT status, effective_from AS "effectiveFrom", effective_until AS "effectiveUntil"
           FROM disciplinary_cases WHERE id = $1`, [captainCaseId])).rows[0];
        assertCondition(resolveSanctionStatus(refreshed, new Date()) === "expired", "S2 派生状态应为 expired");

        const firstExpire = await database.transaction((tx) =>
          markSanctionExpiredInTx(tx, { caseId: captainCaseId, actorId: ACTOR }));
        assertCondition(!firstExpire.alreadyExpired, "S2 首次标记应执行");
        const secondExpire = await database.transaction((tx) =>
          markSanctionExpiredInTx(tx, { caseId: captainCaseId, actorId: ACTOR }));
        assertCondition(secondExpire.alreadyExpired, "S2 重复标记幂等");
        assertCondition((await auditCount(client, "sanction.expire", captainCaseId)) === 1, "S2 过期审计恰好一条");
      } finally {
        client.release();
      }
    }

    // ── S3：撤销幂等与审计唯一性 ───────────────────────────────────────
    {
      const firstRevoke = await database.transaction((tx) =>
        revokeSanctionInTx(tx, { caseId: captainCaseId, actorId: ACTOR, reason: "复核后撤销" }));
      assertCondition(!firstRevoke.alreadyRevoked, "S3 首次撤销应执行");
      const secondRevoke = await database.transaction((tx) =>
        revokeSanctionInTx(tx, { caseId: captainCaseId, actorId: ACTOR, reason: "重复请求" }));
      assertCondition(secondRevoke.alreadyRevoked, "S3 重复撤销幂等");
      const client = await pool.connect();
      try {
        assertCondition((await auditCount(client, "sanction.revoke", captainCaseId)) === 1, "S3 撤销审计恰好一条");
      } finally {
        client.release();
      }
    }

    // ── S4：match_participation_block 与阵容门禁 ──────────────────────
    {
      const starterUser = await userLookupByEmail(emailsA[0]!);

      // 撤销后的 registration case 不影响任何效果（已 revoked）。
      const baselineOk = await database.transaction(async (tx) => {
        const locked = await lockMatchInTx(tx, matchId);
        await assertStartingLineupAllowedInTx(tx, {
          match: locked, teamId: teamAId, ...legalLineupA,
        });
        await assertStartingLineupAllowedInTx(tx, {
          match: locked, teamId: teamBId, ...legalLineupB,
        });
        return true;
      });
      assertCondition(baselineOk, "S4 基线双方阵容必须通过");

      const participationCaseId = (
        await database.transaction((tx) =>
          issueSanctionInTx(tx, {
            seasonId,
            subjectUserId: starterUser,
            effects: ["match_participation_block"],
            actorId: ACTOR,
          }),
        )
      ).caseId;

      const rejected = await database.transaction(async (tx) => {
        const locked = await lockMatchInTx(tx, matchId);
        try {
          await assertStartingLineupAllowedInTx(tx, { match: locked, teamId: teamAId, ...legalLineupA });
          return null;
        } catch (error) {
          return error instanceof AppError ? error.message : null;
        }
      });
      assertCondition(rejected !== null && rejected.includes("禁赛"), "S4 受罚者所在队阵容必须被拒绝");

      // 另一队不受牵连。
      await database.transaction(async (tx) => {
        const locked = await lockMatchInTx(tx, matchId);
        await assertStartingLineupAllowedInTx(tx, { match: locked, teamId: teamBId, ...legalLineupB });
      });

      // 撤销后同阵容恢复可用。
      await database.transaction((tx) =>
        revokeSanctionInTx(tx, { caseId: participationCaseId, actorId: ACTOR, reason: "和解撤销" }));
      await database.transaction(async (tx) => {
        const locked = await lockMatchInTx(tx, matchId);
        await assertStartingLineupAllowedInTx(tx, { match: locked, teamId: teamAId, ...legalLineupA });
      });

      const client = await pool.connect();
      try {
        assertCondition((await auditCount(client, "sanction.issue", participationCaseId)) === 1, "S4 签发审计恰好一条");
      } finally {
        client.release();
      }
    }

    // ── S6：队伍事实零改动 ─────────────────────────────────────────────
    {
      const client = await pool.connect();
      try {
        const afterSnapshot = await snapshotTeamFacts(client, fixture);
        assertCondition(afterSnapshot.rows[0]!.entrants === beforeSnapshot.rows[0]!.entrants, "S6 entrants 数量不变");
        assertCondition(afterSnapshot.rows[0]!.members_a === beforeSnapshot.rows[0]!.members_a, "S6 队伍成员数量不变");
        assertCondition(afterSnapshot.rows[0]!.team_a_captain === beforeSnapshot.rows[0]!.team_a_captain &&
          afterSnapshot.rows[0]!.team_b_captain === beforeSnapshot.rows[0]!.team_b_captain,
          "S6 队长归属不得被处罚流程改动");
      } finally {
        client.release();
      }
    }

    console.log("H1 discipline eligibility integration suite passed.");
  } finally {
    await cleanup(pool, fixtures);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
