/**
 * PR H2 — 赛后裁决、荣誉、确认与归档的真实 PostgreSQL 集成测试。
 *
 * 本套件只使用 loopback Local Supabase，直接驱动生产事务函数：
 * final confirmation / adjudication / honors / archive guard / audit /
 * public serializers。它不运行 Golden Major rehearsal。
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { issueSanctionInTx } from "../../../src/lib/discipline/service";
import { AppError, ErrorCode } from "../../../src/lib/errors";
import { lockMatchInTx } from "../../../src/lib/match-rosters/service";
import {
  archiveTournamentInTx,
  confirmMajorFinalResultInTx,
  createPostEventAdjudicationInTx,
  grantTournamentHonorInTx,
  revokeTournamentHonorInTx,
  serializePostEventAdjudicationPublic,
  serializeTournamentHonorPublic,
} from "../../../src/lib/postevent/service";
import { localDatabaseUrl } from "./harness/database";

const databaseUrl = localDatabaseUrl();

const ACTOR = "local-admin-h2";

async function expectAppError(work: () => Promise<unknown>, code: ErrorCode, message: string): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (error instanceof AppError && error.code === code) return;
    throw error;
  }
  throw new Error(message);
}

interface Fixture {
  seasonId: string;
  runId: string;
  resultId: string;
  matchId: string;
  championId: string;
  runnerUpId: string;
  thirdId: string;
  userId: string;
}

async function prepareFixture(pool: Pool): Promise<Fixture> {
  const seasonId = randomUUID();
  const runId = randomUUID();
  const championId = randomUUID();
  const runnerUpId = randomUUID();
  const thirdId = randomUUID();
  const placementEntryIds = [
    championId,
    runnerUpId,
    thirdId,
    ...Array.from({ length: 29 }, () => randomUUID()),
  ];
  const userId = randomUUID();
  const resultId = randomUUID();
  const matchId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft, stage_plan, registration_config, team_registration_config, affiliation_rules, min_team_size, max_team_size, starter_count, positions)
       VALUES ($1, $2, 'Local Post-event', 'Major', 'playing', 'team', false, false, '[]'::json, '{}'::json, '{}'::json, '[]'::json, 5, 7, 5, ARRAY['igl','awper','opener','closer','anchor'])`,
      [seasonId, `local-postevent-${seasonId}`],
    );
    await client.query(`INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now())`, [userId, `h2-${userId}@local.test`]);
    // Champion / runner-up / third identities are CompetitionEntries; the single
    // fixture user acts as their representative since no lineup flow runs here.
    for (const [index, id] of placementEntryIds.entries()) {
      const name = index === 0 ? "Champion Entry" : index === 1 ? "Runner-up Entry" : index === 2 ? "Third Entry" : `Placement Entry ${index + 1}`;
      const revisionId = randomUUID();
      await client.query(`INSERT INTO competition_entries (id, competition_id, source, name, representative_user_id, current_roster_revision_id, approved_roster_revision_id, registration_status) VALUES ($1, $2, 'event_native', $3, $4, $5, $5, 'approved')`, [id, seasonId, name, userId, revisionId]);
      await client.query("INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id) VALUES ($1, NULL, $2, 'local-admin')", [id, userId]);
      await client.query("INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by, approved_at) VALUES ($1, $2, 1, 'approved', 'local-admin', now())", [revisionId, id]);
    }
    await client.query(
      `INSERT INTO major_stage_runs (id, season_id, stage_key, rule_snapshot, started_by)
       VALUES ($1, $2, 'playoff', '{}'::jsonb, $3)`,
      [runId, seasonId, ACTOR],
    );
    await client.query(
      `INSERT INTO matches (id, season_id, entry_a_id, entry_b_id, stage, entry_round, format, status, score_a, score_b, completed_at, ownership, major_stage_run_id, managed_key)
       VALUES ($1, $2, $3, $4, 'playoff', 'final', 'bo5', 'finished', 3, 1, now(), 'major_stage', $5, 'final-1')`,
      [matchId, seasonId, championId, runnerUpId, runId],
    );
    await client.query(
      `INSERT INTO major_final_results (id, season_id, playoff_stage_run_id, champion_entry_id, placement_groups, status, finalized_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'pending_confirmation', $6)`,
      [resultId, seasonId, runId, championId, JSON.stringify([
        { from: 1, to: 1, entryIds: [placementEntryIds[0]!] },
        { from: 2, to: 2, entryIds: [placementEntryIds[1]!] },
        { from: 3, to: 4, entryIds: placementEntryIds.slice(2, 4) },
        { from: 5, to: 32, entryIds: placementEntryIds.slice(4) },
      ]), ACTOR],
    );
    await client.query("COMMIT");
    return { seasonId, runId, resultId, matchId, championId, runnerUpId, thirdId, userId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cleanup(pool: Pool, fixture: Fixture): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM audit_logs WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM tournament_honors WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM post_event_adjudications WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM disciplinary_cases WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_final_results WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM matches WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_stage_runs WHERE season_id = $1", [fixture.seasonId]);
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query("DELETE FROM competition_entry_roster_revisions WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = $1)", [fixture.seasonId]);
    await client.query("DELETE FROM competition_entry_representative_changes WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = $1)", [fixture.seasonId]);
    await client.query("DELETE FROM competition_entries WHERE competition_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM users WHERE id = $1", [fixture.userId]);
    await client.query("DELETE FROM seasons WHERE id = $1", [fixture.seasonId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 5 });
  const database = drizzle(pool, { schema });
  let fixture: Fixture | null = null;
  try {
    fixture = await prepareFixture(pool);
    const f = fixture;

    const rls = await pool.query<{ table_name: string; rls: boolean; anon_can_select: boolean; authenticated_can_select: boolean }>(
      `SELECT c.relname AS table_name, c.relrowsecurity AS rls,
              has_table_privilege('anon', c.oid, 'select') AS anon_can_select,
              has_table_privilege('authenticated', c.oid, 'select') AS authenticated_can_select
       FROM pg_class c WHERE c.relname IN ('post_event_adjudications', 'tournament_honors') ORDER BY c.relname`,
    );
    expect(rls.rows.length === 2 && rls.rows.every((row) => row.rls && !row.anon_can_select && !row.authenticated_can_select),  "H2 RLS 必须启用且 anon/authenticated 默认无权读取赛后事实。").toBe(true);

    // 1–2: pending → confirmed; repeated confirmation produces no duplicate audit.
    const firstConfirmation = await database.transaction((tx) => confirmMajorFinalResultInTx(tx, { seasonId: f.seasonId, actorId: ACTOR }));
    expect(!firstConfirmation.alreadyConfirmed,  "P1 首次最终结果确认必须改变 pending 状态。").toBe(true);
    const repeatedConfirmation = await database.transaction((tx) => confirmMajorFinalResultInTx(tx, { seasonId: f.seasonId, actorId: ACTOR }));
    expect(repeatedConfirmation.alreadyConfirmed && repeatedConfirmation.resultId === f.resultId,  "P2 重复确认必须幂等返回同一结果。").toBe(true);

    // 3–6: explicit Champion + Runner-up honors; revoke does not promote anyone.
    const championRequestId = randomUUID();
    const championHonor = await database.transaction((tx) => grantTournamentHonorInTx(tx, {
      seasonId: f.seasonId, clientRequestId: championRequestId, type: "champion", label: "Champion", basis: "final_result", entryId: f.championId, actorId: ACTOR,
    }));
    const repeatedChampionHonor = await database.transaction((tx) => grantTournamentHonorInTx(tx, {
      seasonId: f.seasonId, clientRequestId: championRequestId, type: "champion", label: "Champion", basis: "final_result", entryId: f.championId, actorId: ACTOR,
    }));
    expect(!repeatedChampionHonor.created && repeatedChampionHonor.honorId === championHonor.honorId,  "P3 荣誉授予重试必须命中相同的结构性幂等事实。").toBe(true);
    const runnerUpHonor = await database.transaction((tx) => grantTournamentHonorInTx(tx, {
      seasonId: f.seasonId, clientRequestId: randomUUID(), type: "runner_up", label: "Runner-up", basis: "final_result", entryId: f.runnerUpId, actorId: ACTOR,
    }));
    const revokeChampion = await database.transaction((tx) => revokeTournamentHonorInTx(tx, { honorId: championHonor.honorId, actorId: ACTOR, reason: "explicit revocation" }));
    expect(!revokeChampion.alreadyRevoked,  "P4 首次冠军撤销必须生效。").toBe(true);
    const honorState = await pool.query<{ champion: string; runner_up: string }>(
      `SELECT
         (SELECT state::text FROM tournament_honors WHERE id = $1) AS champion,
         (SELECT state::text FROM tournament_honors WHERE id = $2) AS runner_up`,
      [championHonor.honorId, runnerUpHonor.honorId],
    );
    expect(honorState.rows[0]?.champion === "revoked",  "P4 冠军荣誉必须保留 revoked provenance。").toBe(true);
    expect(honorState.rows[0]?.runner_up === "valid",  "P5 Runner-up 必须仍为 Runner-up。").toBe(true);
    const automaticPromotion = await pool.query(`SELECT id FROM tournament_honors WHERE season_id = $1 AND honor_key = 'champion' AND state = 'valid'`, [f.seasonId]);
    expect(automaticPromotion.rowCount === 0,  "P6 不得自动授予新的 Champion。").toBe(true);

    // 7–9: manual award lifecycle also never creates a replacement.
    const manualHonor = await database.transaction((tx) => grantTournamentHonorInTx(tx, {
      seasonId: f.seasonId, clientRequestId: randomUUID(), type: "manual_award", label: "Fair Play", honorKey: "fair-play", basis: "manual", entryId: f.thirdId, actorId: ACTOR,
    }));
    await database.transaction((tx) => revokeTournamentHonorInTx(tx, { honorId: manualHonor.honorId, actorId: ACTOR, reason: "manual withdrawal" }));
    const manualState = await pool.query(`SELECT state::text FROM tournament_honors WHERE id = $1`, [manualHonor.honorId]);
    expect(manualState.rows[0]?.state === "revoked",  "P8 手动奖项必须可撤销。").toBe(true);
    expect((await pool.query(`SELECT id FROM tournament_honors WHERE season_id = $1 AND honor_key = 'manual:fair-play' AND state = 'valid'`, [f.seasonId])).rowCount === 0,  "P9 不得自动补发手动奖项。").toBe(true);

    // 10–13: H1 personal case and explicit team adjudication cannot rewrite independent historical facts.
    const beforeFacts = await pool.query<{ placements: string; honors: string; score_a: number; score_b: number }>(
      `SELECT (SELECT placement_groups::text FROM major_final_results WHERE id = $1) AS placements,
              (SELECT json_agg(json_build_object('id', id, 'state', state::text) ORDER BY id)::text FROM tournament_honors WHERE season_id = $2) AS honors,
              (SELECT score_a FROM matches WHERE id = $3) AS score_a,
              (SELECT score_b FROM matches WHERE id = $3) AS score_b`,
      [f.resultId, f.seasonId, f.matchId],
    );
    await database.transaction((tx) => issueSanctionInTx(tx, {
      seasonId: f.seasonId, subjectUserId: f.userId, effects: ["roster_block"], internalEvidence: "private H1 proof", publicExplanation: "personal only", actorId: ACTOR,
    }));
    const afterPersonalSanction = await pool.query<{ honors: string }>(
      `SELECT json_agg(json_build_object('id', id, 'state', state::text) ORDER BY id)::text AS honors FROM tournament_honors WHERE season_id = $1`,
      [f.seasonId],
    );
    expect(beforeFacts.rows[0]?.honors === afterPersonalSanction.rows[0]?.honors,  "P11 个人 H1 sanction 不得改写 honors。").toBe(true);
    const ruling = await database.transaction((tx) => createPostEventAdjudicationInTx(tx, {
      seasonId: f.seasonId, clientRequestId: randomUUID(), kind: "team_sanction", target: "entry", targetEntryId: f.thirdId,
      impacts: ["honors"], reason: "team ruling", publicExplanation: "public team ruling", internalEvidence: "private ruling proof", actorId: ACTOR,
    }));
    const rulingHonor = await database.transaction((tx) => grantTournamentHonorInTx(tx, {
      seasonId: f.seasonId, clientRequestId: randomUUID(), type: "manual_award", label: "Explicit ruling award", honorKey: "ruling-award", basis: "adjudication", entryId: f.thirdId, adjudicationId: ruling.adjudicationId, actorId: ACTOR,
    }));
    const afterFacts = await pool.query<{ placements: string; score_a: number; score_b: number }>(
      `SELECT (SELECT placement_groups::text FROM major_final_results WHERE id = $1) AS placements,
              (SELECT score_a FROM matches WHERE id = $2) AS score_a,
              (SELECT score_b FROM matches WHERE id = $2) AS score_b`,
      [f.resultId, f.matchId],
    );
    expect(beforeFacts.rows[0]?.placements === afterFacts.rows[0]?.placements,  "P10/P12 个人处罚与队伍裁决不得改写 placements。").toBe(true);
    expect(beforeFacts.rows[0]?.score_a === afterFacts.rows[0]?.score_a && beforeFacts.rows[0]?.score_b === afterFacts.rows[0]?.score_b,  "P13 赛后事实不得改写 historical matches。").toBe(true);
    expect(rulingHonor.created,  "P12 只有显式关联 honors 的裁决才可创建明确的新荣誉事实。").toBe(true);

    // 19: public serializer is intentionally unable to leak internal evidence.
    const [rulingRow] = await database.select().from(schema.postEventAdjudications).where(eq(schema.postEventAdjudications.id, ruling.adjudicationId));
    const [honorRow] = await database.select().from(schema.tournamentHonors).where(eq(schema.tournamentHonors.id, rulingHonor.honorId));
    expect(!JSON.stringify(serializePostEventAdjudicationPublic(rulingRow!)).includes("private ruling proof"),  "P19 裁决公开序列化不得泄露内部证据。").toBe(true);
    expect(!JSON.stringify(serializeTournamentHonorPublic(honorRow!)).includes("private"),  "P19 荣誉公开序列化不得泄露私有字段。").toBe(true);

    // 14–18: archive is idempotent; ordinary match mutation blocks, specialized post-event remains allowed.
    const firstArchive = await database.transaction((tx) => archiveTournamentInTx(tx, { seasonId: f.seasonId, actorId: ACTOR }));
    expect(!firstArchive.alreadyArchived,  "P14 归档必须成功。").toBe(true);
    const secondArchive = await database.transaction((tx) => archiveTournamentInTx(tx, { seasonId: f.seasonId, actorId: ACTOR }));
    expect(secondArchive.alreadyArchived,  "P15 重复归档必须幂等。").toBe(true);
    await expectAppError(
      () => database.transaction((tx) => lockMatchInTx(tx, f.matchId)),
      ErrorCode.VALIDATION_FAILED,
      "P16 归档后普通比赛变更路径必须被 guard 阻断。",
    );
    const postArchiveRuling = await database.transaction((tx) => createPostEventAdjudicationInTx(tx, {
      seasonId: f.seasonId, clientRequestId: randomUUID(), kind: "placement_statement", target: "season", impacts: ["official_placements"], reason: "archived ruling", publicExplanation: "archived public ruling", actorId: ACTOR,
    }));
    expect(postArchiveRuling.created,  "P17 归档后专用赛后裁决必须允许。").toBe(true);
    const postArchiveRevoke = await database.transaction((tx) => revokeTournamentHonorInTx(tx, { honorId: rulingHonor.honorId, actorId: ACTOR, reason: "archived revocation" }));
    expect(!postArchiveRevoke.alreadyRevoked,  "P18 归档后专用荣誉撤销必须允许。").toBe(true);

    // 20: each meaningful mutation has an audit entry; idempotent retries do not add duplicate transition audit.
    const audit = await pool.query<{ action: string; count: string }>(
      `SELECT action, count(*)::text AS count FROM audit_logs WHERE season_id = $1 GROUP BY action`, [f.seasonId],
    );
    const auditCounts = new Map(audit.rows.map((row) => [row.action, Number(row.count)]));
    for (const action of ["major.result.confirm", "postevent.honor.grant", "postevent.honor.revoke", "sanction.issue", "postevent.adjudication.create", "major.archive"]) {
      expect((auditCounts.get(action) ?? 0) >= 1,  `P20 缺少审计：${action}`).toBe(true);
    }
    expect(auditCounts.get("major.result.confirm") === 1,  "P20 幂等确认不得重复写审计。").toBe(true);
    console.log("H2 post-event Local PostgreSQL integration passed (P1–P20).");
  } finally {
    if (fixture) await cleanup(pool, fixture);
    await pool.end();
  }
}

describe("post-event PostgreSQL invariants", () => {
  it("keeps confirmation, adjudication, honors, audits, and archive boundaries atomic", async () => {
    await main();
  });
});
