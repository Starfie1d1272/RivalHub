import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { selectMajorEntrantsAndSyncRostersInTx, lockMajorPrestartEntrantsInTx } from "../../../src/lib/major/prestart-entrants";
import { requestCompetitionEntryRosterChangeInTx } from "../../../src/lib/competition-entries/roster-change";
import { reviewCompetitionEntryInTx, submitCompetitionEntryInTx } from "../../../src/lib/competition-entries/commands";
import { AppError, ErrorCode } from "../../../src/lib/errors";
import { checkStandardMajorCapabilities } from "../../../src/lib/competition/definition";
import { createMajorDefaultCapabilities } from "../../../src/types/season";
import { createPerfectWorldRankOrder } from "../../../src/lib/config/perfect-world";
import { localDatabaseUrl } from "./harness/database";

const databaseUrl = localDatabaseUrl();
const ACTOR = "issue-368-3b-local-admin";
const NJU_CODE = "4132010284";
const COMPETITIVE_PROFILE = {
  platform: "perfect_world",
  currentSeasonKey: "issue-368-3b-current",
  previousSeasonKey: "issue-368-3b-previous",
  rankOrder: createPerfectWorldRankOrder(),
} as const;

type Database = ReturnType<typeof drizzle<typeof schema>>;

interface EntryFixture {
  entryId: string;
  revisionId: string;
  userIds: string[];
}

interface SelectionFixture {
  seasonId: string;
  entryA: EntryFixture;
  entryB: EntryFixture;
  entryC: EntryFixture;
  allUserIds: string[];
}

interface FullFreezeFixture {
  seasonId: string;
  entries: EntryFixture[];
  allUserIds: string[];
}

async function insertApprovedRevision(
  client: PoolClient,
  entry: EntryFixture,
  revisionId: string,
  revisionNumber: number,
  memberUserIds: readonly string[],
): Promise<void> {
  await client.query(
    `INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by, approved_at)
     VALUES ($1, $2, $3, 'approved', $4, now())`,
    [revisionId, entry.entryId, revisionNumber, ACTOR],
  );
  for (const [index, userId] of memberUserIds.entries()) {
    const participant = await client.query<{ id: string }>(
      "SELECT id FROM competition_entry_participants WHERE entry_id = $1 AND user_id = $2",
      [entry.entryId, userId],
    );
    if (!participant.rows[0]) throw new Error(`fixture participant missing for ${entry.entryId}/${userId}`);
    await client.query(
      `INSERT INTO competition_entry_roster_members (revision_id, participant_id, user_id, is_primary_starter)
       VALUES ($1, $2, $3, $4)`,
      [revisionId, participant.rows[0].id, userId, index < 5],
    );
  }
}

async function insertApprovedEntry(
  client: PoolClient,
  seasonId: string,
  entry: EntryFixture,
  name: string,
  memberUserIds: readonly string[],
): Promise<void> {
  await client.query(
    `INSERT INTO competition_entries (
       id, competition_id, source, name, logo_url, representative_user_id, perfect_team_id,
       current_roster_revision_id, approved_roster_revision_id, registration_status,
       submitted_at, reviewed_at
     ) VALUES ($1, $2, 'event_native', $3, $4, $5, $6, $7, $7, 'approved', now(), now())`,
    [entry.entryId, seasonId, name, `https://local.test/${entry.entryId}.png`, memberUserIds[0], `fixture-${entry.entryId}`, entry.revisionId],
  );
  await client.query(
    "INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id) VALUES ($1, NULL, $2, $3)",
    [entry.entryId, memberUserIds[0], ACTOR],
  );
  for (const userId of entry.userIds) {
    await client.query(
      `INSERT INTO competition_entry_participants (entry_id, user_id, status, confirmed_at, invited_by_user_id)
       VALUES ($1, $2, 'confirmed', now(), $3)`,
      [entry.entryId, userId, memberUserIds[0]],
    );
  }
  await insertApprovedRevision(client, entry, entry.revisionId, 1, memberUserIds);
}

