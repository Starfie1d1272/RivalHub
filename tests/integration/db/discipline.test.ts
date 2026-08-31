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
import { createPerfectWorldRankOrder } from "../../../src/lib/config/perfect-world";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import {
  assertStartingLineupAllowedInTx,
  lockMatchInTx,
} from "../../../src/lib/match-rosters/service";
import {
  issueSanctionInTx,
  loadActiveSanctionsInTx,
  assertUsersNotBlockedInTx,
  markSanctionExpiredInTx,
  resolveSanctionStatus,
  revokeSanctionInTx,
  serializeSanctionPublic,
} from "../../../src/lib/discipline/service";
import { AppError } from "../../../src/lib/errors";
import { createMajorDefaultCapabilities } from "../../../src/types/season";
import { localDatabaseUrl } from "./harness/database";

const databaseUrl = localDatabaseUrl();

const ACTOR = "local-admin-h1";

const NJU_CODE = "4132010284";
const OTHER_CODE = "4111010001";
const COMPETITIVE_PROFILE = {
  platform: "perfect_world",
  currentSeasonKey: "major-current",
  previousSeasonKey: "major-previous",
  rankOrder: createPerfectWorldRankOrder(),
} as const;

interface DisciplineFixture {
  seasonId: string;
  runId: string;
  entryAId: string;
  entryBId: string;
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

    const layouts: Array<Array<{ side: number; index: number; code: string; academicStatus: "enrolled" | "graduated"; userId: string }>> = [];
    for (const side of [0, 1]) {
      const userIds = Array.from({ length: 5 }, () => randomUUID());
      layouts.push(
        [0, 1, 2].map(() => NJU_CODE).concat([OTHER_CODE, OTHER_CODE]).map((code, index) => ({
          side,
          index,
          code,
          academicStatus: code === OTHER_CODE && index === 3 ? ("graduated" as const) : ("enrolled" as const),
          userId: userIds[index]!,
        })),
      );
    }
    const emailByKey = new Map<string, string>();
    const memberIdByKey = new Map<string, string>();

