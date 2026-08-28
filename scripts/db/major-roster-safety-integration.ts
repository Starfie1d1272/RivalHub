/**
 * PR G1 — Major 阵容安全真实 PostgreSQL 集成测试。
 *
 * 覆盖场景：
 *  1. 无 roster start → fail（且不产生任何静默补名单）
 *  2. 4 名首发 → fail
 *  3. 6 名首发 → fail
 *  4. 队外选手 / 冻结名单外人 → fail
 *  5. 重复选择队员 → fail
 *  6. 合法 5 人但 NJU 首发 <3 → fail
 *  7. 合法且 NJU 首发 ≥3 → confirm → start 通过
 *  8. mutable season 规则改变不影响 frozen StageRun 快照
 *  9. admin 选择默认首发但不确认 → start fail；显式确认 → 通过
 * 10. repeated submit 幂等/确定性
 * 11. repeated confirm 幂等且不重复写 audit
 * 12. 并发 start 只产生一次状态推进、一次 match.start audit，无双 roster
 *
 * 只允许 loopback Local Supabase。
 */
import { randomUUID } from "node:crypto";
import { createPerfectWorldRankOrder } from "../../src/lib/config/perfect-world";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "../../src/db/schema";
import { auditLogs } from "../../src/db/schema";
import {
  applyMatchStatusTransitionInTx,
  assertStartingLineupAllowedInTx,
  confirmMatchRosterInTx,
  lockMatchInTx,
  persistMatchRosterInTx,
  type MatchTransitionOutcome,
} from "../../src/lib/match-rosters/service";
import { AppError, ErrorCode } from "../../src/lib/errors";
import { createMajorDefaultCapabilities } from "../../src/types/season";

const databaseUrl = process.env.RIVALHUB_LOCAL_DATABASE_URL;
if (!databaseUrl) throw new Error("RIVALHUB_LOCAL_DATABASE_URL 未设置。");
const target = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname)) {
  throw new Error("阵容安全集成测试只允许 Local Supabase loopback 数据库。");
}

const ACTOR = "local-admin-g1";

async function expectAppError(work: () => Promise<unknown>, code: ErrorCode, hint?: string): Promise<AppError> {
  try {
    await work();
  } catch (error) {
    if (error instanceof AppError && error.code === code) return error;
    throw new Error(`${hint ?? "操作"}：预期 AppError(${code})，实际 ${String(error)}`);
  }
  throw new Error(`${hint ?? "操作"}：预期失败（${code}），但操作成功。`);
}

