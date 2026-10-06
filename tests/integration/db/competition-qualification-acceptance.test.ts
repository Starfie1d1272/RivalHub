import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
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
  resetCompetitionQualificationRunInTx,
  saveCompetitionQualificationRankInTx,
  saveCompetitionQualificationOrderInTx,
} from "../../../src/lib/competition-qualification/runtime";
import { evaluateExternalStrengthRule } from "../../../src/lib/major/player-strength";
import { loadParticipantQualificationFacts, toPlayerStrengthInput } from "../../../src/lib/qualification/service";
import { saveCompetitionQualificationDraftInTx } from "../../../src/lib/competition-qualification/draft";
import { reviewCompetitionEntryInTx, submitCompetitionEntryInTx } from "../../../src/lib/competition-entries/commands";
import { requestCompetitionEntryRosterChangeInTx } from "../../../src/lib/competition-entries/roster-change";
import { applyMatchStatusTransitionInTx, confirmMatchRosterInTx, persistMatchRosterInTx, getStartingLineupPreflightInTx } from "../../../src/lib/match-rosters/service";
import { assertGenericMatchCanBeDeleted } from "../../../src/lib/matches/deletion";
import { planSeriesAfterMapScoreChangeInTx, correctSeriesAfterMapScoreChangeInTx } from "../../../src/lib/matches/series-score-correction";
import { applyResultCorrectionInTx, planResultCorrectionInTx } from "../../../src/lib/match-corrections/service";
import { lockMajorPrestartEntrantsInTx, selectMajorEntrantsAndSyncRostersInTx } from "../../../src/lib/major/prestart-entrants";
import { readVetoRoomCore, readVetoRoomSnapshot, requestVetoStart, submitVetoCommand } from "../../../src/lib/matches/veto-room/service";
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
    await client.query("DELETE FROM match_maps WHERE match_id IN (SELECT id FROM matches WHERE season_id = $1)", [fixture.seasonId]);
    await client.query("DELETE FROM matches WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM competition_qualification_entrants WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM competition_qualification_drafts WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM competition_qualification_runs WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_tournament_seeds WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_tournament_entrants WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_seed_recommendation_snapshots WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_prestart_states WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM event_roster_members WHERE event_roster_id IN (SELECT id FROM event_rosters WHERE entry_id = ANY($1::uuid[]))", [entryIds]);
    await client.query("DELETE FROM event_rosters WHERE entry_id = ANY($1::uuid[])", [entryIds]);
    await client.query("DELETE FROM competition_entry_representative_changes WHERE entry_id = ANY($1::uuid[])", [entryIds]);
    await client.query("DELETE FROM competition_entry_restriction_overrides WHERE competition_id = $1", [fixture.seasonId]);
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