async function prepareFixture(pool: Pool): Promise<SelectionFixture> {
  const client = await pool.connect();
  const seasonId = randomUUID();
  const entryA: EntryFixture = { entryId: randomUUID(), revisionId: randomUUID(), userIds: Array.from({ length: 7 }, () => randomUUID()) };
  const entryB: EntryFixture = { entryId: randomUUID(), revisionId: randomUUID(), userIds: Array.from({ length: 6 }, () => randomUUID()) };
  const entryC: EntryFixture = { entryId: randomUUID(), revisionId: randomUUID(), userIds: [entryA.userIds[0]!, ...Array.from({ length: 4 }, () => randomUUID())] };
  const allUserIds = [...new Set([...entryA.userIds, ...entryB.userIds, ...entryC.userIds])];
  const capabilities = createMajorDefaultCapabilities();
  capabilities.teamRegistrationConfig.competitiveProfile = { ...COMPETITIVE_PROFILE, rankOrder: [...COMPETITIVE_PROFILE.rankOrder] };

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO seasons (
        id, slug, name, kind, competition_template, status, registration_mode, has_captain_voting, has_draft,
        stage_plan, registration_config, team_registration_config, affiliation_rules,
        min_team_size, max_team_size, starter_count, positions,
        registration_opens_at, registration_opened_at, registration_closes_at
      ) VALUES ($1, $2, 'Issue 368 3B Selection', 'Major', 'major', 'registration', $3, $4, $5, $6::json, $7::json, $8::json, $9::json, $10, $11, $12, $13::text[], $14, $15, $16)`,
      [
        seasonId,
        `local-issue-368-3b-${seasonId}`,
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
        new Date(Date.now() - 60 * 60 * 1000),
        new Date(Date.now() - 60 * 60 * 1000),
        new Date(Date.now() + 24 * 60 * 60 * 1000),
      ],
    );
    for (const [index, userId] of allUserIds.entries()) {
      await client.query(
        `INSERT INTO users (
           id, email, email_verified_at, display_name, perfect_name, steam64, qq
         ) VALUES ($1, $2, now(), $3, $4, $5, $6)`,
        [
          userId,
          `issue-368-3b-${index}-${seasonId}@local.test`,
          `3B Player ${index}`,
          `3B Perfect ${index}`,
          String(76561198000000000 + index),
          String(10000000 + index),
        ],
      );
      await client.query(
        `INSERT INTO competitive_rank_facts (user_id, platform, kind, platform_season_key, rank, rating)
         VALUES
           ($1, $2, 'historical_peak', NULL, 'A', 1000),
           ($1, $2, 'season_peak', $3, 'A', 1000),
           ($1, $2, 'season_peak', $4, 'A', 1000)`,
        [userId, COMPETITIVE_PROFILE.platform, COMPETITIVE_PROFILE.previousSeasonKey, COMPETITIVE_PROFILE.currentSeasonKey],
      );
      await client.query(
        `INSERT INTO education_verifications (user_id, institution_id, academic_status, evidence_type, status, reviewed_by, reviewed_at)
         SELECT $1, i.id, 'enrolled', 'manual_other', 'approved', $2, now()
         FROM institutions i WHERE i.moe_institution_code = $3`,
        [userId, ACTOR, NJU_CODE],
      );
    }
    const educationCount = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM education_verifications WHERE user_id = ANY($1::uuid[])",
      [allUserIds],
    );
    if (Number(educationCount.rows[0]?.count) !== allUserIds.length) {
      throw new Error("fixture requires the seeded NJU institution directory");
    }
    await insertApprovedEntry(client, seasonId, entryA, "Entry Alpha", entryA.userIds.slice(0, 5));
    await insertApprovedEntry(client, seasonId, entryB, "Entry Beta", entryB.userIds.slice(0, 5));
    await insertApprovedEntry(client, seasonId, entryC, "Entry Duplicate", entryC.userIds);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { seasonId, entryA, entryB, entryC, allUserIds };
}

async function prepareFullFreezeFixture(pool: Pool): Promise<FullFreezeFixture> {
  const client = await pool.connect();
  const seasonId = randomUUID();
  const capabilities = createMajorDefaultCapabilities();
  capabilities.teamRegistrationConfig.competitiveProfile = { ...COMPETITIVE_PROFILE, rankOrder: [...COMPETITIVE_PROFILE.rankOrder] };
  const entrantCapacity = checkStandardMajorCapabilities(capabilities).entrantCapacity;
  const entries = Array.from({ length: entrantCapacity }, () => ({
    entryId: randomUUID(),
    revisionId: randomUUID(),
    userIds: Array.from({ length: capabilities.minTeamSize }, () => randomUUID()),
  }));
  const allUserIds = entries.flatMap((entry) => entry.userIds);

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO seasons (
        id, slug, name, kind, competition_template, status, registration_mode, has_captain_voting, has_draft,
        stage_plan, registration_config, team_registration_config, affiliation_rules,
        min_team_size, max_team_size, starter_count, positions
      ) VALUES ($1, $2, 'Issue 368 3B Full Freeze', 'Major', 'major', 'registration', $3, $4, $5, $6::json, $7::json, $8::json, $9::json, $10, $11, $12, $13::text[])`,
      [
        seasonId,
        `local-issue-368-3b-freeze-${seasonId}`,
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
    for (const [index, userId] of allUserIds.entries()) {
      await client.query(
        `INSERT INTO users (
           id, email, email_verified_at, display_name, perfect_name, steam64, qq
         ) VALUES ($1, $2, now(), $3, $4, $5, $6)`,
        [
          userId,
          `issue-368-3b-freeze-${index}-${seasonId}@local.test`,
          `3B Freeze Player ${index}`,
          `3B Freeze Perfect ${index}`,
          String(76561198010000000 + index),
          String(20000000 + index),
        ],
      );
      await client.query(
        `INSERT INTO competitive_rank_facts (user_id, platform, kind, platform_season_key, rank, rating)
         VALUES
           ($1, $2, 'historical_peak', NULL, 'A', 1000),
           ($1, $2, 'season_peak', $3, 'A', 1000),
           ($1, $2, 'season_peak', $4, 'A', 1000)`,
        [userId, COMPETITIVE_PROFILE.platform, COMPETITIVE_PROFILE.previousSeasonKey, COMPETITIVE_PROFILE.currentSeasonKey],
      );
      await client.query(
        `INSERT INTO education_verifications (user_id, institution_id, academic_status, evidence_type, status, reviewed_by, reviewed_at)
         SELECT $1, i.id, 'enrolled', 'manual_other', 'approved', $2, now()
         FROM institutions i WHERE i.moe_institution_code = $3`,
        [userId, ACTOR, NJU_CODE],
      );
    }
    const educationCount = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM education_verifications WHERE user_id = ANY($1::uuid[])",
      [allUserIds],
    );
    if (Number(educationCount.rows[0]?.count) !== allUserIds.length) {
      throw new Error("fixture requires the seeded NJU institution directory");
    }
    for (const [index, entry] of entries.entries()) {
      await insertApprovedEntry(client, seasonId, entry, `Freeze Entry ${index}`, entry.userIds);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { seasonId, entries, allUserIds };
}

async function readRoster(pool: Pool, entryId: string): Promise<{ status: string; source: string | null; members: number; primary: number; missingEducation: number } | null> {
  const result = await pool.query<{ status: string; source: string | null; members: number; primary: number; missingEducation: number }>(
    `SELECT er.status, er.source_roster_revision_id AS source,
            count(erm.id)::int AS members,
            count(erm.id) FILTER (WHERE erm.is_primary_starter)::int AS primary,
            count(erm.id) FILTER (WHERE erm.education_verification_id IS NULL)::int AS "missingEducation"
     FROM event_rosters er
     LEFT JOIN event_roster_members erm ON erm.event_roster_id = er.id
     WHERE er.entry_id = $1
     GROUP BY er.id`,
    [entryId],
  );
  return result.rows[0] ?? null;
}

async function readRosterMembers(pool: Pool, entryId: string): Promise<Array<{ userId: string; primary: boolean; educationVerificationId: string | null }>> {
  const result = await pool.query<{ userId: string; primary: boolean; educationVerificationId: string | null }>(
    `SELECT user_id AS "userId", is_primary_starter AS primary, education_verification_id AS "educationVerificationId"
     FROM event_roster_members
     WHERE event_roster_id = (SELECT id FROM event_rosters WHERE entry_id = $1)
     ORDER BY user_id`,
    [entryId],
  );
  return result.rows;
}

async function readCounts(pool: Pool, fixture: SelectionFixture): Promise<{ entrants: number; cRosters: number; auditSelection: number; auditReconcile: number }> {
  const result = await pool.query<{ entrants: string; cRosters: string; auditSelection: string; auditReconcile: string }>(
    `SELECT
       (SELECT count(*)::text FROM major_tournament_entrants WHERE season_id = $1) AS entrants,
       (SELECT count(*)::text FROM event_rosters WHERE entry_id = $2) AS "cRosters",
       (SELECT count(*)::text FROM audit_logs WHERE season_id = $1 AND action = 'major_prestart.select_entrants') AS "auditSelection",
       (SELECT count(*)::text FROM audit_logs WHERE season_id = $1 AND action = 'major_prestart.reconcile_roster') AS "auditReconcile"`,
    [fixture.seasonId, fixture.entryC.entryId],
  );
  const row = result.rows[0]!;
  return { entrants: Number(row.entrants), cRosters: Number(row.cRosters), auditSelection: Number(row.auditSelection), auditReconcile: Number(row.auditReconcile) };
}

async function prepareSubmittedRosterChange(
  database: Database,
  entry: EntryFixture,
  memberUserIds: readonly string[],
  primaryStarterUserIds: readonly string[] = memberUserIds,
): Promise<string> {
  return database.transaction(async (tx) => {
    await requestCompetitionEntryRosterChangeInTx(tx, {
      entryId: entry.entryId,
      representativeUserId: entry.userIds[0]!,
      actorId: ACTOR,
    });
    const [currentEntry] = await tx.select({ currentRosterRevisionId: schema.competitionEntries.currentRosterRevisionId })
      .from(schema.competitionEntries)
      .where(eq(schema.competitionEntries.id, entry.entryId));
    if (!currentEntry) throw new Error(`fixture entry missing after roster change request: ${entry.entryId}`);
    const revisionId = currentEntry.currentRosterRevisionId;
    const participants = await tx.select({
      id: schema.competitionEntryParticipants.id,
      userId: schema.competitionEntryParticipants.userId,
    }).from(schema.competitionEntryParticipants)
      .where(eq(schema.competitionEntryParticipants.entryId, entry.entryId));
    const participantByUserId = new Map(participants.map((participant) => [participant.userId, participant.id]));
    await tx.delete(schema.competitionEntryRosterMembers).where(eq(schema.competitionEntryRosterMembers.revisionId, revisionId));
    await tx.insert(schema.competitionEntryRosterMembers).values(memberUserIds.map((userId) => {
      const participantId = participantByUserId.get(userId);
      if (!participantId) throw new Error(`fixture participant missing for ${entry.entryId}/${userId}`);
      return { revisionId, participantId, userId, isPrimaryStarter: primaryStarterUserIds.includes(userId) };
    }));
    await submitCompetitionEntryInTx(tx, { entryId: entry.entryId, userId: entry.userIds[0]!, actorId: ACTOR });
    return revisionId;
  });
}

async function approveSubmittedRosterChange(database: Database, entryId: string): Promise<void> {
  await database.transaction((tx) => reviewCompetitionEntryInTx(tx, {
    entryId,
    decision: "approved",
    actorId: ACTOR,
  }));
}

async function cleanup(pool: Pool, fixture: SelectionFixture): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query("DELETE FROM audit_logs WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_tournament_seeds WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_tournament_entrants WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_prestart_states WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM event_roster_members WHERE event_roster_id IN (SELECT id FROM event_rosters WHERE entry_id IN ($1,$2,$3))", [fixture.entryA.entryId, fixture.entryB.entryId, fixture.entryC.entryId]);
    await client.query("DELETE FROM event_rosters WHERE entry_id IN ($1,$2,$3)", [fixture.entryA.entryId, fixture.entryB.entryId, fixture.entryC.entryId]);
    await client.query("DELETE FROM competition_entry_submissions WHERE entry_id IN ($1,$2,$3)", [fixture.entryA.entryId, fixture.entryB.entryId, fixture.entryC.entryId]);
    await client.query("DELETE FROM competition_entry_roster_members WHERE revision_id IN (SELECT id FROM competition_entry_roster_revisions WHERE entry_id IN ($1,$2,$3))", [fixture.entryA.entryId, fixture.entryB.entryId, fixture.entryC.entryId]);
    await client.query("DELETE FROM competition_entry_roster_revisions WHERE entry_id IN ($1,$2,$3)", [fixture.entryA.entryId, fixture.entryB.entryId, fixture.entryC.entryId]);
    await client.query("DELETE FROM competition_entry_representative_changes WHERE entry_id IN ($1,$2,$3)", [fixture.entryA.entryId, fixture.entryB.entryId, fixture.entryC.entryId]);
    await client.query("DELETE FROM competition_entry_participants WHERE entry_id IN ($1,$2,$3)", [fixture.entryA.entryId, fixture.entryB.entryId, fixture.entryC.entryId]);
    await client.query("DELETE FROM competition_entries WHERE id IN ($1,$2,$3)", [fixture.entryA.entryId, fixture.entryB.entryId, fixture.entryC.entryId]);
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

async function cleanupFullFreeze(pool: Pool, fixture: FullFreezeFixture): Promise<void> {
  const client = await pool.connect();
  const entryIds = fixture.entries.map((entry) => entry.entryId);
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query("DELETE FROM audit_logs WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_tournament_seeds WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_tournament_entrants WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_prestart_states WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM event_roster_members WHERE event_roster_id IN (SELECT id FROM event_rosters WHERE entry_id = ANY($1::uuid[]))", [entryIds]);
    await client.query("DELETE FROM event_rosters WHERE entry_id = ANY($1::uuid[])", [entryIds]);
    await client.query("DELETE FROM competition_entry_submissions WHERE entry_id = ANY($1::uuid[])", [entryIds]);
    await client.query("DELETE FROM competition_entry_roster_members WHERE revision_id IN (SELECT id FROM competition_entry_roster_revisions WHERE entry_id = ANY($1::uuid[]))", [entryIds]);
    await client.query("DELETE FROM competition_entry_roster_revisions WHERE entry_id = ANY($1::uuid[])", [entryIds]);
    await client.query("DELETE FROM competition_entry_representative_changes WHERE entry_id = ANY($1::uuid[])", [entryIds]);
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

async function exerciseSelectionWorkflow(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 4 });
  const database = drizzle(pool, { schema });
  let fixture: SelectionFixture | undefined;
  try {
    fixture = await prepareFixture(pool);

    const first = await database.transaction((tx) => selectMajorEntrantsAndSyncRostersInTx(tx, {
      seasonId: fixture!.seasonId,
      competitionEntryIds: [fixture!.entryA.entryId],
      actorId: ACTOR,
    }));
    expect(first).toMatchObject({ selectedCount: 1, synchronizedRosterCount: 1, changed: true });
    const firstRoster = await readRoster(pool, fixture.entryA.entryId);
    expect(firstRoster).toMatchObject({ status: "confirmed", source: fixture.entryA.revisionId, members: 5, primary: 5, missingEducation: 0 });

    const retry = await database.transaction((tx) => selectMajorEntrantsAndSyncRostersInTx(tx, {
      seasonId: fixture!.seasonId,
      competitionEntryIds: [fixture!.entryA.entryId],
      actorId: ACTOR,
    }));
    expect(retry).toMatchObject({ selectedCount: 1, synchronizedRosterCount: 0, changed: false });

    const atomicError = await database.transaction((tx) => selectMajorEntrantsAndSyncRostersInTx(tx, {
      seasonId: fixture!.seasonId,
      competitionEntryIds: [fixture!.entryA.entryId, fixture!.entryC.entryId],
      actorId: ACTOR,
    })).catch((error: unknown) => error);
    expect(atomicError).toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect((atomicError as AppError).message).toContain("重复选手");
    expect(await readCounts(pool, fixture)).toMatchObject({ entrants: 1, cRosters: 0 });

    const expanded = await database.transaction((tx) => selectMajorEntrantsAndSyncRostersInTx(tx, {
      seasonId: fixture!.seasonId,
      competitionEntryIds: [fixture!.entryA.entryId, fixture!.entryB.entryId],
      actorId: ACTOR,
    }));
    expect(expanded).toMatchObject({ selectedCount: 2, synchronizedRosterCount: 1, changed: true });
    expect(await readRoster(pool, fixture.entryB.entryId)).toMatchObject({ status: "confirmed", source: fixture.entryB.revisionId, members: 5, primary: 5, missingEducation: 0 });

    const approvedA2Members = [
      fixture.entryA.userIds[0]!,
      fixture.entryA.userIds[1]!,
      fixture.entryA.userIds[2]!,
      fixture.entryA.userIds[3]!,
      fixture.entryA.userIds[5]!,
      fixture.entryA.userIds[6]!,
    ];
    const revisionA2 = await prepareSubmittedRosterChange(
      database,
      fixture.entryA,
      approvedA2Members,
      approvedA2Members.slice(0, 5),
    );
    await approveSubmittedRosterChange(database, fixture.entryA.entryId);
    expect(await readRoster(pool, fixture.entryA.entryId)).toMatchObject({ status: "confirmed", source: revisionA2, members: 6, primary: 5, missingEducation: 0 });
    const rosterA2Members = await readRosterMembers(pool, fixture.entryA.entryId);
    expect(rosterA2Members.map((member) => member.userId)).toEqual([...approvedA2Members].sort());
    expect(rosterA2Members.filter((member) => member.primary).map((member) => member.userId)).toEqual([...approvedA2Members.slice(0, 5)].sort());
    expect(rosterA2Members.every((member) => member.educationVerificationId !== null)).toBe(true);
    expect(rosterA2Members.some((member) => member.userId === fixture!.entryA.userIds[4])).toBe(false);

    const lockError = await database.transaction((tx) => lockMajorPrestartEntrantsInTx(tx, {
      seasonId: fixture!.seasonId,
      actorId: ACTOR,
    })).catch((error: unknown) => error);
    expect(lockError).toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(await readRoster(pool, fixture.entryA.entryId)).toMatchObject({ status: "confirmed" });
    expect(await readRoster(pool, fixture.entryB.entryId)).toMatchObject({ status: "confirmed" });

    const finalSet = await database.transaction((tx) => selectMajorEntrantsAndSyncRostersInTx(tx, {
      seasonId: fixture!.seasonId,
      competitionEntryIds: [fixture!.entryB.entryId],
      actorId: ACTOR,
    }));
    expect(finalSet).toMatchObject({ selectedCount: 1, synchronizedRosterCount: 0, changed: true });

    const submittedB2Members = [
      fixture.entryB.userIds[0]!,
      fixture.entryB.userIds[1]!,
      fixture.entryB.userIds[2]!,
      fixture.entryB.userIds[3]!,
      fixture.entryB.userIds[5]!,
    ];
    const revisionB2 = await prepareSubmittedRosterChange(database, fixture.entryB, submittedB2Members);
    const freezeClient = await pool.connect();
    try {
      await freezeClient.query(
        `UPDATE event_rosters SET status = 'frozen', confirmed_at = now(), confirmed_by = $2,
         frozen_at = now(), frozen_by = $2 WHERE entry_id = $1`,
        [fixture.entryB.entryId, ACTOR],
      );
    } finally {
      freezeClient.release();
    }
    const frozenError = await database.transaction((tx) => reviewCompetitionEntryInTx(tx, {
      entryId: fixture!.entryB.entryId,
      decision: "approved",
      actorId: ACTOR,
    })).catch((error: unknown) => error);
    expect(frozenError).toMatchObject({ code: ErrorCode.SEASON_INVALID_STATUS });
    expect((frozenError as AppError).message).toContain("已冻结");
    expect(await readRoster(pool, fixture.entryB.entryId)).toMatchObject({ status: "frozen", source: fixture.entryB.revisionId, members: 5, primary: 5, missingEducation: 0 });
    expect((await readRosterMembers(pool, fixture.entryB.entryId)).map((member) => member.userId)).toEqual([...fixture.entryB.userIds.slice(0, 5)].sort());
    expect(await readCounts(pool, fixture)).toMatchObject({ entrants: 1, cRosters: 0, auditSelection: 3, auditReconcile: 1 });
    expect(revisionB2).not.toBe(fixture.entryB.revisionId);
    const rolledBackEntry = await pool.query<{ registrationStatus: string; currentRosterRevisionId: string; approvedRosterRevisionId: string }>(
      "SELECT registration_status AS \"registrationStatus\", current_roster_revision_id AS \"currentRosterRevisionId\", approved_roster_revision_id AS \"approvedRosterRevisionId\" FROM competition_entries WHERE id = $1",
      [fixture.entryB.entryId],
    );
    expect(rolledBackEntry.rows[0]).toMatchObject({
      registrationStatus: "submitted",
      currentRosterRevisionId: revisionB2,
      approvedRosterRevisionId: fixture.entryB.revisionId,
    });
    const rolledBackRevision = await pool.query<{ status: string; decision: string }>(
      `SELECT r.status, s.decision
       FROM competition_entry_roster_revisions r
       INNER JOIN competition_entry_submissions s ON s.roster_revision_id = r.id
       WHERE r.id = $1`,
      [revisionB2],
    );
    expect(rolledBackRevision.rows[0]).toEqual({ status: "submitted", decision: "submitted" });

    const removeFrozenError = await database.transaction((tx) => selectMajorEntrantsAndSyncRostersInTx(tx, {
      seasonId: fixture!.seasonId,
      competitionEntryIds: [],
      actorId: ACTOR,
    })).catch((error: unknown) => error);
    expect(removeFrozenError).toMatchObject({ code: ErrorCode.SEASON_INVALID_STATUS });
    expect((removeFrozenError as AppError).message).toContain("冻结");
    expect(await readCounts(pool, fixture)).toMatchObject({ entrants: 1, cRosters: 0, auditSelection: 3, auditReconcile: 1 });
  } finally {
    if (fixture) await cleanup(pool, fixture);
    await pool.end();
  }
}