    const entryIds: string[] = [];
    const eventRosterIds: string[] = [];
    for (const side of [0, 1]) {
      const entryId = randomUUID();
      const eventRosterId = randomUUID();
      const revisionId = randomUUID();
      entryIds.push(entryId);
      eventRosterIds.push(eventRosterId);
      const layoutRows = layouts[side]!;
      const userIds = layoutRows.map((layout) => layout.userId);
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
        `INSERT INTO competition_entries (id, competition_id, source, name, representative_user_id, current_roster_revision_id, approved_roster_revision_id, registration_status)
         VALUES ($1, $2, 'event_native', $3, $4, $5, $5, 'approved')`,
        [entryId, seasonId, side === 0 ? "Entry Alpha" : "Entry Beta", userIds[0], revisionId],
      );
      await client.query(
        "INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id) VALUES ($1, NULL, $2, 'local-admin')",
        [entryId, userIds[0]],
      );
      const participantIds: string[] = [];
      for (let i = 0; i < layoutRows.length; i += 1) {
        const userId = userIds[i]!;
        const participantId = randomUUID();
        emailByKey.set(`${side}-${i}`, `${side}-${i}-${userId}@local.test`);
        participantIds.push(participantId);
        await client.query(
          `INSERT INTO competition_entry_participants (id, entry_id, user_id, status, confirmed_at, invited_by_user_id)
           VALUES ($1, $2, $3, 'confirmed', now(), $4)`,
          [participantId, entryId, userId, userIds[0]],
        );
      }
      await client.query(
        `INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by, approved_at)
         VALUES ($1, $2, 1, 'approved', 'local-admin', now())`,
        [revisionId, entryId],
      );
      for (let i = 0; i < layoutRows.length; i += 1) {
        memberIdByKey.set(`${side}-${i}`, randomUUID());
        await client.query(
          `INSERT INTO competition_entry_roster_members (id, revision_id, participant_id, user_id, is_primary_starter)
           VALUES ($1, $2, $3, $4, $5)`,
          [memberIdByKey.get(`${side}-${i}`), revisionId, participantIds[i], userIds[i], i === 0],
        );
      }
      // Frozen event roster membership decides who can be fielded; the education
      // verification adopted by each member is eligibility provenance.
      await client.query(
        `INSERT INTO event_rosters (id, entry_id, source_roster_revision_id, status)
         VALUES ($1, $2, $3, 'preparing')`,
        [eventRosterId, entryId, revisionId],
      );
      for (let i = 0; i < layoutRows.length; i += 1) {
        const verification = await client.query<{ id: string }>(
          `SELECT v.id FROM education_verifications v
           INNER JOIN institutions i ON i.id = v.institution_id
           WHERE v.user_id = $1 AND i.moe_institution_code = $2`,
          [userIds[i]!, layoutRows[i]!.code],
        );
        await client.query(
          `INSERT INTO event_roster_members (event_roster_id, participant_id, user_id, education_verification_id)
           VALUES ($1, $2, $3, $4)`,
          [eventRosterId, participantIds[i]!, userIds[i]!, verification.rows[0]!.id],
        );
      }
      await client.query(`UPDATE event_rosters SET status = 'confirmed', confirmed_at = now(), confirmed_by = 'local-admin' WHERE id = $1`, [eventRosterId]);
      await client.query(`UPDATE event_rosters SET status = 'frozen', confirmed_at = now(), confirmed_by = 'local-admin', frozen_at = now(), frozen_by = 'local-admin' WHERE id = $1`, [eventRosterId]);
    }

    await client.query(
      `INSERT INTO major_prestart_states (season_id, entrants_locked_at, entrants_locked_by, seed_revision, confirmed_seed_revision)
       VALUES ($1, now(), 'local-admin', 1, 1)`,
      [seasonId],
    );
    // Minimal stage run with the frozen affiliation ruleset and per-player
    // frozen competitive facts (consumed by the match-lineup gate).
    const frozenCompetitiveFacts = [0, 1].flatMap((side) =>
      layouts[side]!.map((layout) => ({
        userId: layout.userId,
        historicalPeak: { rank: "A", rating: 1000 },
        previousSeasonPeak: { rank: "A", rating: 1000 },
        currentSeasonPeak: { rank: "A", rating: 1000 },
      })),
    );
    const ruleSnapshot = {
      version: 2,
      stage: { key: "stage1", type: "swiss", teamCount: 16, matchFormat: "bo1" },
      affiliationRules: [
        { institutionCode: NJU_CODE, eligibleAcademicStatuses: ["enrolled", "graduated"], minRosterMembers: 3, minStartingMembers: 3 },
      ],
      competitiveProfile: { ...COMPETITIVE_PROFILE, rankOrder: [...COMPETITIVE_PROFILE.rankOrder] },
      frozenCompetitiveFacts,
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
      await client.query(
        `INSERT INTO major_prestart_entrants (season_id, competition_entry_id, event_roster_id, roster_confirmed_at, roster_confirmed_by)
         VALUES ($1, $2, $3, now(), 'local-admin')`,
        [seasonId, entryIds[side], eventRosterIds[side]],
      );
    }

    await client.query("COMMIT");

    const memberIdsFor = async (side: number): Promise<string[]> => {
      const rows = await client.query<{ id: string }>(
        `SELECT m.id FROM event_roster_members m
         WHERE m.event_roster_id = $1
         ORDER BY m.user_id`,
        [eventRosterIds[side]],
      );
      return rows.rows.map((row) => row.id);
    };
    const emailsA = [0, 1, 2, 3, 4].map((i) => emailByKey.get(`0-${i}`)!);

    return {
      seasonId,
      runId: runResult.rows[0]!.id,
      entryAId: entryIds[0]!,
      entryBId: entryIds[1]!,
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
       (SELECT COUNT(*) FROM event_roster_members WHERE event_roster_id IN (
         SELECT event_roster_id FROM major_prestart_entrants WHERE season_id = $1 AND competition_entry_id = $2
       )) AS members_a,
       (SELECT representative_user_id FROM competition_entries WHERE id = $2) AS entry_a_representative,
       (SELECT representative_user_id FROM competition_entries WHERE id = $3) AS entry_b_representative`,
    [fixture.seasonId, fixture.entryAId, fixture.entryBId],
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
      await client.query("DELETE FROM major_prestart_entrants WHERE season_id = $1", [fixture.seasonId]);
      await client.query("DELETE FROM major_prestart_states WHERE season_id = $1", [fixture.seasonId]);
      // Frozen-roster immutability and append-only provenance are intentional in
      // normal operation; local teardown bypasses row triggers for its own rows.
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(`DELETE FROM event_roster_members WHERE event_roster_id IN (
        SELECT id FROM event_rosters WHERE entry_id IN (
          SELECT id FROM competition_entries WHERE competition_id = $1
        )
      )`, [fixture.seasonId]);
      await client.query(`DELETE FROM event_rosters WHERE entry_id IN (
        SELECT id FROM competition_entries WHERE competition_id = $1
      )`, [fixture.seasonId]);
      await client.query(`DELETE FROM competition_entry_roster_members WHERE revision_id IN (
        SELECT id FROM competition_entry_roster_revisions WHERE entry_id IN (
          SELECT id FROM competition_entries WHERE competition_id = $1
        )
      )`, [fixture.seasonId]);
      await client.query(`DELETE FROM competition_entry_roster_revisions WHERE entry_id IN (
        SELECT id FROM competition_entries WHERE competition_id = $1
      )`, [fixture.seasonId]);
      await client.query(`DELETE FROM competition_entry_participants WHERE entry_id IN (
        SELECT id FROM competition_entries WHERE competition_id = $1
      )`, [fixture.seasonId]);
      await client.query(`DELETE FROM competition_entry_representative_changes WHERE entry_id IN (
        SELECT id FROM competition_entries WHERE competition_id = $1
      )`, [fixture.seasonId]);
      await client.query("DELETE FROM competition_entries WHERE competition_id = $1", [fixture.seasonId]);
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
    const { seasonId, runId, entryAId, entryBId, memberAIds, memberBIds, emailsA } = fixture;

    const matchInsert = await pool.query<{ id: string }>(
      `INSERT INTO matches (
         season_id, entry_a_id, entry_b_id, stage, round, format, status,
         ownership, major_stage_run_id, managed_key
       ) VALUES ($1, $2, $3, 'stage1', 1, 'bo1', 'scheduled', 'major_stage', $4, 'r1-1')
       RETURNING id`,
      [seasonId, entryAId, entryBId, runId],
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
        expect(threw,  "S1 active registration_block 必须拦截").toBe(true);

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
        expect(!serializedJson.includes("secret-evidence-link"),  "S1 公开序列化不得泄露内部证据").toBe(true);
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
        expect(blocked.size === 0,  "S2 过期处罚不得再拦截").toBe(true);
        const refreshed = (await client.query(
          `SELECT status, effective_from AS "effectiveFrom", effective_until AS "effectiveUntil"
           FROM disciplinary_cases WHERE id = $1`, [captainCaseId])).rows[0];
        expect(resolveSanctionStatus(refreshed, new Date()) === "expired",  "S2 派生状态应为 expired").toBe(true);

        const firstExpire = await database.transaction((tx) =>
          markSanctionExpiredInTx(tx, { caseId: captainCaseId, actorId: ACTOR }));
        expect(!firstExpire.alreadyExpired,  "S2 首次标记应执行").toBe(true);
        const secondExpire = await database.transaction((tx) =>
          markSanctionExpiredInTx(tx, { caseId: captainCaseId, actorId: ACTOR }));
        expect(secondExpire.alreadyExpired,  "S2 重复标记幂等").toBe(true);
        expect((await auditCount(client, "sanction.expire", captainCaseId)) === 1,  "S2 过期审计恰好一条").toBe(true);
      } finally {
        client.release();
      }
    }

    // ── S3：撤销幂等与审计唯一性 ───────────────────────────────────────
    {
      const firstRevoke = await database.transaction((tx) =>
        revokeSanctionInTx(tx, { caseId: captainCaseId, actorId: ACTOR, reason: "复核后撤销" }));
      expect(!firstRevoke.alreadyRevoked,  "S3 首次撤销应执行").toBe(true);
      const secondRevoke = await database.transaction((tx) =>
        revokeSanctionInTx(tx, { caseId: captainCaseId, actorId: ACTOR, reason: "重复请求" }));
      expect(secondRevoke.alreadyRevoked,  "S3 重复撤销幂等").toBe(true);
      const client = await pool.connect();
      try {
        expect((await auditCount(client, "sanction.revoke", captainCaseId)) === 1,  "S3 撤销审计恰好一条").toBe(true);
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
          match: locked, entryId: entryAId, ...legalLineupA,
        });
        await assertStartingLineupAllowedInTx(tx, {
          match: locked, entryId: entryBId, ...legalLineupB,
        });
        return true;
      });
      expect(baselineOk,  "S4 基线双方阵容必须通过").toBe(true);

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
          await assertStartingLineupAllowedInTx(tx, { match: locked, entryId: entryAId, ...legalLineupA });
          return null;
        } catch (error) {
          return error instanceof AppError ? error.message : null;
        }
      });
      expect(rejected !== null && rejected.includes("禁赛"),  "S4 受罚者所在队阵容必须被拒绝").toBe(true);

      // 另一队不受牵连。
      await database.transaction(async (tx) => {
        const locked = await lockMatchInTx(tx, matchId);
        await assertStartingLineupAllowedInTx(tx, { match: locked, entryId: entryBId, ...legalLineupB });
      });

      // 撤销后同阵容恢复可用。
      await database.transaction((tx) =>
        revokeSanctionInTx(tx, { caseId: participationCaseId, actorId: ACTOR, reason: "和解撤销" }));
      await database.transaction(async (tx) => {
        const locked = await lockMatchInTx(tx, matchId);
        await assertStartingLineupAllowedInTx(tx, { match: locked, entryId: entryAId, ...legalLineupA });
      });

      const client = await pool.connect();
      try {
        expect((await auditCount(client, "sanction.issue", participationCaseId)) === 1,  "S4 签发审计恰好一条").toBe(true);
      } finally {
        client.release();
      }
    }

    // ── S6：队伍事实零改动 ─────────────────────────────────────────────
    {
      const client = await pool.connect();
      try {
        const afterSnapshot = await snapshotTeamFacts(client, fixture);
        expect(afterSnapshot.rows[0]!.entrants === beforeSnapshot.rows[0]!.entrants,  "S6 entrants 数量不变").toBe(true);
        expect(afterSnapshot.rows[0]!.members_a === beforeSnapshot.rows[0]!.members_a,  "S6 冻结名单成员数量不变").toBe(true);
        expect(afterSnapshot.rows[0]!.entry_a_representative === beforeSnapshot.rows[0]!.entry_a_representative &&
          afterSnapshot.rows[0]!.entry_b_representative === beforeSnapshot.rows[0]!.entry_b_representative,
          "S6 Entry 代表归属不得被处罚流程改动").toBe(true);
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

describe("discipline eligibility PostgreSQL invariants", () => {
  it("keeps sanctions scoped to eligibility without changing team facts", async () => {
    await main();
  });
});