async function exerciseDraftConcurrencyAndEligibility(format: "direct_bo3" | "short_swiss_2w2l") {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 4 });
  const database = drizzle(pool, { schema });
  let fixture: AcceptanceFixture | undefined;
  try {
    fixture = await prepareAcceptanceFixture(pool);
    const order = fixture.entries.map(entry => entry.entryId);
    const input = { seasonId: fixture.seasonId, actorId: ACTOR, format, order, expectedVersion: null };
    const saved = await database.transaction(tx => saveCompetitionQualificationDraftInTx(tx, input));
    expect(saved.draft.version).toBe(1);
    expect((await database.select().from(schema.competitionQualificationRuns).where(eq(schema.competitionQualificationRuns.seasonId, fixture.seasonId)))).toHaveLength(0);
    expect((await database.select().from(schema.matches).where(eq(schema.matches.seasonId, fixture.seasonId)))).toHaveLength(0);
    const concurrent = await Promise.allSettled([ACTOR, "second-committee-admin"].map(actorId => database.transaction(tx => saveCompetitionQualificationDraftInTx(tx, { ...input, actorId, expectedVersion: 1 }))));
    expect(concurrent.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter(result => result.status === "rejected")).toHaveLength(1);
    await expect(database.transaction(tx => configureCompetitionQualificationRunInTx(tx, {
      seasonId: fixture!.seasonId, actorId: ACTOR, format, preliminaryOrderEntryIds: order, expectedDraftVersion: 1,
    }))).rejects.toThrow("最新草稿");
    const external = await pool.query<{ id: string }>("SELECT id FROM institutions WHERE moe_institution_code <> $1 LIMIT 1", [NJU_CODE]);
    if (!external.rows[0]) throw new Error("external institution fixture missing");
    const probes = fixture.entries.slice(18, 20);
    for (const entry of probes) {
      await pool.query("UPDATE education_verifications SET institution_id = $1 WHERE user_id = ANY($2::uuid[])", [external.rows[0].id, entry.userIds.slice(3)]);
      await pool.query("UPDATE competitive_rank_facts SET rank = '魔王S', stars = 50 WHERE user_id = ANY($1::uuid[]) AND kind = 'historical_peak'", [entry.userIds.slice(3)]);
      await database.transaction(async tx => {
        const participants = await tx.select().from(schema.competitionEntryParticipants).where(eq(schema.competitionEntryParticipants.entryId, entry.entryId));
        await tx.insert(schema.competitionEntryRosterMembers).values(entry.userIds.slice(5).map(userId => ({ revisionId: entry.revisionId, participantId: participants.find(participant => participant.userId === userId)!.id, userId, isPrimaryStarter: false })));
      });
    }
    // An approved override is adopted only for the exact Entry + approved revision.
    const permitted = probes[1]!;
    await database.transaction(async tx => {
      const facts = await loadParticipantQualificationFacts(permitted.userIds, { executor: tx, platform: PROFILE.platform });
      const config = { ...PROFILE, rankOrder: [...PROFILE.rankOrder] };
      const players = permitted.userIds.slice(0, 5).map((userId, index) => ({ ...toPlayerStrengthInput(facts.get(userId)!, config), isHome: index < 3 }));
      const finding = evaluateExternalStrengthRule({ config, players }).findings[0]!;
      await tx.insert(schema.competitionEntryRestrictionOverrides).values({ competitionId: fixture!.seasonId, entryId: permitted.entryId, rosterRevisionId: permitted.revisionId, restrictionCode: finding.code, findingSnapshot: finding, reason: "fixture approved restriction", grantedBy: ACTOR });
    });
    const configured = await database.transaction(tx => configureCompetitionQualificationRunInTx(tx, {
      seasonId: fixture!.seasonId, actorId: ACTOR, format, preliminaryOrderEntryIds: order, expectedDraftVersion: 2,
    }));
    const preview = await database.transaction(tx => previewCompetitionQualificationRoundInTx(tx, { seasonId: fixture!.seasonId, runId: configured.runId }));
    await database.transaction(tx => generateCompetitionQualificationRoundInTx(tx, {
      seasonId: fixture!.seasonId, runId: configured.runId, actorId: ACTOR, expectedPairings: preview.matchups,
    }));
    for (const [index, entry] of probes.entries()) {
      const linked = await database.select().from(schema.matches).where(eq(schema.matches.qualificationRunId, configured.runId));
      const match = linked.find(row => row.entryAId === entry.entryId || row.entryBId === entry.entryId)!;
      const members = await database.select({ id: schema.eventRosterMembers.id, userId: schema.eventRosterMembers.userId }).from(schema.eventRosterMembers)
        .innerJoin(schema.eventRosters, eq(schema.eventRosters.id, schema.eventRosterMembers.eventRosterId)).where(eq(schema.eventRosters.entryId, entry.entryId));
      const ids = (users: string[]) => users.map(userId => members.find(member => member.userId === userId)!.id);
      const preflight = await database.transaction(tx => getStartingLineupPreflightInTx(tx, { match, entryId: entry.entryId, starterIds: ids(entry.userIds.slice(0, 5)) }));
      expect(preflight.valid).toBe(index === 1);
      if (index === 0) {
        expect(preflight.blockers.join(" ")).toContain("外校");
        await expect(database.transaction(tx => persistMatchRosterInTx(tx, { match, entryId: entry.entryId, starterIds: ids(entry.userIds.slice(0, 5)), submittedBy: null, source: "admin_select" }))).rejects.toThrow("外校");
      } else {
        await database.transaction(tx => persistMatchRosterInTx(tx, { match, entryId: entry.entryId, starterIds: ids(entry.userIds.slice(0, 5)), submittedBy: null, source: "admin_select" }));
      }
      const insufficientHome = await database.transaction(tx => getStartingLineupPreflightInTx(tx, { match, entryId: entry.entryId, starterIds: ids([entry.userIds[0]!, entry.userIds[1]!, ...entry.userIds.slice(3, 6)]) }));
      expect(insufficientHome.valid).toBe(false);
      expect(insufficientHome.blockers.join(" ")).toContain("首发");
      // Mutable rank edits cannot change the adopted eligibility facts.
      await pool.query("UPDATE competitive_rank_facts SET rank = 'D', stars = NULL WHERE user_id = ANY($1::uuid[])", [entry.userIds]);
      const frozen = await database.transaction(tx => getStartingLineupPreflightInTx(tx, { match, entryId: entry.entryId, starterIds: ids(entry.userIds.slice(0, 5)) }));
      expect(frozen.valid).toBe(index === 1);
    }
  } finally {
    if (fixture) await cleanupAcceptanceFixture(pool, fixture);
    await pool.end();
  }
}

