import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { createMajor24Capabilities } from "../../../src/lib/competition/templates";
import { createPerfectWorldRankOrder } from "../../../src/lib/config/perfect-world";
import {
  completeCompetitionQualificationIfReadyInTx,
  configureCompetitionQualificationRunInTx,
  generateCompetitionQualificationRoundInTx,
  getCompetitionQualificationFinalEntryIdsInTx,
  previewCompetitionQualificationRoundInTx,
  saveCompetitionQualificationRankInTx,
} from "../../../src/lib/competition-qualification/runtime";
import { reviewCompetitionEntryInTx, submitCompetitionEntryInTx } from "../../../src/lib/competition-entries/commands";
import { requestCompetitionEntryRosterChangeInTx } from "../../../src/lib/competition-entries/roster-change";
import { confirmMatchRosterInTx, persistMatchRosterInTx } from "../../../src/lib/match-rosters/service";
import { selectMajorEntrantsAndSyncRostersInTx } from "../../../src/lib/major/prestart-entrants";
import { localDatabaseUrl, testSteam64 } from "./harness/database";

const databaseUrl = localDatabaseUrl();
const ACTOR = "issue-743-qualification-acceptance-admin";
const NJU_CODE = "4132010284";
const PROFILE = {
  platform: "perfect_world",
  currentSeasonKey: "issue-743-qualification-current",
  previousSeasonKey: "issue-743-qualification-previous",
  rankOrder: createPerfectWorldRankOrder(),
} as const;
type Database = ReturnType<typeof drizzle<typeof schema>>;

interface AcceptanceEntry {
  entryId: string;
  revisionId: string;
  userIds: string[];
}

interface AcceptanceFixture {
  seasonId: string;
  entries: AcceptanceEntry[];
  allUserIds: string[];
}

function insertValues(rows: readonly (readonly unknown[])[]): { placeholders: string; values: unknown[] } {
  const values = rows.flat();
  let parameter = 0;
  const placeholders = rows.map((row) => `(${row.map(() => `$${++parameter}`).join(", ")})`).join(", ");
  return { placeholders, values };
}