function assertCondition(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function countAudit(client: PoolClient, matchId: string, action: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM audit_logs WHERE target_id = $1 AND target_type = 'match' AND action = $2`,
    [matchId, action],
  );
  return Number(result.rows[0]?.count ?? "0");
}

type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * 与 src/actions/matches/roster.ts#submitMatchRoster 的生产事务体一致
 * （不含 captain session 判定）。
 */
async function submitLineupProductionLogic(
  database: Database,
  args: {
    matchId: string;
    teamId: string;
    starterIds: string[];
    substituteIds?: string[];
    source: "participant" | "admin_select";
    submittedBy: string | null;
  },
): Promise<{ rosterId: string }> {
  return database.transaction(async (tx) => {
    const locked = await lockMatchInTx(tx, args.matchId);
    if (locked.status !== "scheduled") {
      throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛已开始或取消，不能再调整阵容");
    }
    await assertStartingLineupAllowedInTx(tx, {
      match: locked,
      teamId: args.teamId,
      starterIds: args.starterIds,
      substituteIds: args.substituteIds,
    });
    const summary = await persistMatchRosterInTx(tx, {
      match: locked,
      teamId: args.teamId,
      submittedBy: args.submittedBy,
      source: args.source,
      starterIds: args.starterIds,
      substituteIds: args.substituteIds,
    });
    await tx.insert(auditLogs).values({
      seasonId: locked.seasonId,
      action: "match.roster.submit",
      actorId: ACTOR,
      targetId: summary.rosterId,
      targetType: "match_roster",
      meta: {
        matchId: args.matchId,
        teamId: args.teamId,
        source: args.source,
        starterIds: args.starterIds,
        substituteIds: args.substituteIds ?? [],
      },
    });
    return { rosterId: summary.rosterId };
  });
}

async function confirmRosterProductionLogic(database: Database, rosterId: string): Promise<{ alreadyConfirmed: boolean }> {
  return database.transaction(async (tx) => {
    const outcome = await confirmMatchRosterInTx(tx, { rosterId, actorId: ACTOR });
    return { alreadyConfirmed: outcome.alreadyConfirmed };
  });
}

// ── Fixture ────────────────────────────────────────────────────────────────

interface RosterSafetyFixture {
  seasonId: string;
  runId: string;
  teamAId: string;
  teamBId: string;
  /** Member id lookup by logical position: a0..a5 on team A, b0..b5 on B, plus outsider members aOut/bOut. */
  memberA: Record<string, string>;
  memberB: Record<string, string>;
}

const NJU_CODE = "4132010284";
const OTHER_CODE = "4111010001";
const COMPETITIVE_PROFILE = {
  platform: "perfect_world",
  currentSeasonKey: "major-current",
  previousSeasonKey: "major-previous",
  rankOrder: createPerfectWorldRankOrder(),
} as const;

/** A-team user layout: 0,1,2 NJU enrolled; 3,4 other-graduated; 5 other-enrolled; 6 NJU but excluded from frozen roster. */
function teamUserLayout(offset: number): { userIdIndex: number; institutionCode: string | null; academicStatus: "enrolled" | "graduated"; frozen: boolean }[] {
  return [
    { userIdIndex: offset + 0, institutionCode: NJU_CODE, academicStatus: "enrolled", frozen: true },
    { userIdIndex: offset + 1, institutionCode: NJU_CODE, academicStatus: "enrolled", frozen: true },
    { userIdIndex: offset + 2, institutionCode: NJU_CODE, academicStatus: "graduated", frozen: true },
    { userIdIndex: offset + 3, institutionCode: OTHER_CODE, academicStatus: "graduated", frozen: true },
    { userIdIndex: offset + 4, institutionCode: OTHER_CODE, academicStatus: "enrolled", frozen: true },
    { userIdIndex: offset + 5, institutionCode: OTHER_CODE, academicStatus: "enrolled", frozen: true },
    // Canonical team member who is deliberately absent from the tournament roster.
    { userIdIndex: offset + 6, institutionCode: NJU_CODE, academicStatus: "enrolled", frozen: false },
  ];
}

async function prepareFixture(pool: Pool, label: string): Promise<RosterSafetyFixture> {
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
      ) VALUES ($1, $2, 'Local Major Roster Safety', 'Major', 'playing', $3, $4, $5, $6::json, $7::json, $8::json, $9::json, $10, $11, $12, $13::text[])`,
      [
        seasonId,
        `local-major-roster-safety-${label}-${seasonId}`,
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

    const allLayouts = [...teamUserLayout(0), ...teamUserLayout(100)];
    const userIds = allLayouts.map(() => randomUUID());
    for (let i = 0; i < userIds.length; i += 1) {
      await client.query(
        `INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now())`,
        [userIds[i], `g1-${i}-${seasonId}@local.test`],
      );
      await client.query(
        `INSERT INTO competitive_rank_facts (user_id, platform, kind, platform_season_key, rank, rating)
         VALUES
           ($1, $2, 'historical_peak', NULL, 'A', 1000),
           ($1, $2, 'season_peak', $3, 'A', 1000),
           ($1, $2, 'season_peak', $4, 'A', 1000)`,
        [userIds[i], COMPETITIVE_PROFILE.platform, COMPETITIVE_PROFILE.previousSeasonKey, COMPETITIVE_PROFILE.currentSeasonKey],
      );
    }

    const applicationIds = [randomUUID(), randomUUID()];
    const applicationMemberIds: string[][] = [[], []];
    const teamIds = [randomUUID(), randomUUID()];

    for (const side of [0, 1] as const) {
      const layouts = teamUserLayout(side === 0 ? 0 : 100);
      const sideUsers = userIds.filter((_, index) =>
        index >= (side === 0 ? 0 : 7) && index < (side === 0 ? 7 : 14),
      );
      await client.query(
        `INSERT INTO team_applications (id, season_id, name, captain_user_id, status)
         VALUES ($1, $2, $3, $4, 'approved')`,
        [applicationIds[side], seasonId, side === 0 ? "Team Alpha" : "Team Beta", sideUsers[0]],
      );
      await client.query(
        `INSERT INTO teams (id, season_id, name, captain_user_id, team_application_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [teamIds[side], seasonId, side === 0 ? "Team Alpha" : "Team Beta", sideUsers[0], applicationIds[side]],
      );
      for (let offset = 0; offset < layouts.length; offset += 1) {
        const memberId = randomUUID();
        applicationMemberIds[side].push(memberId);
        await client.query(
          `INSERT INTO team_application_members (id, application_id, user_id, invited_by_user_id, status, confirmed_at)
           VALUES ($1, $2, $3, $4, 'confirmed', now())`,
          [memberId, applicationIds[side], sideUsers[offset], sideUsers[0]],
        );
        await client.query(
          `INSERT INTO team_members (team_id, season_id, user_id, team_application_member_id)
           VALUES ($1, $2, $3, $4)`,
          [teamIds[side], seasonId, sideUsers[offset], memberId],
        );
      }
    }

    // Exactly one approved verification per user.
    for (let i = 0; i < allLayouts.length; i += 1) {
      const layout = allLayouts[i];
      if (!layout.institutionCode) continue;
      await client.query(
        `INSERT INTO education_verifications (user_id, institution_id, academic_status, evidence_type, status, reviewed_by, reviewed_at)
         SELECT $1, i.id, $2, 'manual_other', 'approved', 'local-admin', now()
         FROM institutions i WHERE i.moe_institution_code = $3`,
        [userIds[i], layout.academicStatus, layout.institutionCode],
      );
    }

    await client.query(
      `INSERT INTO major_prestart_states (season_id, entrants_locked_at, entrants_locked_by, seed_revision, confirmed_seed_revision)
       VALUES ($1, now(), 'local-admin', 1, 1)`,
      [seasonId],
    );

    const entrantRows: string[] = [];
    for (const side of [0, 1] as const) {
      const entrant = await client.query<{ id: string }>(
        `INSERT INTO major_prestart_entrants (season_id, team_id, roster_confirmed_at, roster_confirmed_by)
         VALUES ($1, $2, now(), 'local-admin') RETURNING id`,
        [seasonId, teamIds[side]],
      );
      const entrantId = entrant.rows[0]!.id;
      entrantRows.push(entrantId);
      const sideUsers = userIds.filter((_, index) =>
        index >= (side === 0 ? 0 : 7) && index < (side === 0 ? 7 : 14),
      );
      const layouts = teamUserLayout(side === 0 ? 0 : 100);
      for (let offset = 0; offset < layouts.length; offset += 1) {
        if (!layouts[offset].frozen) continue;
        const verification = await client.query<{ id: string }>(
          `SELECT v.id FROM education_verifications v
           INNER JOIN institutions i ON i.id = v.institution_id
           WHERE v.user_id = $1 AND i.moe_institution_code = $2`,
          [sideUsers[offset], layouts[offset].institutionCode],
        );
        await client.query(
          `INSERT INTO major_prestart_roster_members (entrant_id, user_id, education_verification_id)
           VALUES ($1, $2, $3)`,
          [entrantId, sideUsers[offset], verification.rows[0]!.id],
        );
      }
    }

    // Frozen StageRun carrying the affiliation rules accepted at launch.
    const ruleSnapshot = {
      version: 2,
      stage: { key: "stage1", type: "swiss", teamCount: 16, matchFormat: "bo1" },
      rosterRules: { minTeamSize: capabilities.minTeamSize, maxTeamSize: capabilities.maxTeamSize, starterCount: capabilities.starterCount },
      affiliationRules: [
        {
          institutionCode: NJU_CODE,
          eligibleAcademicStatuses: ["enrolled", "graduated"],
          minRosterMembers: 3,
          minStartingMembers: 3,
        },
      ],
      competitiveProfile: { ...COMPETITIVE_PROFILE, rankOrder: [...COMPETITIVE_PROFILE.rankOrder] },
      tournamentEntrants: [],
      tournamentSeeds: [],
    };
    const runResult = await client.query<{ id: string }>(
      `INSERT INTO major_stage_runs (season_id, stage_key, rule_snapshot, started_by)
       VALUES ($1, 'stage1', $2::jsonb, 'local-admin') RETURNING id`,
      [seasonId, JSON.stringify(ruleSnapshot)],
    );
    const runId = runResult.rows[0]!.id;

    await client.query("COMMIT");

    const memberOf = async (userId: string): Promise<string> => {
      const row = await client.query<{ id: string }>(
        `SELECT id FROM team_members WHERE season_id = $1 AND user_id = $2`,
        [seasonId, userId],
      );
      return row.rows[0]!.id;
    };

    const buildMemberMap = async (offset: number): Promise<Record<string, string>> => {
      const map: Record<string, string> = {};
      for (let logical = 0; logical <= 6; logical += 1) {
        map[logical === 6 ? "out" : String(logical)] = await memberOf(userIds[offset + logical]);
      }
      return map;
    };

    const memberA = await buildMemberMap(0);
    const memberB = await buildMemberMap(7);

    return { seasonId, runId, teamAId: teamIds[0], teamBId: teamIds[1], memberA, memberB };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createManagedMatch(pool: Pool, fixture: RosterSafetyFixture, managedKey: string): Promise<string> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ id: string }>(
      `INSERT INTO matches (
         season_id, team_a_id, team_b_id, stage, round, format, status,
         ownership, major_stage_run_id, managed_key
       ) VALUES ($1, $2, $3, 'stage1', 1, 'bo1', 'scheduled', 'major_stage', $4, $5)
       RETURNING id`,
      [fixture.seasonId, fixture.teamAId, fixture.teamBId, fixture.runId, managedKey],
    );
    return result.rows[0]!.id;
  } finally {
    client.release();
  }
}

async function cleanupFixture(pool: Pool, fixture: RosterSafetyFixture): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM audit_logs WHERE season_id = $1", [fixture.seasonId]);
    await client.query(`DELETE FROM match_roster_players p USING match_rosters r
      WHERE p.roster_id = r.id AND r.match_id IN (SELECT id FROM matches WHERE season_id = $1)`, [fixture.seasonId]);
    await client.query(`DELETE FROM match_rosters WHERE match_id IN (SELECT id FROM matches WHERE season_id = $1)`,
      [fixture.seasonId]);
    await client.query("DELETE FROM matches WHERE season_id = $1", [fixture.seasonId]);
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
      SELECT id FROM users WHERE email LIKE '%' || $1 || '%'
    )`, [fixture.seasonId]);
    await client.query("DELETE FROM users WHERE email LIKE '%' || $1 || '%'", [fixture.seasonId]);
    await client.query("DELETE FROM seasons WHERE id = $1", [fixture.seasonId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function countRosters(client: PoolClient, matchId: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM match_rosters WHERE match_id = $1`,
    [matchId],
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 6 });
  const database = drizzle(pool, { schema });
  let fixture: RosterSafetyFixture | null = null;

  try {
    fixture = await prepareFixture(pool, "g1");
    const { seasonId, teamAId, teamBId, memberA, memberB } = fixture;

    const lineupA = {
      starters: [memberA["0"], memberA["1"], memberA["2"], memberA["3"], memberA["4"]],
    };
    const lineupB = {
      starters: [memberB["0"], memberB["1"], memberB["2"], memberB["3"], memberB["4"]],
    };
    /** Exactly two NJU starters (positions 3–5 are non-NJU roster members). */
    const twoNjuStartersA = [memberA["0"], memberA["1"], memberA["3"], memberA["4"], memberA["5"]];

    // ── MG：主场景比赛 ────────────────────────────────────────────────
    const mgMatch = await createManagedMatch(pool, fixture, "r1-mg");

    // S1 无 roster start → fail 且无任何静默补名单。
    {
      const client = await pool.connect();
      try {
        await expectAppError(
          () => database.transaction((tx) =>
            applyMatchStatusTransitionInTx(tx, { matchId: mgMatch, nextStatus: "in_progress", actorId: ACTOR }),
          ),
          ErrorCode.VALIDATION_FAILED,
          "S1 未提交名单时开始比赛",
        );
        assertCondition((await countRosters(client, mgMatch)) === 0, "S1 失败后不得产生任何隐式补名单");
        assertCondition((await countAudit(client, mgMatch, "match.start")) === 0, "S1 不得写入 match.start 审计");
      } finally {
        client.release();
      }
    }

    // S2/S3/S4/S5/S6/S7 结构与资格校验全部 fail-closed。
    {
      await expectAppError(
        () => submitLineupProductionLogic(database, {
          matchId: mgMatch, teamId: teamAId, source: "participant", submittedBy: null,
          starterIds: lineupA.starters.slice(0, 4), substituteIds: [],
        }),
        ErrorCode.VALIDATION_FAILED,
        "S2 4 人首发",
      );
      await expectAppError(
        () => submitLineupProductionLogic(database, {
          matchId: mgMatch, teamId: teamAId, source: "participant", submittedBy: null,
          starterIds: lineupA.starters, substituteIds: [memberA["5"]!],
        }),
        ErrorCode.VALIDATION_FAILED,
        "S2 Major 不接受替补名单",
      );
      await expectAppError(
        () => submitLineupProductionLogic(database, {
          matchId: mgMatch, teamId: teamAId, source: "participant", submittedBy: null,
          starterIds: [...lineupA.starters, memberA["out"]!], substituteIds: [],
        }),
        ErrorCode.VALIDATION_FAILED,
        "S3 6 人首发",
      );
      await expectAppError(
        () => submitLineupProductionLogic(database, {
          matchId: mgMatch, teamId: teamAId, source: "participant", submittedBy: null,
          starterIds: [lineupA.starters[0]!, lineupA.starters[1]!, lineupA.starters[2]!, lineupA.starters[3]!, randomUUID()],
          substituteIds: [],
        }),
        ErrorCode.VALIDATION_FAILED,
        "S4 非 team_members 选手",
      );
      // Canonical team member present but absent from the frozen tournament roster.
      const outsiderLineup = [...twoNjuStartersA.slice(2), memberA["out"]!, memberA["0"]!, memberA["1"]!];
      const outsiderFailure = await expectAppError(
        () => submitLineupProductionLogic(database, {
          matchId: mgMatch, teamId: teamAId, source: "participant", submittedBy: null,
          starterIds: outsiderLineup, substituteIds: [],
        }),
        ErrorCode.VALIDATION_FAILED,
        "S5 冻结名单外选手",
      );
      assertCondition(outsiderFailure.message.includes("冻结名单"), "S5 需要明确指出冻结名单 blocker");
      const duplicateFailure = await expectAppError(
        () => submitLineupProductionLogic(database, {
          matchId: mgMatch, teamId: teamAId, source: "participant", submittedBy: null,
          starterIds: [memberA["0"]!, memberA["0"]!, memberA["1"]!, memberA["2"]!, memberA["3"]!],
          substituteIds: [],
        }),
        ErrorCode.VALIDATION_FAILED,
        "S6 重复选择队员",
      );
      assertCondition(duplicateFailure.message.includes("重复选择"), "S6 需要明确指出重复 blocker");
      const njuShortfall = await expectAppError(
        () => submitLineupProductionLogic(database, {
          matchId: mgMatch, teamId: teamAId, source: "participant", submittedBy: null,
          starterIds: twoNjuStartersA, substituteIds: [],
        }),
        ErrorCode.VALIDATION_FAILED,
        "S7 NJU 首发不足 3 人",
      );
      assertCondition(njuShortfall.message.includes("南京大学"), "S7 需要给出 NJU 归属 shortfall 文案");
    }

    // S8 admin 选择默认首发但未确认 → start 必须拒绝。
    const adminSelectARoster = (
      await submitLineupProductionLogic(database, {
        matchId: mgMatch, teamId: teamAId, source: "admin_select", submittedBy: null,
        starterIds: lineupA.starters, substituteIds: [],
      })
    ).rosterId;
    const adminSelectBRoster = (
      await submitLineupProductionLogic(database, {
        matchId: mgMatch, teamId: teamBId, source: "admin_select", submittedBy: null,
        starterIds: lineupB.starters, substituteIds: [],
      })
    ).rosterId;
    await expectAppError(
      () => database.transaction((tx) =>
        applyMatchStatusTransitionInTx(tx, { matchId: mgMatch, nextStatus: "in_progress", actorId: ACTOR }),
      ),
      ErrorCode.VALIDATION_FAILED,
      "S8 默认首发未确认就开赛",
    );

    // S9 repeated submit 是幂等覆写（同一 roster 行、无重复行）。
    {
      const resubmitted = await submitLineupProductionLogic(database, {
        matchId: mgMatch, teamId: teamAId, source: "participant", submittedBy: null,
        starterIds: lineupA.starters, substituteIds: [],
      });
      assertCondition(resubmitted.rosterId === adminSelectARoster, "S9 重复提交必须复用同一 roster 行");
      const client = await pool.connect();
      try {
        const players = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM match_roster_players WHERE roster_id = $1`,
          [resubmitted.rosterId],
        );
        assertCondition(Number(players.rows[0]!.count) === 5, "S9 重提交后替补应被替换为空，保留恰好 5 行");
        const sources = await client.query<{ source: string }>(
          `SELECT source FROM match_rosters WHERE id = $1`,
          [resubmitted.rosterId],
        );
        assertCondition(sources.rows[0]!.source === "participant", "S9 参赛方重提交必须把 source 改回 participant");
      } finally {
        client.release();
      }
    }

    // Restore the legal five-starter lineup after the overwrite probe, then confirm both sides.
    await submitLineupProductionLogic(database, {
      matchId: mgMatch, teamId: teamAId, source: "participant", submittedBy: null,
      starterIds: lineupA.starters, substituteIds: [],
    });

    // S10 显式确认 → pass；重复确认幂等且不新增审计。
    {
      const first = await confirmRosterProductionLogic(database, adminSelectARoster);
      assertCondition(!first.alreadyConfirmed, "S10 首次确认应返回 alreadyConfirmed=false");
      const second = await confirmRosterProductionLogic(database, adminSelectARoster);
      assertCondition(second.alreadyConfirmed, "S10 重复确认应为幂等 alreadyConfirmed=true");
      const client = await pool.connect();
      try {
        assertCondition((await countAuditById(client, adminSelectARoster)) === 1, "S10 重复确认不得产生第二条 match.roster.confirm 审计");
      } finally {
        client.release();
      }
      await confirmRosterProductionLogic(database, adminSelectBRoster);
    }

    // S11 合法且 NJU≥3 → start 成功并持久化 canonical roster fact。
    {
      await database.transaction((tx) =>
        applyMatchStatusTransitionInTx(tx, { matchId: mgMatch, nextStatus: "in_progress", actorId: ACTOR }),
      );
      const client = await pool.connect();
      try {
        const statusRow = await client.query<{ status: string }>(`SELECT status FROM matches WHERE id = $1`, [mgMatch]);
        assertCondition(statusRow.rows[0]!.status === "in_progress", "S11 比赛应进入 in_progress");
        assertCondition((await countAudit(client, mgMatch, "match.start")) === 1, "S11 应恰好一条 match.start 审计");
        const auditMeta = await client.query<{ meta: { lineups?: unknown[] } }>(
          `SELECT meta FROM audit_logs WHERE target_id = $1 AND action = 'match.start' LIMIT 1`,
          [mgMatch],
        );
        assertCondition(Array.isArray(auditMeta.rows[0]!.meta?.lineups) && auditMeta.rows[0]!.meta!.lineups!.length === 2,
          "S11 match.start 审计应包含两队首发摘要");
        const confirmedRows = await client.query<{ confirmed_by: string | null; confirmed_at: Date | null }>(
          `SELECT confirmed_by, confirmed_at FROM match_rosters WHERE match_id = $1`,
          [mgMatch],
        );
        assertCondition(confirmedRows.rows.length === 2, "S11 两队各一条 canonical roster fact");
        for (const row of confirmedRows.rows) {
          assertCondition(row.confirmed_by === ACTOR && row.confirmed_at !== null, "S11 确认事实必须持久化 confirmed_by/at");
        }
      } finally {
        client.release();
      }
      // 开赛后所有阵容修改路径必须关闭。
      await expectAppError(
        () => submitLineupProductionLogic(database, {
          matchId: mgMatch, teamId: teamAId, source: "participant", submittedBy: null,
          starterIds: lineupA.starters, substituteIds: [],
        }),
        ErrorCode.MATCH_INVALID_TRANSITION,
        "S11 开赛后禁止再改阵容",
      );
    }

    // S12 mutable season 规则被清空后，frozen StageRun 规则仍然生效。
    {
      const mbMatch = await createManagedMatch(pool, fixture, "r1-mb");
      const client = await pool.connect();
      try {
        // Simulate a legitimate operator mutating the mutable season config.
        await client.query(
          `UPDATE seasons SET affiliation_rules = '[]'::json WHERE id = $1`,
          [seasonId],
        );
        // A lineup that only satisfies the mutated season row must still be
        // rejected against the frozen StageRun snapshot.
        const failure = await expectAppError(
          () => submitLineupProductionLogic(database, {
            matchId: mbMatch, teamId: teamAId, source: "participant", submittedBy: null,
            starterIds: twoNjuStartersA, substituteIds: [],
          }),
          ErrorCode.VALIDATION_FAILED,
          "S12 mutable 规则清空后冻结规则应继续生效",
        );
        assertCondition(failure.message.includes("南京大学"), "S12 必须按冻结快照给出 NJU shortfall 文案");
      } finally {
        client.release();
      }
    }

    // S13 并发 start：行锁串行化，恰好一个事务成功、一个确定性失败。
    {
      const mcMatch = await createManagedMatch(pool, fixture, "r1-mc");
      const mcRosterA = (
        await submitLineupProductionLogic(database, {
          matchId: mcMatch, teamId: teamAId, source: "participant", submittedBy: null,
          starterIds: lineupA.starters, substituteIds: [],
        })
      ).rosterId;
      const mcRosterB = (
        await submitLineupProductionLogic(database, {
          matchId: mcMatch, teamId: teamBId, source: "participant", submittedBy: null,
          starterIds: lineupB.starters, substituteIds: [],
        })
      ).rosterId;
      await database.transaction((tx) =>
        confirmMatchRosterInTx(tx, { rosterId: mcRosterA, actorId: ACTOR }),
      );
      await database.transaction((tx) =>
        confirmMatchRosterInTx(tx, { rosterId: mcRosterB, actorId: ACTOR }),
      );

      const results = await Promise.allSettled([
        database.transaction((tx) =>
          applyMatchStatusTransitionInTx(tx, { matchId: mcMatch, nextStatus: "in_progress", actorId: `${ACTOR}-a` }),
        ),
        database.transaction((tx) =>
          applyMatchStatusTransitionInTx(tx, { matchId: mcMatch, nextStatus: "in_progress", actorId: `${ACTOR}-b` }),
        ),
      ]);
      const fulfilled = results.filter((r): r is PromiseFulfilledResult<MatchTransitionOutcome> => r.status === "fulfilled");
      assertCondition(fulfilled.length === 1, "S13 并发 start 必须恰好一个成功");
      const rejectedReason = results.find((r): r is PromiseRejectedResult => r.status === "rejected")!.reason;
      assertCondition(
        rejectedReason instanceof AppError && rejectedReason.code === ErrorCode.MATCH_INVALID_TRANSITION,
        `S13 失败方必须是确定性的状态机拒绝，实际 ${String(rejectedReason)}`,
      );

      const client = await pool.connect();
      try {
        assertCondition((await countAudit(client, mcMatch, "match.start")) === 1, "S13 只能产生一条 match.start 审计");
        assertCondition((await countRosters(client, mcMatch)) === 2, "S13 不得产生重复 roster 行");
        const statusRow = await client.query<{ status: string }>(`SELECT status FROM matches WHERE id = $1`, [mcMatch]);
        assertCondition(statusRow.rows[0]!.status === "in_progress", "S13 比赛应处于 in_progress");
      } finally {
        client.release();
      }
    }

    console.log("G1 roster safety integration suite passed.");
  } finally {
    if (fixture) await cleanupFixture(pool, fixture);
    await pool.end();
  }
}

async function countAuditById(client: PoolClient, rosterId: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM audit_logs WHERE target_id = $1 AND target_type = 'match_roster' AND action = 'match.roster.confirm'`,
    [rosterId],
  );
  return Number(result.rows[0]?.count ?? "0");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