async function exerciseThirtyToTwentyFourAcceptance(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 4 });
  const database = drizzle(pool, { schema });
  let fixture: AcceptanceFixture | undefined;
  try {
    fixture = await prepareAcceptanceFixture(pool);
    const preliminaryOrderEntryIds = fixture.entries.map((entry) => entry.entryId);
    await database.transaction(tx => saveCompetitionQualificationDraftInTx(tx, {
      seasonId: fixture!.seasonId, actorId: ACTOR, format: "short_swiss_2w2l", order: fixture!.entries.map(entry => entry.entryId), expectedVersion: null,
    }));
    const configured = await database.transaction((tx) => configureCompetitionQualificationRunInTx(tx, {
      seasonId: fixture!.seasonId,
      actorId: ACTOR,
      expectedDraftVersion: 1,
      format: "short_swiss_2w2l",
      preliminaryOrderEntryIds,
    }));
    expect(configured).toMatchObject({ directEntryCount: 18, playInEntryCount: 12, qualifierCount: 6 });

    const runId = configured.runId;
    await expect(database.transaction(tx => saveCompetitionQualificationOrderInTx(tx, {
      seasonId: fixture!.seasonId, runId, orderedCompetitionEntryIds: preliminaryOrderEntryIds.slice().reverse(), actorId: ACTOR,
    }))).rejects.toThrow("预排名已锁定");
    const frozenSeedRows = await database.select({
      entryId: schema.competitionQualificationEntrants.competitionEntryId,
      seed: schema.competitionQualificationEntrants.preliminarySeed,
    }).from(schema.competitionQualificationEntrants)
      .where(eq(schema.competitionQualificationEntrants.runId, runId));
    const higherSeed = [...frozenSeedRows].sort((left, right) => left.seed - right.seed)[0]!;
    const lowerSeed = [...frozenSeedRows].sort((left, right) => right.seed - left.seed)[0]!;
    const probeMatchId = randomUUID();
    await pool.query(
      `INSERT INTO matches (id, season_id, entry_a_id, entry_b_id, stage, format, qualification_run_id)
       VALUES ($1, $2, $3, $4, 'play-in', 'bo1', $5)`,
      [probeMatchId, fixture.seasonId, lowerSeed.entryId, higherSeed.entryId, runId],
    );
    try {
      const displaySnapshot = await readVetoRoomSnapshot(probeMatchId);
      expect(displaySnapshot.session.privilegedEntryId).toBe(higherSeed.entryId);
      const readSideEffect = await pool.query<{ count: string }>(
        "SELECT count(*) FROM match_veto_sessions WHERE match_id = $1",
        [probeMatchId],
      );
      expect(readSideEffect.rows[0]?.count).toBe("0");
      const vetoSnapshot = await readVetoRoomCore(probeMatchId);
      expect(vetoSnapshot.session.privilegedEntryId).toBe(higherSeed.entryId);
      expect(vetoSnapshot.session.privilegedEntryId).not.toBe(vetoSnapshot.match.entryAId);
    } finally {
      await pool.query("DELETE FROM matches WHERE id = $1", [probeMatchId]);
    }

    let historicalEntryId = "";
    let firstRoundId = "";
    let secondRoundId = "";
    let revisionOneUsers: string[] = [];
    let revisionTwoUsers: string[] = [];
    for (const [roundIndex, expectedMatchCount] of [6, 6, 3].entries()) {
      const round = roundIndex + 1;
      const preview = await database.transaction((tx) => previewCompetitionQualificationRoundInTx(tx, {
        seasonId: fixture!.seasonId,
        runId,
      }));
      expect(preview).toMatchObject({ round, format: "bo1" });
      expect(preview.matchups).toHaveLength(expectedMatchCount);
      if (round === 1) {
        await expect(database.transaction(tx => saveCompetitionQualificationRankInTx(tx, {
          seasonId: fixture!.seasonId, entryId: preliminaryOrderEntryIds[18]!, nextRank: 20, actorId: ACTOR,
        }))).rejects.toThrow("预排名已锁定");
        const stalePairings = preview.matchups.map(({ higherSeedTeamId, lowerSeedTeamId }) => ({ higherSeedTeamId, lowerSeedTeamId }));
        stalePairings[0]!.lowerSeedTeamId = randomUUID();
        await expect(database.transaction(tx => generateCompetitionQualificationRoundInTx(tx, {
          seasonId: fixture!.seasonId, runId, actorId: ACTOR, expectedPairings: stalePairings,
        }))).rejects.toThrow("轮次对阵已变化");
      }
      const created = await database.transaction((tx) => generateCompetitionQualificationRoundInTx(tx, {
        seasonId: fixture!.seasonId,
        runId,
        actorId: ACTOR,
        expectedPairings: preview.matchups.map(({ higherSeedTeamId, lowerSeedTeamId }) => ({ higherSeedTeamId, lowerSeedTeamId })),
      }));
      expect(created).toMatchObject({ round, matchCount: expectedMatchCount, created: true });
      const retried = await database.transaction((tx) => generateCompetitionQualificationRoundInTx(tx, {
        seasonId: fixture!.seasonId,
        runId,
        actorId: ACTOR,
        expectedPairings: preview.matchups.map(({ higherSeedTeamId, lowerSeedTeamId }) => ({ higherSeedTeamId, lowerSeedTeamId })),
      }));
      expect(retried).toMatchObject({ round, matchCount: expectedMatchCount, created: false });
      const roundMatches = await database.select().from(schema.matches)
        .where(and(eq(schema.matches.qualificationRunId, runId), eq(schema.matches.round, round)));
      expect(roundMatches).toHaveLength(expectedMatchCount);
      expect(roundMatches.every((match) => match.stage === "play-in" && match.ownership === "manual" && match.majorStageRunId === null)).toBe(true);
      if (round === 1) {
        await expect(database.transaction((tx) => saveCompetitionQualificationOrderInTx(tx, {
          seasonId: fixture!.seasonId, runId, orderedCompetitionEntryIds: preliminaryOrderEntryIds, actorId: ACTOR,
        }))).rejects.toThrow("预排名已锁定");
      }

      if (round === 1) {
        const historicalMatch = roundMatches[0]!;
        historicalEntryId = historicalMatch.entryAId;
        firstRoundId = historicalMatch.id;
        await expect(database.transaction((tx) => applyMatchStatusTransitionInTx(tx, {
          matchId: historicalMatch.id,
          nextStatus: "cancelled",
          actorId: ACTOR,
        }))).rejects.toThrow("Play-in 比赛不能取消");
        expect(() => assertGenericMatchCanBeDeleted(historicalMatch)).toThrow("资格赛生成的比赛不能单独删除");
        await expect(database.transaction((tx) => resetCompetitionQualificationRunInTx(tx, {
          seasonId: fixture!.seasonId,
          actorId: ACTOR,
        }))).rejects.toThrow("Play-in 已开始或已生成比赛，不能重置");
        const otherEntryId = historicalMatch.entryAId === historicalEntryId ? historicalMatch.entryBId : historicalMatch.entryAId;
        revisionOneUsers = await persistAndConfirmLineup(database, historicalMatch.id, historicalEntryId);
        const otherEntryUsers = await persistAndConfirmLineup(database, historicalMatch.id, otherEntryId);
        for (const [entryId, userId] of [
          [historicalEntryId, revisionOneUsers[0]!],
          [otherEntryId, otherEntryUsers[0]!],
        ] as const) {
          const representative = await pool.query(
            `UPDATE match_roster_players AS mrp SET is_veto_representative = true
             FROM match_rosters AS mr
             WHERE mrp.roster_id = mr.id AND mr.match_id = $1 AND mr.entry_id = $2
               AND mrp.is_starter AND EXISTS (
                 SELECT 1 FROM event_roster_members AS erm
                 WHERE erm.id = mrp.event_roster_member_id AND erm.user_id = $3
               )`,
            [historicalMatch.id, entryId, userId],
          );
          expect(representative.rowCount).toBe(1);
        }
        const beforeStart = await readVetoRoomCore(historicalMatch.id);
        const qualificationSeeds = await database.select({
          entryId: schema.competitionQualificationEntrants.competitionEntryId,
          seed: schema.competitionQualificationEntrants.preliminarySeed,
        }).from(schema.competitionQualificationEntrants)
          .where(and(
            eq(schema.competitionQualificationEntrants.runId, runId),
            inArray(schema.competitionQualificationEntrants.competitionEntryId, [historicalMatch.entryAId, historicalMatch.entryBId]),
          ));
        const expectedPrivileged = [...qualificationSeeds].sort((left, right) => left.seed - right.seed)[0]?.entryId;
        expect(beforeStart.session.privilegedEntryId).toBe(expectedPrivileged);
        const firstEntryA = historicalMatch.entryAId === historicalEntryId;
        await requestVetoStart({
          matchId: historicalMatch.id,
          entryId: historicalMatch.entryAId,
          actorId: firstEntryA ? revisionOneUsers[0]! : otherEntryUsers[0]!,
          expectedRevision: beforeStart.session.revision,
          expectedTurnKey: beforeStart.session.currentTurnKey,
        });
        const beforeSecondRequest = await readVetoRoomCore(historicalMatch.id);
        await requestVetoStart({
          matchId: historicalMatch.id,
          entryId: historicalMatch.entryBId,
          actorId: firstEntryA ? otherEntryUsers[0]! : revisionOneUsers[0]!,
          expectedRevision: beforeSecondRequest.session.revision,
          expectedTurnKey: beforeSecondRequest.session.currentTurnKey,
        });
        const startedRoom = await readVetoRoomCore(historicalMatch.id);
        expect(startedRoom.match.status).toBe("in_progress");
        expect(startedRoom.session.startedAt).not.toBeNull();
        expect(startedRoom.currentTurn?.actionType).toBe("role_select");

        const userByEntry = new Map([
          [historicalEntryId, revisionOneUsers[0]!],
          [otherEntryId, otherEntryUsers[0]!],
        ]);
        const roleSelectTurn = startedRoom.currentTurn!;
        const lateRoleSelectActor = userByEntry.get(roleSelectTurn.actorEntryId!)!;
        await pool.query(
          "UPDATE match_veto_sessions SET turn_deadline_at = clock_timestamp() - interval '50 milliseconds' WHERE match_id = $1",
          [historicalMatch.id],
        );
        expect(await submitVetoCommand({
          matchId: historicalMatch.id,
          actorId: lateRoleSelectActor,
          expectedRevision: startedRoom.session.revision,
          expectedTurnKey: roleSelectTurn.key,
          clientRequestId: randomUUID(),
          command: { kind: "role_select", entryId: startedRoom.session.privilegedEntryId! },
        })).toBe("stale");
        const afterLateRoleSelect = await pool.query<{ veto_team_a_entry_id: string | null; timeout_count: string }>(
          "SELECT s.veto_team_a_entry_id, (SELECT count(*) FROM match_veto_timeout_incidents i WHERE i.match_id = s.match_id) AS timeout_count FROM match_veto_sessions s WHERE s.match_id = $1",
          [historicalMatch.id],
        );
        expect(afterLateRoleSelect.rows[0]).toMatchObject({ veto_team_a_entry_id: null, timeout_count: "0" });
        await pool.query(
          "UPDATE match_veto_sessions SET turn_deadline_at = clock_timestamp() + interval '45 seconds' WHERE match_id = $1",
          [historicalMatch.id],
        );
        let activeRoom = startedRoom;
        for (let commandNumber = 0; commandNumber < 16 && !activeRoom.session.completedAt; commandNumber += 1) {
          const turn = activeRoom.currentTurn;
          if (!turn || !turn.actorEntryId) throw new Error("Veto Room lost its participant turn before map plan completion");
          const actorId = userByEntry.get(turn.actorEntryId);
          if (!actorId) throw new Error("Veto Room turn owner has no confirmed representative");
          const command = turn.actionType === "role_select"
            ? { kind: "role_select" as const, entryId: activeRoom.session.privilegedEntryId! }
            : turn.actionType === "side_pick"
              ? { kind: "step" as const, actionType: "side_pick" as const, side: "ct" as const }
              : turn.actionType === "ban" || turn.actionType === "pick"
                ? {
                    kind: "step" as const,
                    actionType: turn.actionType,
                    mapName: activeRoom.session.mapPoolSnapshot!.find((mapName) =>
                      !activeRoom.steps.some((step) => step.actionType !== "side_pick" && step.mapName === mapName),
                    )!,
                  }
                : null;
          if (!command) throw new Error(`Unexpected participant Veto Room turn: ${turn.actionType}`);
          expect(await submitVetoCommand({
            matchId: historicalMatch.id,
            actorId,
            expectedRevision: activeRoom.session.revision,
            expectedTurnKey: turn.key,
            clientRequestId: randomUUID(),
            command,
          })).toBe("applied");
          activeRoom = await readVetoRoomCore(historicalMatch.id);
        }
        expect(activeRoom.session.completedAt).not.toBeNull();
        expect(activeRoom.match.status).toBe("in_progress");
        const mapPlan = await pool.query<{ map_order: number; score_a: number | null; score_b: number | null }>(
          "SELECT map_order, score_a, score_b FROM match_maps WHERE match_id = $1 ORDER BY map_order",
          [historicalMatch.id],
        );
        const expectedMapCount = historicalMatch.format === "bo1" ? 1 : historicalMatch.format === "bo3" ? 3 : 5;
        expect(mapPlan.rows).toHaveLength(expectedMapCount);
        expect(mapPlan.rows.every((map) => map.score_a === null && map.score_b === null)).toBe(true);
      }

      if (round === 2) {
        const roundTwoMatch = roundMatches.find((match) => match.entryAId === historicalEntryId || match.entryBId === historicalEntryId);
        if (!roundTwoMatch) throw new Error("R2 match for revised entry missing");
        secondRoundId = roundTwoMatch.id;
        revisionTwoUsers = await persistAndConfirmLineup(database, roundTwoMatch.id, historicalEntryId);
        expect(revisionTwoUsers).toEqual(revisionOneUsers);
      }

      await finishRound(pool, database, runId, round);

      if (round === 1) {
        await pool.query("UPDATE matches SET score_a = 0, score_b = 1 WHERE id = $1", [firstRoundId]);
        const historicalEntry = fixture.entries.find((entry) => entry.entryId === historicalEntryId);
        if (!historicalEntry) throw new Error("R1 entry not found in fixture");
        await expect(database.transaction((tx) => requestCompetitionEntryRosterChangeInTx(tx, {
          entryId: historicalEntry.entryId,
          representativeUserId: historicalEntry.userIds[0]!,
          actorId: ACTOR,
        }))).rejects.toThrow("名单调整窗口当前不可用");

        const roundTwoPreview = await database.transaction((tx) => previewCompetitionQualificationRoundInTx(tx, {
          seasonId: fixture!.seasonId,
          runId,
        }));
        expect(roundTwoPreview.matchups.some((matchup) => matchup.higherSeedTeamId === historicalEntryId || matchup.lowerSeedTeamId === historicalEntryId)).toBe(true);
        const frozenSeeds = await database.select({ entryId: schema.competitionQualificationEntrants.competitionEntryId, seed: schema.competitionQualificationEntrants.preliminarySeed })
          .from(schema.competitionQualificationEntrants).where(eq(schema.competitionQualificationEntrants.runId, runId));
        const playInSeedByEntryId = new Map(frozenSeeds.filter((entrant) => entrant.seed > 18).map((entrant) => [entrant.entryId, entrant.seed - 18]));
        expect(roundTwoPreview.matchups.every((matchup) =>
          matchup.higherSeed === playInSeedByEntryId.get(matchup.higherSeedTeamId) &&
          matchup.lowerSeed === playInSeedByEntryId.get(matchup.lowerSeedTeamId),
        )).toBe(true);
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

    await pool.query("UPDATE seasons SET roster_change_closes_at = $2 WHERE id = $1", [fixture.seasonId, completedRun!.completedAt]);
    await expect(database.transaction((tx) => lockMajorPrestartEntrantsInTx(tx, {
      seasonId: fixture!.seasonId,
      actorId: ACTOR,
    }))).rejects.toThrow("最终名单调整截止必须晚于 Play-in 实际完成时间");
    await pool.query("UPDATE seasons SET roster_change_closes_at = now() + interval '1 day' WHERE id = $1", [fixture.seasonId]);

    const finalEntrant = fixture.entries.find((entry) => entry.entryId === finalEntryIds[0]);
    if (!finalEntrant) throw new Error("final entrant missing from fixture");
    const approvedRevisionTwo = await prepareAndApproveRosterV2(database, finalEntrant);
    const rosterHistory = await pool.query<{ current: boolean; revisionId: string; userId: string }>(
      `SELECT erm.is_current AS current, er.source_roster_revision_id AS "revisionId", erm.user_id AS "userId"
       FROM event_roster_members erm
       JOIN event_rosters er ON er.id = erm.event_roster_id
       WHERE er.entry_id = $1
       ORDER BY erm.is_current DESC, erm.user_id`,
      [finalEntrant.entryId],
    );
    expect(new Set(rosterHistory.rows.filter((row) => row.current).map((row) => row.revisionId))).toEqual(new Set([approvedRevisionTwo]));
    expect(rosterHistory.rows.some((row) => row.current && row.userId === finalEntrant.userIds[5])).toBe(true);
    expect(rosterHistory.rows.some((row) => row.current && row.userId === finalEntrant.userIds[4])).toBe(false);

    const r1History = await pool.query<{ userId: string; current: boolean }>(
      `SELECT erm.user_id AS "userId", erm.is_current AS current
       FROM match_roster_players mrp
       JOIN match_rosters mr ON mr.id = mrp.roster_id
       JOIN event_roster_members erm ON erm.id = mrp.event_roster_member_id
       WHERE mr.match_id = $1 AND mr.entry_id = $2`,
      [firstRoundId, historicalEntryId],
    );
    expect(r1History.rows.map((row) => row.userId).sort()).toEqual(revisionOneUsers.slice().sort());

    const r2History = await pool.query<{ userId: string; current: boolean }>(
      `SELECT erm.user_id AS "userId", erm.is_current AS current
       FROM match_roster_players mrp
       JOIN match_rosters mr ON mr.id = mrp.roster_id
       JOIN event_roster_members erm ON erm.id = mrp.event_roster_member_id
       WHERE mr.match_id = $1 AND mr.entry_id = $2`,
      [secondRoundId, historicalEntryId],
    );
    expect(r2History.rows.map((row) => row.userId).sort()).toEqual(revisionTwoUsers.slice().sort());
  } finally {
    if (fixture) await cleanupAcceptanceFixture(pool, fixture);
    await pool.end();
  }
}

async function exerciseShortSwissCorrectionRecovery(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 4 });
  const database = drizzle(pool, { schema });
  let fixture: AcceptanceFixture | undefined;
  try {
    fixture = await prepareAcceptanceFixture(pool);
    await database.transaction(tx => saveCompetitionQualificationDraftInTx(tx, {
      seasonId: fixture!.seasonId, actorId: ACTOR, format: "short_swiss_2w2l", order: fixture!.entries.map(entry => entry.entryId), expectedVersion: null,
    }));
    const configured = await database.transaction((tx) => configureCompetitionQualificationRunInTx(tx, {
      seasonId: fixture!.seasonId,
      actorId: ACTOR,
      expectedDraftVersion: 1,
      format: "short_swiss_2w2l",
      preliminaryOrderEntryIds: fixture!.entries.map((entry) => entry.entryId),
    }));
    const runId = configured.runId;
    const roundOnePreview = await database.transaction((tx) => previewCompetitionQualificationRoundInTx(tx, {
      seasonId: fixture!.seasonId,
      runId,
    }));
    await database.transaction((tx) => generateCompetitionQualificationRoundInTx(tx, {
      seasonId: fixture!.seasonId,
      runId,
      actorId: ACTOR,
      expectedPairings: roundOnePreview.matchups.map(({ higherSeedTeamId, lowerSeedTeamId }) => ({ higherSeedTeamId, lowerSeedTeamId })),
    }));
    const roundOneMatches = await database.select().from(schema.matches)
      .where(and(eq(schema.matches.qualificationRunId, runId), eq(schema.matches.round, 1)));
    await finishRound(pool, database, runId, 1);

    const roundTwoPreview = await database.transaction((tx) => previewCompetitionQualificationRoundInTx(tx, {
      seasonId: fixture!.seasonId,
      runId,
    }));
    await database.transaction((tx) => generateCompetitionQualificationRoundInTx(tx, {
      seasonId: fixture!.seasonId,
      runId,
      actorId: ACTOR,
      expectedPairings: roundTwoPreview.matchups.map(({ higherSeedTeamId, lowerSeedTeamId }) => ({ higherSeedTeamId, lowerSeedTeamId })),
    }));
    const originalRoundTwoRows = await database.select().from(schema.matches)
      .where(and(eq(schema.matches.qualificationRunId, runId), eq(schema.matches.round, 2)));
    await persistAndConfirmLineup(database, originalRoundTwoRows[0]!.id, originalRoundTwoRows[0]!.entryAId);

    const sourceMatch = roundOneMatches[0]!;
    const proposal = { scoreA: 0, scoreB: 1 };
    const plan = await database.transaction((tx) => planResultCorrectionInTx(tx, {
      matchId: sourceMatch.id,
      proposal,
    }));
    expect(plan.affectsQualificationRun).toBe(true);
    expect(plan.blockedReasons).toEqual([]);
    expect(plan.impacts.filter((impact) => impact.kind === "downstream_match")).toHaveLength(6);

    const applied = await database.transaction((tx) => applyResultCorrectionInTx(tx, {
      matchId: sourceMatch.id,
      proposal,
      actorId: ACTOR,
      confirmRecovery: true,
    }));
    expect(applied.invalidatedDownstreamMatches).toHaveLength(6);
    expect(await database.select().from(schema.matches)
      .where(and(eq(schema.matches.qualificationRunId, runId), eq(schema.matches.round, 2)))).toHaveLength(0);
    expect(await database.select().from(schema.matchRosters)
      .where(eq(schema.matchRosters.matchId, originalRoundTwoRows[0]!.id))).toHaveLength(0);

    const correctedRoundTwoPreview = await database.transaction((tx) => previewCompetitionQualificationRoundInTx(tx, {
      seasonId: fixture!.seasonId,
      runId,
    }));
    const regenerated = await database.transaction((tx) => generateCompetitionQualificationRoundInTx(tx, {
      seasonId: fixture!.seasonId,
      runId,
      actorId: ACTOR,
      expectedPairings: correctedRoundTwoPreview.matchups.map(({ higherSeedTeamId, lowerSeedTeamId }) => ({ higherSeedTeamId, lowerSeedTeamId })),
    }));
    expect(regenerated).toMatchObject({ round: 2, matchCount: 6, created: true });

    const roundTwoRows = await database.select().from(schema.matches)
      .where(and(eq(schema.matches.qualificationRunId, runId), eq(schema.matches.round, 2)));
    await pool.query("UPDATE matches SET status = 'in_progress', updated_at = now() WHERE id = $1", [roundTwoRows[0]!.id]);
    const blockedPlan = await database.transaction((tx) => planResultCorrectionInTx(tx, {
      matchId: sourceMatch.id,
      proposal: { scoreA: 1, scoreB: 0 },
    }));
    expect(blockedPlan.blockedReasons.some((reason) => reason.code === "qualificationMatchStarted")).toBe(true);

    await pool.query("UPDATE matches SET status = 'scheduled', updated_at = now() WHERE qualification_run_id = $1 AND round = 2", [runId]);
    await pool.query("DELETE FROM matches WHERE id = $1", [roundTwoRows[0]!.id]);
    await expect(database.transaction((tx) => generateCompetitionQualificationRoundInTx(tx, {
      seasonId: fixture!.seasonId,
      runId,
      actorId: ACTOR,
      expectedPairings: correctedRoundTwoPreview.matchups.map(({ higherSeedTeamId, lowerSeedTeamId }) => ({ higherSeedTeamId, lowerSeedTeamId })),
    }))).rejects.toThrow("比赛集合不完整");
  } finally {
    if (fixture) await cleanupAcceptanceFixture(pool, fixture);
    await pool.end();
  }
}