async function prepareAcceptanceFixture(pool: Pool): Promise<AcceptanceFixture> {
  const client = await pool.connect();
  const seasonId = randomUUID();
  const capabilities = createMajor24Capabilities();
  capabilities.teamRegistrationConfig.competitiveProfile = {
    ...PROFILE,
    rankOrder: [...PROFILE.rankOrder],
  };
  const entries: AcceptanceEntry[] = Array.from({ length: 30 }, () => ({
    entryId: randomUUID(),
    revisionId: randomUUID(),
    userIds: Array.from({ length: 7 }, () => randomUUID()),
  }));
  const allUserIds = entries.flatMap((entry) => entry.userIds);

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO seasons (
        id, slug, name, kind, competition_template, status, registration_mode, has_captain_voting, has_draft,
        stage_plan, registration_config, team_registration_config, affiliation_rules,
        min_team_size, max_team_size, starter_count, positions,
        registration_opens_at, registration_opened_at, registration_closes_at, roster_change_closes_at
      ) VALUES ($1, $2, 'Issue 743 30 to 24 Acceptance', 'Major', 'major', 'registration', $3, $4, $5, $6::json, $7::json, $8::json, $9::json, $10, $11, $12, $13::text[], now() - interval '2 days', now() - interval '2 days', now() - interval '1 minute', now() + interval '1 day')`,
      [
        seasonId,
        `local-issue-743-qualification-${seasonId}`,
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

    const users = allUserIds.map((userId, index) => [
      userId,
      `issue-743-${index}-${seasonId}@local.test`,
      `Issue 743 Player ${index}`,
      `Issue 743 Perfect ${index}`,
      testSteam64(userId),
      String(74300000 + index),
    ]);
    const usersSql = insertValues(users);
    await client.query(
      `INSERT INTO users (id, email, email_verified_at, display_name, perfect_name, steam64, qq)
       SELECT v.id::uuid, v.email, now(), v.display_name, v.perfect_name, v.steam64, v.qq
       FROM (VALUES ${usersSql.placeholders}) AS v(id, email, display_name, perfect_name, steam64, qq)`,
      usersSql.values,
    );

    const rankFacts = allUserIds.flatMap((userId) => [
      [randomUUID(), userId, PROFILE.platform, "historical_peak", null, "A", 1000, 10],
      [randomUUID(), userId, PROFILE.platform, "season_peak", PROFILE.previousSeasonKey, "A", 1000, 10],
      [randomUUID(), userId, PROFILE.platform, "season_peak", PROFILE.currentSeasonKey, "A", 1000, 10],
    ]);
    const rankSql = insertValues(rankFacts);
    await client.query(
      `INSERT INTO competitive_rank_facts (id, user_id, platform, kind, platform_season_key, rank, rating, stars)
       VALUES ${rankSql.placeholders}`,
      rankSql.values,
    );

    const educationRows = allUserIds.map((userId) => [randomUUID(), userId]);
    const educationSql = insertValues(educationRows);
    await client.query(
      `INSERT INTO education_verifications (id, user_id, institution_id, academic_status, evidence_type, status, reviewed_by, reviewed_at)
       SELECT v.id::uuid, v.user_id::uuid, i.id, 'enrolled', 'manual_other', 'approved', $${educationSql.values.length + 1}, now()
       FROM (VALUES ${educationSql.placeholders}) AS v(id, user_id)
       CROSS JOIN institutions i
       WHERE i.moe_institution_code = $${educationSql.values.length + 2}`,
      [...educationSql.values, ACTOR, NJU_CODE],
    );
    const educationCount = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM education_verifications WHERE user_id = ANY($1::uuid[])",
      [allUserIds],
    );
    if (Number(educationCount.rows[0]?.count) !== allUserIds.length) throw new Error("fixture requires the seeded NJU institution directory");

    const entryRows = entries.map((entry, index) => [
      entry.entryId,
      seasonId,
      `Issue 743 Entry ${String(index + 1).padStart(2, "0")}`,
      `https://local.test/${entry.entryId}.png`,
      entry.userIds[0],
      `fixture-${entry.entryId}`,
      entry.revisionId,
    ]);
    const entrySql = insertValues(entryRows);
    await client.query(
      `INSERT INTO competition_entries (
         id, competition_id, source, name, logo_url, representative_user_id, perfect_team_id,
         current_roster_revision_id, approved_roster_revision_id, registration_status, submitted_at, reviewed_at
       ) SELECT v.id::uuid, v.competition_id::uuid, 'event_native', v.name, v.logo_url, v.representative_user_id::uuid,
                v.perfect_team_id, v.revision_id::uuid, v.revision_id::uuid, 'approved', now(), now()
         FROM (VALUES ${entrySql.placeholders}) AS v(id, competition_id, name, logo_url, representative_user_id, perfect_team_id, revision_id)`,
      entrySql.values,
    );

    const participantRows = entries.flatMap((entry) => entry.userIds.map((userId) => [entry.entryId, userId, entry.userIds[0]]));
    const participantsSql = insertValues(participantRows);
    await client.query(
      `INSERT INTO competition_entry_participants (entry_id, user_id, status, confirmed_at, invited_by_user_id)
       SELECT v.entry_id::uuid, v.user_id::uuid, 'confirmed', now(), v.invited_by_user_id::uuid
       FROM (VALUES ${participantsSql.placeholders}) AS v(entry_id, user_id, invited_by_user_id)`,
      participantsSql.values,
    );

    const revisionRows = entries.map((entry) => [entry.revisionId, entry.entryId, 1, ACTOR]);
    const revisionSql = insertValues(revisionRows);
    await client.query(
      `INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by, approved_at)
       SELECT v.id::uuid, v.entry_id::uuid, v.revision_number::int, 'approved', v.created_by, now()
       FROM (VALUES ${revisionSql.placeholders}) AS v(id, entry_id, revision_number, created_by)`,
      revisionSql.values,
    );

    const rosterRows = entries.flatMap((entry) => entry.userIds.slice(0, 5).map((userId, index) => [
      entry.entryId,
      entry.revisionId,
      userId,
      index < 5,
    ]));
    const rosterSql = insertValues(rosterRows);
    await client.query(
      `INSERT INTO competition_entry_roster_members (revision_id, participant_id, user_id, is_primary_starter)
       SELECT v.revision_id::uuid, p.id, v.user_id::uuid, v.is_primary::boolean
       FROM (VALUES ${rosterSql.placeholders}) AS v(entry_id, revision_id, user_id, is_primary)
       JOIN competition_entry_participants p ON p.entry_id = v.entry_id::uuid AND p.user_id = v.user_id::uuid`,
      rosterSql.values,
    );
    const representativeRows = entries.map((entry) => [entry.entryId, entry.userIds[0]]);
    const representativesSql = insertValues(representativeRows);
    await client.query(
      `INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id)
       SELECT v.entry_id::uuid, NULL, v.user_id::uuid, $${representativesSql.values.length + 1}
       FROM (VALUES ${representativesSql.placeholders}) AS v(entry_id, user_id)`,
      [...representativesSql.values, ACTOR],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { seasonId, entries, allUserIds };
}