async function exerciseSuccessfulFreezeWorkflow(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 4 });
  const database = drizzle(pool, { schema });
  let fixture: FullFreezeFixture | undefined;
  try {
    fixture = await prepareFullFreezeFixture(pool);
    const entryIds = fixture.entries.map((entry) => entry.entryId);

    const selected = await database.transaction((tx) => selectMajorEntrantsAndSyncRostersInTx(tx, {
      seasonId: fixture!.seasonId,
      competitionEntryIds: entryIds,
      actorId: ACTOR,
    }));
    expect(selected).toMatchObject({
      selectedCount: fixture.entries.length,
      synchronizedRosterCount: fixture.entries.length,
      changed: true,
    });

    const beforeLock = await pool.query<{ total: string; confirmed: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE status = 'confirmed')::text AS confirmed
       FROM event_rosters WHERE entry_id = ANY($1::uuid[])`,
      [entryIds],
    );
    expect(beforeLock.rows[0]).toEqual({ total: String(fixture.entries.length), confirmed: String(fixture.entries.length) });

    const locked = await database.transaction((tx) => lockMajorPrestartEntrantsInTx(tx, {
      seasonId: fixture!.seasonId,
      actorId: ACTOR,
    }));
    expect(locked).toMatchObject({ entrantCount: fixture.entries.length, alreadyLocked: false });

    const state = await pool.query<{ lockedAt: Date | null; lockedBy: string | null }>(
      `SELECT entrants_locked_at AS "lockedAt", entrants_locked_by AS "lockedBy"
       FROM major_prestart_states WHERE season_id = $1`,
      [fixture.seasonId],
    );
    expect(state.rows[0]?.lockedAt).toBeInstanceOf(Date);
    expect(state.rows[0]?.lockedBy).toBe(ACTOR);
    const rosterState = await pool.query<{ total: string; frozen: string; complete: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE status = 'frozen')::text AS frozen,
              count(*) FILTER (WHERE status = 'frozen' AND confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL AND frozen_at IS NOT NULL AND frozen_by IS NOT NULL)::text AS complete
       FROM event_rosters WHERE entry_id = ANY($1::uuid[])`,
      [entryIds],
    );
    expect(rosterState.rows[0]).toEqual({
      total: String(fixture.entries.length),
      frozen: String(fixture.entries.length),
      complete: String(fixture.entries.length),
    });
    const audit = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_logs WHERE season_id = $1 AND action = 'major_prestart.lock_entrants'",
      [fixture.seasonId],
    );
    expect(audit.rows[0]?.count).toBe("1");

    const retry = await database.transaction((tx) => lockMajorPrestartEntrantsInTx(tx, {
      seasonId: fixture!.seasonId,
      actorId: ACTOR,
    }));
    expect(retry).toMatchObject({ entrantCount: fixture.entries.length, alreadyLocked: true });
    const retryAudit = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_logs WHERE season_id = $1 AND action = 'major_prestart.lock_entrants'",
      [fixture.seasonId],
    );
    expect(retryAudit.rows[0]?.count).toBe("1");
  } finally {
    if (fixture) await cleanupFullFreeze(pool, fixture);
    await pool.end();
  }
}

describe("Major prestart final Entry selection", () => {
  it("materializes the approved roster, keeps selection atomic, reconciles new approvals, and fails closed after freeze", async () => {
    await exerciseSelectionWorkflow();
  });

  it("locks exactly the canonical capacity in PostgreSQL and is idempotent", async () => {
    await exerciseSuccessfulFreezeWorkflow();
  });
});