async function exerciseDirectBo3CompletionAndCorrection(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 4 });
  const database = drizzle(pool, { schema });
  let fixture: AcceptanceFixture | undefined;
  try {
    fixture = await prepareAcceptanceFixture(pool);
    const preliminaryOrderEntryIds = fixture.entries.map((entry) => entry.entryId);
    await database.transaction(tx => saveCompetitionQualificationDraftInTx(tx, {
      seasonId: fixture!.seasonId, actorId: ACTOR, format: "direct_bo3", order: preliminaryOrderEntryIds, expectedVersion: null,
    }));
    const configured = await database.transaction((tx) => configureCompetitionQualificationRunInTx(tx, {
      seasonId: fixture!.seasonId,
      actorId: ACTOR,
      expectedDraftVersion: 1,
      format: "direct_bo3",
      preliminaryOrderEntryIds,
    }));
    const runId = configured.runId;
    const preview = await database.transaction((tx) => previewCompetitionQualificationRoundInTx(tx, {
      seasonId: fixture!.seasonId,
      runId,
    }));
    expect(preview.matchups).toHaveLength(6);
    const generated = await database.transaction((tx) => generateCompetitionQualificationRoundInTx(tx, {
      seasonId: fixture!.seasonId,
      runId,
      actorId: ACTOR,
      expectedPairings: preview.matchups.map(({ higherSeedTeamId, lowerSeedTeamId }) => ({ higherSeedTeamId, lowerSeedTeamId })),
    }));
    expect(generated).toMatchObject({ round: 1, matchCount: 6, created: true });
    const retry = await database.transaction((tx) => generateCompetitionQualificationRoundInTx(tx, {
      seasonId: fixture!.seasonId,
      runId,
      actorId: ACTOR,
      expectedPairings: preview.matchups.map(({ higherSeedTeamId, lowerSeedTeamId }) => ({ higherSeedTeamId, lowerSeedTeamId })),
    }));
    expect(retry).toMatchObject({ round: 1, matchCount: 6, created: false });

    await pool.query(
      `UPDATE matches SET status = 'finished', score_a = 2, score_b = 0, completed_at = now(), updated_at = now()
       WHERE qualification_run_id = $1`,
      [runId],
    );
    // The last Direct BO3 was misrecorded 1:1; the reviewed map correction
    // completes Qualification through the canonical completion owner.
    const pendingCorrection = (await database.select().from(schema.matches).where(eq(schema.matches.qualificationRunId, runId)))[0]!;
    const correctedMapId = randomUUID();
    const actualEnd = new Date("2026-10-01T12:30:00Z");
    await database.update(schema.matches).set({ status: "in_progress", scoreA: null, scoreB: null, completedAt: null }).where(eq(schema.matches.id, pendingCorrection.id));
    await database.insert(schema.matchMaps).values([
      { matchId: pendingCorrection.id, mapOrder: 1, mapName: "de_ancient", scoreA: 13, scoreB: 9, completedAt: actualEnd },
      { id: correctedMapId, matchId: pendingCorrection.id, mapOrder: 2, mapName: "de_mirage", scoreA: 9, scoreB: 13, completedAt: actualEnd },
      { matchId: pendingCorrection.id, mapOrder: 3, mapName: "de_nuke" },
    ]);
    const request = { matchId: pendingCorrection.id, mapId: correctedMapId, scoreA: 13, scoreB: 9, expectedScoreA: 9, expectedScoreB: 13 };
    const seriesPlan = await database.transaction(tx => planSeriesAfterMapScoreChangeInTx(tx, request));
    expect(seriesPlan?.blockers).toEqual([]);
    const confirmation = { ...request, previewRevision: seriesPlan!.revision, reason: "复核实际赛果", confirmed: true as const, laterMapsNotStarted: true as const };
    expect(await database.transaction(tx => correctSeriesAfterMapScoreChangeInTx(tx, confirmation, ACTOR))).toMatchObject({ alreadyApplied: false });
    expect(await database.transaction(tx => correctSeriesAfterMapScoreChangeInTx(tx, confirmation, ACTOR))).toMatchObject({ alreadyApplied: true });
    expect(await database.transaction((tx) => completeCompetitionQualificationIfReadyInTx(tx, runId))).toBe(false);
    const [completedRun] = await database.select().from(schema.competitionQualificationRuns)
      .where(eq(schema.competitionQualificationRuns.id, runId));
    expect(completedRun?.completedAt).toBeInstanceOf(Date);
    const originalFinalIds = await database.transaction((tx) => getCompetitionQualificationFinalEntryIdsInTx(tx, completedRun!));
    expect(originalFinalIds).toHaveLength(24);
    expect(new Set(originalFinalIds).size).toBe(24);
    expect(originalFinalIds.slice(0, 18)).toEqual(preliminaryOrderEntryIds.slice(0, 18));
    expect(originalFinalIds.slice(18)).toHaveLength(6);

    const firstMatch = (await database.select().from(schema.matches)
      .where(eq(schema.matches.qualificationRunId, runId)))[0]!;
    const correctedProposal = { scoreA: 0, scoreB: 2 };
    const correctionPlan = await database.transaction((tx) => planResultCorrectionInTx(tx, {
      matchId: firstMatch.id,
      proposal: correctedProposal,
    }));
    expect(correctionPlan.winnerChanges).toBe(true);
    expect(correctionPlan.blockedReasons).toEqual([]);
    const appliedCorrection = await database.transaction((tx) => applyResultCorrectionInTx(tx, {
      matchId: firstMatch.id,
      proposal: correctedProposal,
      actorId: ACTOR,
      confirmRecovery: true,
    }));
    expect(appliedCorrection.winnerChanged).toBe(true);
    const [reprojectedRun] = await database.select().from(schema.competitionQualificationRuns)
      .where(eq(schema.competitionQualificationRuns.id, runId));
    const correctedFinalIds = await database.transaction((tx) => getCompetitionQualificationFinalEntryIdsInTx(tx, reprojectedRun!));
    expect(correctedFinalIds).toHaveLength(24);
    expect(correctedFinalIds).not.toEqual(originalFinalIds);

    const selected = await database.transaction((tx) => selectMajorEntrantsAndSyncRostersInTx(tx, {
      seasonId: fixture!.seasonId,
      competitionEntryIds: correctedFinalIds,
      actorId: ACTOR,
    }));
    expect(selected.selectedCount).toBe(24);
    const blockedPlan = await database.transaction((tx) => planResultCorrectionInTx(tx, {
      matchId: firstMatch.id,
      proposal: { scoreA: 2, scoreB: 0 },
    }));
    expect(blockedPlan.blockedReasons.some((reason) => reason.code === "qualificationFinalEntrants")).toBe(true);
    await expect(database.transaction((tx) => applyResultCorrectionInTx(tx, {
      matchId: firstMatch.id,
      proposal: { scoreA: 2, scoreB: 0 },
      actorId: ACTOR,
      confirmRecovery: true,
    }))).rejects.toThrow("正赛参赛名单已经产生");
  } finally {
    if (fixture) await cleanupAcceptanceFixture(pool, fixture);
    await pool.end();
  }
}

describe("Issue 743 qualification PostgreSQL acceptance", () => {
  it("takes 30 approved candidates through Short Swiss and locks 18 direct plus 6 qualifiers", async () => {
    await exerciseThirtyToTwentyFourAcceptance();
  });

  it("recovers a wrong Swiss winner only before downstream matches progress", async () => {
    await exerciseShortSwissCorrectionRecovery();
  });

  it("completes Direct BO3 to six qualifiers and reprojects a corrected winner", async () => {
    await exerciseDirectBo3CompletionAndCorrection();
  });
});

describe("Qualification draft and lineup gate", () => {
  for (const format of ["direct_bo3", "short_swiss_2w2l"] as const) {
    it(`${format}: shared draft concurrency, affiliation, frozen strength and revision-bound override`, () => exerciseDraftConcurrencyAndEligibility(format), 120_000);
  }
});