async function persistAndConfirmLineup(database: Database, matchId: string, entryId: string): Promise<string[]> {
  return database.transaction(async (tx) => {
    const [match] = await tx.select().from(schema.matches).where(eq(schema.matches.id, matchId));
    if (!match) throw new Error(`acceptance match missing: ${matchId}`);
    const members = await tx.select({ id: schema.eventRosterMembers.id, userId: schema.eventRosterMembers.userId })
      .from(schema.eventRosterMembers)
      .innerJoin(schema.eventRosters, eq(schema.eventRosters.id, schema.eventRosterMembers.eventRosterId))
      .where(and(eq(schema.eventRosters.entryId, entryId), eq(schema.eventRosterMembers.isCurrent, true)));
    if (members.length < 5) throw new Error(`entry ${entryId} has no current five-player roster`);
    const starterIds = members.slice(0, 5).map((member) => member.id);
    await persistMatchRosterInTx(tx, {
      match,
      entryId,
      submittedBy: null,
      source: "admin_select",
      starterIds,
    });
    const [roster] = await tx.select({ id: schema.matchRosters.id }).from(schema.matchRosters)
      .where(and(eq(schema.matchRosters.matchId, matchId), eq(schema.matchRosters.entryId, entryId)));
    if (!roster) throw new Error("persisted match roster missing");
    await confirmMatchRosterInTx(tx, { rosterId: roster.id, actorId: ACTOR });
    return members.slice(0, 5).map((member) => member.userId);
  });
}

async function prepareAndApproveRosterV2(database: Database, entry: AcceptanceEntry): Promise<string> {
  const memberUserIds = [...entry.userIds.slice(0, 4), entry.userIds[5]!];
  const revisionId = await database.transaction(async (tx) => {
    await requestCompetitionEntryRosterChangeInTx(tx, {
      entryId: entry.entryId,
      representativeUserId: entry.userIds[0]!,
      actorId: ACTOR,
    });
    const [currentEntry] = await tx.select({ revisionId: schema.competitionEntries.currentRosterRevisionId })
      .from(schema.competitionEntries).where(eq(schema.competitionEntries.id, entry.entryId));
    if (!currentEntry) throw new Error("roster v2 draft missing");
    const participants = await tx.select({ id: schema.competitionEntryParticipants.id, userId: schema.competitionEntryParticipants.userId })
      .from(schema.competitionEntryParticipants).where(eq(schema.competitionEntryParticipants.entryId, entry.entryId));
    const participantByUserId = new Map(participants.map((participant) => [participant.userId, participant.id]));
    await tx.delete(schema.competitionEntryRosterMembers).where(eq(schema.competitionEntryRosterMembers.revisionId, currentEntry.revisionId));
    await tx.insert(schema.competitionEntryRosterMembers).values(memberUserIds.map((userId) => {
      const participantId = participantByUserId.get(userId);
      if (!participantId) throw new Error(`roster v2 participant missing: ${userId}`);
      return { revisionId: currentEntry.revisionId, participantId, userId, isPrimaryStarter: true };
    }));
    await submitCompetitionEntryInTx(tx, { entryId: entry.entryId, userId: entry.userIds[0]!, actorId: ACTOR });
    return currentEntry.revisionId;
  });
  await database.transaction((tx) => reviewCompetitionEntryInTx(tx, {
    entryId: entry.entryId,
    decision: "approved",
    actorId: ACTOR,
  }));
  return revisionId;
}

