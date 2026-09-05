import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { selectMajorEntrantsAndSyncRostersInTx, lockMajorPrestartEntrantsInTx } from "../../../src/lib/major/prestart-entrants";
import { reconcileMajorPrestartRosterAfterApprovalInTx } from "../../../src/lib/major/prestart-roster";
import { AppError, ErrorCode } from "../../../src/lib/errors";
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
  const entryA: EntryFixture = { entryId: randomUUID(), revisionId: randomUUID(), userIds: Array.from({ length: 6 }, () => randomUUID()) };
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
        min_team_size, max_team_size, starter_count, positions
      ) VALUES ($1, $2, 'Issue 368 3B Selection', 'Major', 'major', 'registration', $3, $4, $5, $6::json, $7::json, $8::json, $9::json, $10, $11, $12, $13::text[])`,
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

async function approveRevisionAndReconcile(
  database: Database,
  seasonId: string,
  entry: EntryFixture,
  memberUserIds: readonly string[],
  revisionNumber: number,
  revisionId = randomUUID(),
): Promise<boolean> {
  return database.transaction(async (tx) => {
    const participants = await tx.select({
      id: schema.competitionEntryParticipants.id,
      userId: schema.competitionEntryParticipants.userId,
    }).from(schema.competitionEntryParticipants)
      .where(eq(schema.competitionEntryParticipants.entryId, entry.entryId));
    const participantByUserId = new Map(participants.map((participant) => [participant.userId, participant.id]));
    await tx.insert(schema.competitionEntryRosterRevisions).values({
      id: revisionId,
      entryId: entry.entryId,
      revisionNumber,
      status: "approved",
      createdBy: ACTOR,
      approvedAt: new Date(),
    });
    await tx.insert(schema.competitionEntryRosterMembers).values(memberUserIds.map((userId, index) => {
      const participantId = participantByUserId.get(userId);
      if (!participantId) throw new Error(`fixture participant missing for ${entry.entryId}/${userId}`);
      return { revisionId, participantId, userId, isPrimaryStarter: index < 5 };
    }));
    await tx.update(schema.competitionEntries).set({
      currentRosterRevisionId: revisionId,
      approvedRosterRevisionId: revisionId,
      updatedAt: new Date(),
    }).where(eq(schema.competitionEntries.id, entry.entryId));
    return reconcileMajorPrestartRosterAfterApprovalInTx(tx, { seasonId, entryId: entry.entryId, actorId: ACTOR });
  });
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

    const revisionA2 = randomUUID();
    const reconciled = await approveRevisionAndReconcile(database, fixture.seasonId, fixture.entryA, fixture.entryA.userIds, 2, revisionA2);
    expect(reconciled).toBe(true);
    expect(await readRoster(pool, fixture.entryA.entryId)).toMatchObject({ status: "confirmed", source: revisionA2, members: 6, primary: 5, missingEducation: 0 });

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
    const removeFrozenError = await database.transaction((tx) => selectMajorEntrantsAndSyncRostersInTx(tx, {
      seasonId: fixture!.seasonId,
      competitionEntryIds: [],
      actorId: ACTOR,
    })).catch((error: unknown) => error);
    expect(removeFrozenError).toMatchObject({ code: ErrorCode.SEASON_INVALID_STATUS });
    expect((removeFrozenError as AppError).message).toContain("冻结");
    expect(await readCounts(pool, fixture)).toMatchObject({ entrants: 1 });

    const revisionB2 = randomUUID();
    const frozenError = await approveRevisionAndReconcile(database, fixture.seasonId, fixture.entryB, fixture.entryB.userIds, 2, revisionB2).catch((error: unknown) => error);
    expect(frozenError).toMatchObject({ code: ErrorCode.SEASON_INVALID_STATUS });
    expect((frozenError as AppError).message).toContain("已冻结");
    expect(await readRoster(pool, fixture.entryB.entryId)).toMatchObject({ status: "frozen", source: fixture.entryB.revisionId, members: 5, primary: 5, missingEducation: 0 });
    expect(await readCounts(pool, fixture)).toMatchObject({ entrants: 1, cRosters: 0, auditSelection: 3, auditReconcile: 1 });
    expect(revisionB2).not.toBe(fixture.entryB.revisionId);
  } finally {
    if (fixture) await cleanup(pool, fixture);
    await pool.end();
  }
}

describe("Major prestart final Entry selection", () => {
  it("materializes the approved roster, keeps selection atomic, reconciles new approvals, and fails closed after freeze", async () => {
    await exerciseSelectionWorkflow();
  });
});