async function finishRound(pool: Pool, database: Database, runId: string, round: number): Promise<void> {
  await pool.query(
    `UPDATE matches
     SET status = 'finished', score_a = 1, score_b = 0, completed_at = now(), updated_at = now()
     WHERE qualification_run_id = $1 AND round = $2`,
    [runId, round],
  );
  await database.transaction((tx) => completeCompetitionQualificationIfReadyInTx(tx, runId));
}

async function cleanupAcceptanceFixture(pool: Pool, fixture: AcceptanceFixture): Promise<void> {
  const client = await pool.connect();
  const entryIds = fixture.entries.map((entry) => entry.entryId);
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query("DELETE FROM audit_logs WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM match_roster_players WHERE roster_id IN (SELECT id FROM match_rosters WHERE match_id IN (SELECT id FROM matches WHERE season_id = $1))", [fixture.seasonId]);
    await client.query("DELETE FROM match_rosters WHERE match_id IN (SELECT id FROM matches WHERE season_id = $1)", [fixture.seasonId]);
    await client.query("DELETE FROM matches WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM competition_qualification_entrants WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM competition_qualification_runs WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_tournament_seeds WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_tournament_entrants WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_seed_recommendation_snapshots WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_prestart_states WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM event_roster_members WHERE event_roster_id IN (SELECT id FROM event_rosters WHERE entry_id = ANY($1::uuid[]))", [entryIds]);
    await client.query("DELETE FROM event_rosters WHERE entry_id = ANY($1::uuid[])", [entryIds]);
    await client.query("DELETE FROM competition_entry_representative_changes WHERE entry_id = ANY($1::uuid[])", [entryIds]);
    await client.query("DELETE FROM competition_entry_roster_members WHERE revision_id IN (SELECT id FROM competition_entry_roster_revisions WHERE entry_id = ANY($1::uuid[]))", [entryIds]);
    await client.query("DELETE FROM competition_entry_roster_revisions WHERE entry_id = ANY($1::uuid[])", [entryIds]);
    await client.query("DELETE FROM competition_entry_participants WHERE entry_id = ANY($1::uuid[])", [entryIds]);
    await client.query("DELETE FROM competition_entries WHERE id = ANY($1::uuid[])", [entryIds]);
    await client.query("DELETE FROM competitive_rank_facts WHERE user_id = ANY($1::uuid[])", [fixture.allUserIds]);
    await client.query("DELETE FROM education_verifications WHERE user_id = ANY($1::uuid[])", [fixture.allUserIds]);
    await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [fixture.allUserIds]);
    await client.query("DELETE FROM seasons WHERE id = $1", [fixture.seasonId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function exerciseThirtyToTwentyFourAcceptance(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 4 });
  const database = drizzle(pool, { schema });
  let fixture: AcceptanceFixture | undefined;
  try {
    fixture = await prepareAcceptanceFixture(pool);
    const preliminaryOrderEntryIds = fixture.entries.map((entry) => entry.entryId);
    const configured = await database.transaction((tx) => configureCompetitionQualificationRunInTx(tx, {
      seasonId: fixture!.seasonId,
      actorId: ACTOR,
      format: "short_swiss_2w2l",
      preliminaryOrderEntryIds,
    }));
    expect(configured).toMatchObject({ directEntryCount: 18, playInEntryCount: 12, qualifierCount: 6 });

    const runId = configured.runId;
    let historicalEntryId = "";
    let firstRoundId = "";
    let secondRoundId = "";
    let revisionOneUsers: string[] = [];
    let revisionTwoUsers: string[] = [];
    for (const [roundIndex, expectedMatchCount] of [6, 6, 3].entries()) {
      const round = roundIndex + 1;
      let preview = await database.transaction((tx) => previewCompetitionQualificationRoundInTx(tx, {
        seasonId: fixture!.seasonId,
        runId,
      }));
      expect(preview).toMatchObject({ round, format: "bo1" });
      expect(preview.matchups).toHaveLength(expectedMatchCount);
      if (round === 1) {
        await database.transaction((tx) => saveCompetitionQualificationRankInTx(tx, {
          seasonId: fixture!.seasonId,
          entryId: preliminaryOrderEntryIds[18]!,
          nextRank: 20,
          actorId: ACTOR,
        }));
        await expect(database.transaction((tx) => generateCompetitionQualificationRoundInTx(tx, {
          seasonId: fixture!.seasonId,
          runId,
          actorId: ACTOR,
          expectedPairings: preview.matchups.map(({ higherSeedTeamId, lowerSeedTeamId }) => ({ higherSeedTeamId, lowerSeedTeamId })),
        }))).rejects.toThrow("轮次对阵已变化");
        preview = await database.transaction((tx) => previewCompetitionQualificationRoundInTx(tx, {
          seasonId: fixture!.seasonId,
          runId,
        }));
      }
      const created = await database.transaction((tx) => generateCompetitionQualificationRoundInTx(tx, {
        seasonId: fixture!.seasonId,
        runId,
        actorId: ACTOR,
        expectedPairings: preview.matchups.map(({ higherSeedTeamId, lowerSeedTeamId }) => ({ higherSeedTeamId, lowerSeedTeamId })),
      }));
      expect(created).toMatchObject({ round, matchCount: expectedMatchCount, created: true });
      const roundMatches = await database.select().from(schema.matches)
        .where(and(eq(schema.matches.qualificationRunId, runId), eq(schema.matches.round, round)));
      expect(roundMatches).toHaveLength(expectedMatchCount);
      expect(roundMatches.every((match) => match.stage === "play-in" && match.ownership === "manual" && match.majorStageRunId === null)).toBe(true);

      if (round === 1) {
        const historicalMatch = roundMatches[0]!;
        historicalEntryId = historicalMatch.entryAId;
        firstRoundId = historicalMatch.id;
        revisionOneUsers = await persistAndConfirmLineup(database, historicalMatch.id, historicalEntryId);
      }

      if (round === 2) {
        const roundTwoMatch = roundMatches.find((match) => match.entryAId === historicalEntryId || match.entryBId === historicalEntryId);
        if (!roundTwoMatch) throw new Error("R2 match for revised entry missing");
        secondRoundId = roundTwoMatch.id;
        revisionTwoUsers = await persistAndConfirmLineup(database, roundTwoMatch.id, historicalEntryId);
        expect(revisionTwoUsers).not.toEqual(revisionOneUsers);
      }

      await finishRound(pool, database, runId, round);

      if (round === 1) {
        const historicalEntry = fixture.entries.find((entry) => entry.entryId === historicalEntryId);
        if (!historicalEntry) throw new Error("R1 entry not found in fixture");
        const approvedRevisionTwo = await prepareAndApproveRosterV2(database, historicalEntry);
        const rosterHistory = await pool.query<{ current: boolean; revisionId: string; userId: string }>(
          `SELECT erm.is_current AS current, er.source_roster_revision_id AS "revisionId", erm.user_id AS "userId"
           FROM event_roster_members erm
           JOIN event_rosters er ON er.id = erm.event_roster_id
           WHERE er.entry_id = $1
           ORDER BY erm.is_current DESC, erm.user_id`,
          [historicalEntryId],
        );
        expect(new Set(rosterHistory.rows.filter((row) => row.current).map((row) => row.revisionId))).toEqual(new Set([approvedRevisionTwo]));
        expect(rosterHistory.rows.some((row) => !row.current && revisionOneUsers.includes(row.userId))).toBe(true);

        const roundTwoPreview = await database.transaction((tx) => previewCompetitionQualificationRoundInTx(tx, {
          seasonId: fixture!.seasonId,
          runId,
        }));
        expect(roundTwoPreview.matchups.some((matchup) => matchup.higherSeedTeamId === historicalEntryId || matchup.lowerSeedTeamId === historicalEntryId)).toBe(true);
      }

    }

    const [completedRun] = await database.select().from(schema.competitionQualificationRuns)
      .where(eq(schema.competitionQualificationRuns.id, runId));
    expect(completedRun?.completedAt).toBeInstanceOf(Date);
    const finalEntryIds = await database.transaction((tx) => getCompetitionQualificationFinalEntryIdsInTx(tx, completedRun!));
    expect(finalEntryIds).toHaveLength(24);
    expect(new Set(finalEntryIds).size).toBe(24);
    expect(finalEntryIds.slice(0, 18)).toEqual(preliminaryOrderEntryIds.slice(0, 18));

    const selected = await database.transaction((tx) => selectMajorEntrantsAndSyncRostersInTx(tx, {
      seasonId: fixture!.seasonId,
      competitionEntryIds: finalEntryIds,
      actorId: ACTOR,
    }));
    expect(selected).toMatchObject({ selectedCount: 24, changed: true });
    const selectedRows = await pool.query<{ count: string; confirmedRosters: string }>(
      `SELECT count(*)::text AS count,
              (SELECT count(*)::text FROM event_rosters WHERE entry_id IN (SELECT competition_entry_id FROM major_tournament_entrants WHERE season_id = $1) AND status = 'confirmed') AS "confirmedRosters"
       FROM major_tournament_entrants WHERE season_id = $1`,
      [fixture.seasonId],
    );
    expect(selectedRows.rows[0]).toEqual({ count: "24", confirmedRosters: "24" });

    const r1History = await pool.query<{ userId: string; current: boolean }>(
      `SELECT erm.user_id AS "userId", erm.is_current AS current
       FROM match_roster_players mrp
       JOIN match_rosters mr ON mr.id = mrp.roster_id
       JOIN event_roster_members erm ON erm.id = mrp.event_roster_member_id
       WHERE mr.match_id = $1 AND mr.entry_id = $2`,
      [firstRoundId, historicalEntryId],
    );
    expect(r1History.rows.map((row) => row.userId).sort()).toEqual(revisionOneUsers.slice().sort());
    expect(r1History.rows.every((row) => !row.current)).toBe(true);

    const r2History = await pool.query<{ userId: string; current: boolean }>(
      `SELECT erm.user_id AS "userId", erm.is_current AS current
       FROM match_roster_players mrp
       JOIN match_rosters mr ON mr.id = mrp.roster_id
       JOIN event_roster_members erm ON erm.id = mrp.event_roster_member_id
       WHERE mr.match_id = $1 AND mr.entry_id = $2`,
      [secondRoundId, historicalEntryId],
    );
    expect(r2History.rows.map((row) => row.userId).sort()).toEqual(revisionTwoUsers.slice().sort());
    expect(r2History.rows.every((row) => row.current)).toBe(true);
  } finally {
    if (fixture) await cleanupAcceptanceFixture(pool, fixture);
    await pool.end();
  }
}

describe("Issue 743 qualification PostgreSQL acceptance", () => {
  it("takes 30 approved candidates through Short Swiss and locks 18 direct plus 6 qualifiers", async () => {
    await exerciseThirtyToTwentyFourAcceptance();
  });
});
