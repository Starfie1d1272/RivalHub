import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  readVetoRoomCore,
  requestVetoStart,
  setManualPrivilegedEntry,
  submitVetoCommand,
} from "../../../src/lib/matches/veto-room/service";
import { localDatabaseUrl } from "./harness/database";

async function waitForMatchRowLock(pool: Pool): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity
       WHERE pid <> pg_backend_pid()
         AND wait_event_type = 'Lock'
         AND query ILIKE '%FROM "matches"%'
         AND query ILIKE '%FOR UPDATE%'`,
    );
    if (result.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("expected Veto Room command to wait for the Match row lock");
}

const requireSeasonAdminMock = vi.hoisted(() => vi.fn());
const auditActorIdMock = vi.hoisted(() => vi.fn((session: { userId: string }) => session.userId));

vi.mock("@/lib/auth/session", () => ({
  requireSeasonAdmin: requireSeasonAdminMock,
  auditActorId: auditActorIdMock,
}));

vi.mock("@/lib/revalidation", () => ({
  revalidateMatchPaths: vi.fn(),
}));

vi.mock("@/lib/seasons/transitions", () => ({
  maybeFinishSeason: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

import {
  correctMapScore,
  forfeitMatch,
  recordMapResult,
} from "../../../src/actions/matches/results";

type MatchFormat = "bo1" | "bo3" | "bo5";

const MAP_POOL = [
  "de_ancient",
  "de_anubis",
  "de_cache",
  "de_dust2",
  "de_inferno",
  "de_mirage",
  "de_nuke",
] as const;

interface Fixture {
  seasonId: string;
  adminId: string;
  entryAId: string;
  entryBId: string;
  representativeUserAId: string;
  representativeUserBId: string;
  memberAId: string;
  memberBId: string;
  eventRosterAId: string;
  eventRosterBId: string;
}

async function createFixture(client: import("pg").PoolClient): Promise<Fixture> {
  const fixture: Fixture = {
    seasonId: randomUUID(),
    adminId: randomUUID(),
    entryAId: randomUUID(),
    entryBId: randomUUID(),
    representativeUserAId: randomUUID(),
    representativeUserBId: randomUUID(),
    memberAId: randomUUID(),
    memberBId: randomUUID(),
    eventRosterAId: randomUUID(),
    eventRosterBId: randomUUID(),
  };
  const revisionAId = randomUUID();
  const revisionBId = randomUUID();
  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4), ($5, $6)",
      [
        fixture.adminId,
        `score-admin-${fixture.seasonId}@local.test`,
        fixture.representativeUserAId,
        `score-a-${fixture.seasonId}@local.test`,
        fixture.representativeUserBId,
        `score-b-${fixture.seasonId}@local.test`,
      ],
    );
    await client.query(
      `INSERT INTO seasons (
         id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft,
         stage_plan, registration_config, team_registration_config, min_team_size, max_team_size, starter_count
       ) VALUES ($1, $2, 'Match score semantics', 'Rivals', 'playing', 'team', false, false,
         '[]'::json, $3::json, '{}'::json, 1, 1, 1)`,
      [
        fixture.seasonId,
        `match-score-semantics-${fixture.seasonId}`,
        JSON.stringify({ mapPool: MAP_POOL }),
      ],
    );
    await client.query(
      `INSERT INTO competition_entries (
         id, competition_id, source, name, representative_user_id,
         current_roster_revision_id, approved_roster_revision_id, registration_status
       ) VALUES ($1, $2, 'event_native', 'Score A', $3, $4, $4, 'approved'),
                ($5, $2, 'event_native', 'Score B', $6, $7, $7, 'approved')`,
      [fixture.entryAId, fixture.seasonId, fixture.representativeUserAId, revisionAId, fixture.entryBId, fixture.representativeUserBId, revisionBId],
    );
    await client.query(
      `INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id)
       VALUES ($1, NULL, $2, 'score-test'), ($3, NULL, $4, 'score-test')`,
      [fixture.entryAId, fixture.representativeUserAId, fixture.entryBId, fixture.representativeUserBId],
    );
    await client.query(
      `INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by, approved_at)
       VALUES ($1, $2, 1, 'approved', 'score-test', now()),
              ($3, $4, 1, 'approved', 'score-test', now())`,
      [revisionAId, fixture.entryAId, revisionBId, fixture.entryBId],
    );
    await client.query(
      `INSERT INTO event_rosters (
         id, entry_id, source_roster_revision_id, status, confirmed_at, confirmed_by, frozen_at, frozen_by
       ) VALUES ($1, $2, $3, 'preparing', NULL, NULL, NULL, NULL),
                ($4, $5, $6, 'preparing', NULL, NULL, NULL, NULL)`,
      [fixture.eventRosterAId, fixture.entryAId, revisionAId, fixture.eventRosterBId, fixture.entryBId, revisionBId],
    );
    await client.query(
      `INSERT INTO event_roster_members (id, event_roster_id, user_id, is_primary_starter)
       VALUES ($1, $2, $3, true), ($4, $5, $6, true)`,
      [fixture.memberAId, fixture.eventRosterAId, fixture.representativeUserAId, fixture.memberBId, fixture.eventRosterBId, fixture.representativeUserBId],
    );
    await client.query(
      `UPDATE event_rosters
       SET status = 'confirmed', confirmed_at = now(), confirmed_by = 'score-test'
       WHERE id IN ($1, $2)`,
      [fixture.eventRosterAId, fixture.eventRosterBId],
    );
    await client.query(
      `UPDATE event_rosters
       SET status = 'frozen', frozen_at = now(), frozen_by = 'score-test'
       WHERE id IN ($1, $2)`,
      [fixture.eventRosterAId, fixture.eventRosterBId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  return fixture;
}

async function createMatch(
  client: import("pg").PoolClient,
  fixture: Fixture,
  format: MatchFormat,
  options: { withLineups?: boolean } = {},
): Promise<string> {
  const matchId = randomUUID();
  await client.query(
    `INSERT INTO matches (id, season_id, entry_a_id, entry_b_id, stage, format, status)
     VALUES ($1, $2, $3, $4, 'qualifier', $5, 'scheduled')`,
    [matchId, fixture.seasonId, fixture.entryAId, fixture.entryBId, format],
  );

  if (options.withLineups) {
    const rosterAId = randomUUID();
    const rosterBId = randomUUID();
    await client.query(
      `INSERT INTO match_rosters (
         id, match_id, entry_id, submitted_by, source, status, locked_at, confirmed_at, confirmed_by
       ) VALUES ($1, $2, $3, NULL, 'admin_select', 'confirmed', now(), now(), 'score-test'),
                ($4, $2, $5, NULL, 'admin_select', 'confirmed', now(), now(), 'score-test')`,
      [rosterAId, matchId, fixture.entryAId, rosterBId, fixture.entryBId],
    );
    await client.query(
      `INSERT INTO match_roster_players (roster_id, event_roster_member_id, is_starter, is_veto_representative)
       VALUES ($1, $2, true, true), ($3, $4, true, true)`,
      [rosterAId, fixture.memberAId, rosterBId, fixture.memberBId],
    );
  }

  return matchId;
}

async function expectSuccess<T>(resultPromise: Promise<{ success: boolean; data?: T; error?: unknown }>): Promise<T> {
  const result = await resultPromise;
  if (!result.success) throw new Error(`action failed: ${JSON.stringify(result.error)}`);
  expect(result.success).toBe(true);
  return result.data as T;
}

async function startVetoRoom(
  fixture: Fixture,
  matchId: string,
): Promise<Awaited<ReturnType<typeof readVetoRoomCore>>> {
  await setManualPrivilegedEntry({
    matchId,
    entryId: fixture.entryAId,
    actorId: fixture.adminId,
  });

  let room = await readVetoRoomCore(matchId);
  const firstRequest = await requestVetoStart({
    matchId,
    entryId: fixture.entryAId,
    actorId: fixture.representativeUserAId,
    expectedRevision: room.session.revision,
    expectedTurnKey: room.session.currentTurnKey,
  });
  expect(firstRequest).toBe("applied");
  room = await readVetoRoomCore(matchId);
  const secondRequest = await requestVetoStart({
    matchId,
    entryId: fixture.entryBId,
    actorId: fixture.representativeUserBId,
    expectedRevision: room.session.revision,
    expectedTurnKey: room.session.currentTurnKey,
  });
  expect(secondRequest).toBe("applied");
  return readVetoRoomCore(matchId);
}

async function startWithVetoPlan(
  fixture: Fixture,
  matchId: string,
  format: MatchFormat,
): Promise<void> {
  let room = await startVetoRoom(fixture, matchId);

  const userByEntry = new Map([
    [fixture.entryAId, fixture.representativeUserAId],
    [fixture.entryBId, fixture.representativeUserBId],
  ]);
  for (let commandNumber = 0; commandNumber < 20 && !room.session.completedAt; commandNumber += 1) {
    const turn = room.currentTurn;
    if (!turn?.actorEntryId) throw new Error("Veto Room lost its participant turn before map plan completion");
    const actorId = userByEntry.get(turn.actorEntryId);
    if (!actorId) throw new Error("Veto Room turn owner has no confirmed representative");
    const command = turn.actionType === "role_select"
      ? { kind: "role_select" as const, entryId: fixture.entryAId }
      : turn.actionType === "side_pick"
        ? { kind: "step" as const, actionType: "side_pick" as const, side: "ct" as const }
        : turn.actionType === "ban" || turn.actionType === "pick"
          ? {
              kind: "step" as const,
              actionType: turn.actionType,
              mapName: room.session.mapPoolSnapshot!.find((mapName) =>
                !room.steps.some((step) => step.actionType !== "side_pick" && step.mapName === mapName),
              )!,
            }
          : null;
    if (!command) throw new Error(`Unexpected participant Veto Room turn: ${turn.actionType}`);
    const outcome = await submitVetoCommand({
      matchId,
      actorId,
      expectedRevision: room.session.revision,
      expectedTurnKey: turn.key,
      clientRequestId: randomUUID(),
      command,
    });
    expect(outcome).toBe("applied");
    room = await readVetoRoomCore(matchId);
    if (turn.actionType === "role_select") {
      expect(room.currentTurn?.durationSeconds).toBe(format === "bo1" ? 60 : 45);
    }
  }
  expect(room.session.completedAt).not.toBeNull();
  expect(room.match.status).toBe("in_progress");
}

describe("match score persistence semantics PostgreSQL integration", () => {
  it("uses map facts for BO1/BO3/BO5 results and never creates forfeit maps", async () => {
    const pool = new Pool({ connectionString: localDatabaseUrl(), ssl: false, max: 3 });
    const client = await pool.connect();
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(client);
      requireSeasonAdminMock.mockResolvedValue({ userId: fixture.adminId, email: `score-admin-${fixture.seasonId}@local.test` });

      const bo1MatchId = await createMatch(client, fixture, "bo1", { withLineups: true });
      const bo3MatchId = await createMatch(client, fixture, "bo3", { withLineups: true });
      const bo5MatchId = await createMatch(client, fixture, "bo5", { withLineups: true });
      const forfeitBo1MatchId = await createMatch(client, fixture, "bo1");
      const forfeitBo3MatchId = await createMatch(client, fixture, "bo3");
      const scoredForfeitMatchId = await createMatch(client, fixture, "bo3", { withLineups: true });
      const partialVetoMatchId = await createMatch(client, fixture, "bo3", { withLineups: true });
      const timeoutVetoMatchId = await createMatch(client, fixture, "bo5", { withLineups: true });
      const lockDelayedVetoMatchId = await createMatch(client, fixture, "bo3", { withLineups: true });
      const lockDelayedStartMatchId = await createMatch(client, fixture, "bo3", { withLineups: true });
      const lateVetoMatchId = await createMatch(client, fixture, "bo3", { withLineups: true });

      await startWithVetoPlan(fixture, bo1MatchId, "bo1");
      await startWithVetoPlan(fixture, bo3MatchId, "bo3");
      await startWithVetoPlan(fixture, bo5MatchId, "bo5");
      await startWithVetoPlan(fixture, scoredForfeitMatchId, "bo3");

      await setManualPrivilegedEntry({
        matchId: lockDelayedStartMatchId,
        entryId: fixture.entryAId,
        actorId: fixture.adminId,
      });
      let delayedStartRoom = await readVetoRoomCore(lockDelayedStartMatchId);
      expect(await requestVetoStart({
        matchId: lockDelayedStartMatchId,
        entryId: fixture.entryAId,
        actorId: fixture.representativeUserAId,
        expectedRevision: delayedStartRoom.session.revision,
        expectedTurnKey: delayedStartRoom.session.currentTurnKey,
      })).toBe("applied");
      delayedStartRoom = await readVetoRoomCore(lockDelayedStartMatchId);

      const startLockHolder = await pool.connect();
      let startLockHeld = false;
      let delayedStartRequest: Promise<"applied" | "idempotent" | "stale"> | null = null;
      try {
        await startLockHolder.query("BEGIN");
        await startLockHolder.query("SELECT id FROM matches WHERE id = $1 FOR UPDATE", [lockDelayedStartMatchId]);
        startLockHeld = true;
        delayedStartRequest = requestVetoStart({
          matchId: lockDelayedStartMatchId,
          entryId: fixture.entryBId,
          actorId: fixture.representativeUserBId,
          expectedRevision: delayedStartRoom.session.revision,
          expectedTurnKey: delayedStartRoom.session.currentTurnKey,
        });
        await waitForMatchRowLock(pool);
        await new Promise((resolve) => setTimeout(resolve, 250));
        await startLockHolder.query("COMMIT");
        startLockHeld = false;
        expect(await delayedStartRequest).toBe("applied");
      } finally {
        if (startLockHeld) await startLockHolder.query("ROLLBACK").catch(() => undefined);
        if (delayedStartRequest) await delayedStartRequest.catch(() => undefined);
        startLockHolder.release();
      }

      const delayedStartFacts = await client.query<{
        requested_at: Date;
        started_at: Date;
        turn_started_at: Date;
        turn_deadline_at: Date;
      }>(
        `SELECT entry_b_start_requested_at AS requested_at, started_at, turn_started_at, turn_deadline_at
         FROM match_veto_sessions WHERE match_id = $1`,
        [lockDelayedStartMatchId],
      );
      expect(delayedStartFacts.rows[0]!.started_at.getTime())
        .toBeGreaterThan(delayedStartFacts.rows[0]!.requested_at.getTime());
      expect(delayedStartFacts.rows[0]!.turn_started_at.getTime())
        .toBe(delayedStartFacts.rows[0]!.started_at.getTime());
      expect(delayedStartFacts.rows[0]!.turn_deadline_at.getTime() - delayedStartFacts.rows[0]!.started_at.getTime())
        .toBe(45_000);

      const lockDelayedRoom = await startVetoRoom(fixture, lockDelayedVetoMatchId);
      const lockDelayedTurn = lockDelayedRoom.currentTurn!;
      expect(lockDelayedTurn.actionType).toBe("role_select");
      const lockHolder = await pool.connect();
      let lockHeld = false;
      let delayedCommand: Promise<"applied" | "idempotent" | "stale"> | null = null;
      try {
        await lockHolder.query("BEGIN");
        await lockHolder.query("SELECT id FROM matches WHERE id = $1 FOR UPDATE", [lockDelayedVetoMatchId]);
        const deadlineResult = await lockHolder.query<{ turn_deadline_at: Date }>(
          `UPDATE match_veto_sessions
           SET turn_deadline_at = clock_timestamp() + interval '1000 milliseconds'
           WHERE match_id = $1
           RETURNING turn_deadline_at`,
          [lockDelayedVetoMatchId],
        );
        const deadlineAt = deadlineResult.rows[0]!.turn_deadline_at;
        lockHeld = true;
        delayedCommand = submitVetoCommand({
          matchId: lockDelayedVetoMatchId,
          actorId: fixture.representativeUserAId,
          expectedRevision: lockDelayedRoom.session.revision,
          expectedTurnKey: lockDelayedTurn.key,
          clientRequestId: randomUUID(),
          command: { kind: "role_select", entryId: fixture.entryAId },
        });
        await waitForMatchRowLock(pool);
        const waitMs = Math.max(0, deadlineAt.getTime() + 3_100 - Date.now());
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        await lockHolder.query("COMMIT");
        lockHeld = false;
        expect(await delayedCommand).toBe("applied");
        const afterDelayedCommand = await readVetoRoomCore(lockDelayedVetoMatchId);
        expect(afterDelayedCommand.session.vetoTeamAEntryId).toBe(fixture.entryAId);
        expect(afterDelayedCommand.currentTurn).toMatchObject({ actionType: "ban", durationSeconds: 45 });
      } finally {
        if (lockHeld) await lockHolder.query("ROLLBACK").catch(() => undefined);
        if (delayedCommand) await delayedCommand.catch(() => undefined);
        lockHolder.release();
      }

      const lateRoom = await startVetoRoom(fixture, lateVetoMatchId);
      const lateTurn = lateRoom.currentTurn!;
      await client.query(
        "UPDATE match_veto_sessions SET turn_deadline_at = clock_timestamp() - interval '500 milliseconds' WHERE match_id = $1",
        [lateVetoMatchId],
      );
      expect(await submitVetoCommand({
        matchId: lateVetoMatchId,
        actorId: fixture.representativeUserAId,
        expectedRevision: lateRoom.session.revision,
        expectedTurnKey: lateTurn.key,
        clientRequestId: randomUUID(),
        command: { kind: "role_select", entryId: fixture.entryAId },
      })).toBe("stale");

      const timeoutRoom = await startVetoRoom(fixture, timeoutVetoMatchId);
      await client.query(
        "UPDATE match_veto_sessions SET turn_deadline_at = clock_timestamp() - interval '2100 milliseconds' WHERE match_id = $1",
        [timeoutVetoMatchId],
      );
      const afterRoleTimeout = await readVetoRoomCore(timeoutVetoMatchId);
      expect(afterRoleTimeout.session.vetoTeamAEntryId).toBeTruthy();
      expect(afterRoleTimeout.currentTurn).toMatchObject({ actionType: "ban", durationSeconds: 45 });
      expect(afterRoleTimeout.session.turnDeadlineAt!.getTime() - afterRoleTimeout.session.turnStartedAt!.getTime()).toBe(45_000);
      expect(afterRoleTimeout.session.revision).toBeGreaterThan(timeoutRoom.session.revision);

      let partialRoom = await startVetoRoom(fixture, partialVetoMatchId);
      const roleTurn = partialRoom.currentTurn!;
      expect(roleTurn.actionType).toBe("role_select");
      const roleSelectOutcome = await submitVetoCommand({
        matchId: partialVetoMatchId,
        actorId: fixture.representativeUserAId,
        expectedRevision: partialRoom.session.revision,
        expectedTurnKey: roleTurn.key,
        clientRequestId: randomUUID(),
        command: { kind: "role_select", entryId: fixture.entryAId },
      });
      expect(roleSelectOutcome).toBe("applied");
      partialRoom = await readVetoRoomCore(partialVetoMatchId);
      const firstBanTurn = partialRoom.currentTurn!;
      expect(firstBanTurn).toMatchObject({ actionType: "ban", durationSeconds: 45 });
      const firstBan = await submitVetoCommand({
        matchId: partialVetoMatchId,
        actorId: fixture.representativeUserAId,
        expectedRevision: partialRoom.session.revision,
        expectedTurnKey: firstBanTurn.key,
        clientRequestId: randomUUID(),
        command: { kind: "step", actionType: "ban", mapName: MAP_POOL[0] },
      });
      expect(firstBan).toBe("applied");
      const prematureResult = await recordMapResult(partialVetoMatchId, 1, MAP_POOL[0], 13, 8, null, null);
      expect(prematureResult).toMatchObject({
        success: false,
        error: { message: expect.stringContaining("请先完成 BP") },
      });

      const plannedMapNames = async (matchId: string) => (await client.query<{ map_name: string }>(
        "SELECT map_name FROM match_maps WHERE match_id = $1 ORDER BY map_order",
        [matchId],
      )).rows.map((row) => row.map_name);
      const bo1MapName = (await plannedMapNames(bo1MatchId))[0]!;
      const bo1Result = await expectSuccess(recordMapResult(bo1MatchId, 1, bo1MapName, 13, 8, null, null));
      expect(bo1Result).toEqual({ seriesFinished: true });
      const bo1MapId = (await client.query<{ id: string }>(
        "SELECT id FROM match_maps WHERE match_id = $1 AND map_name = $2",
        [bo1MatchId, bo1MapName],
      )).rows[0]!.id;
      await expectSuccess(correctMapScore(bo1MapId, 13, 10));

      const bo3Scores = [[13, 8], [10, 13], [13, 7]] as const;
      const bo3MapNames = await plannedMapNames(bo3MatchId);
      for (const [index, [scoreA, scoreB]] of bo3Scores.entries()) {
        await expectSuccess(recordMapResult(bo3MatchId, index + 1, bo3MapNames[index]!, scoreA, scoreB, null, null));
      }

      const bo5Scores = [[13, 8], [10, 13], [13, 7], [8, 13], [13, 10]] as const;
      const bo5MapNames = await plannedMapNames(bo5MatchId);
      for (const [index, [scoreA, scoreB]] of bo5Scores.entries()) {
        await expectSuccess(recordMapResult(bo5MatchId, index + 1, bo5MapNames[index]!, scoreA, scoreB, null, null));
      }

      await expectSuccess(recordMapResult(scoredForfeitMatchId, 1, (await plannedMapNames(scoredForfeitMatchId))[0]!, 13, 8, null, null));
      await expectSuccess(forfeitMatch(forfeitBo1MatchId, fixture.entryBId, "BO1 fixture adjudication"));
      await expectSuccess(forfeitMatch(forfeitBo3MatchId, fixture.entryBId, "BO3 fixture adjudication"));
      await expectSuccess(forfeitMatch(scoredForfeitMatchId, fixture.entryBId, "BO3 after one played map"));

      const facts = await client.query<{
        id: string;
        format: MatchFormat;
        status: string;
        score_a: number | null;
        score_b: number | null;
        is_forfeit: boolean;
      }>(
        `SELECT id, format, status, score_a, score_b, is_forfeit
         FROM matches WHERE id IN ($1, $2, $3, $4, $5, $6) ORDER BY id`,
        [bo1MatchId, bo3MatchId, bo5MatchId, forfeitBo1MatchId, forfeitBo3MatchId, scoredForfeitMatchId],
      );
      expect(facts.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: bo1MatchId, format: "bo1", status: "finished", score_a: 1, score_b: 0, is_forfeit: false }),
        expect.objectContaining({ id: bo3MatchId, format: "bo3", status: "finished", score_a: 2, score_b: 1, is_forfeit: false }),
        expect.objectContaining({ id: bo5MatchId, format: "bo5", status: "finished", score_a: 3, score_b: 2, is_forfeit: false }),
        expect.objectContaining({ id: forfeitBo1MatchId, format: "bo1", status: "finished", score_a: 1, score_b: 0, is_forfeit: true }),
        expect.objectContaining({ id: forfeitBo3MatchId, format: "bo3", status: "finished", score_a: 2, score_b: 0, is_forfeit: true }),
        expect.objectContaining({ id: scoredForfeitMatchId, format: "bo3", status: "finished", score_a: 2, score_b: 0, is_forfeit: true }),
      ]));

      const bo1Maps = await client.query<{ map_name: string; score_a: number; score_b: number }>(
        "SELECT map_name, score_a, score_b FROM match_maps WHERE match_id = $1",
        [bo1MatchId],
      );
      expect(bo1Maps.rows).toEqual([{ map_name: bo1MapName, score_a: 13, score_b: 10 }]);

      const bo3Maps = await client.query<{ map_name: string; score_a: number; score_b: number }>(
        "SELECT map_name, score_a, score_b FROM match_maps WHERE match_id = $1 ORDER BY map_order",
        [bo3MatchId],
      );
      expect(bo3Maps.rows).toEqual([
        { map_name: MAP_POOL[2], score_a: 13, score_b: 8 },
        { map_name: MAP_POOL[3], score_a: 10, score_b: 13 },
        { map_name: MAP_POOL[6], score_a: 13, score_b: 7 },
      ]);

      const forfeitMaps = await client.query<{ match_id: string; score_a: number | null; score_b: number | null }>(
        `SELECT match_id, score_a, score_b FROM match_maps
         WHERE match_id IN ($1, $2) ORDER BY match_id, map_order`,
        [forfeitBo1MatchId, forfeitBo3MatchId],
      );
      expect(forfeitMaps.rows).toHaveLength(0);

      const scoredForfeitMaps = await client.query<{ score_a: number; score_b: number }>(
        "SELECT score_a, score_b FROM match_maps WHERE match_id = $1 ORDER BY map_order",
        [scoredForfeitMatchId],
      );
      expect(scoredForfeitMaps.rows).toEqual([{ score_a: 13, score_b: 8 }]);
    } finally {
      client.release();
      if (fixture) {
        const cleanupClient = await pool.connect();
        try {
          await cleanupClient.query("BEGIN");
          await cleanupClient.query("SET LOCAL session_replication_role = replica");
          await cleanupClient.query("DELETE FROM audit_logs WHERE season_id = $1", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM match_roster_players WHERE roster_id IN (SELECT id FROM match_rosters WHERE match_id IN (SELECT id FROM matches WHERE season_id = $1))", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM match_rosters WHERE match_id IN (SELECT id FROM matches WHERE season_id = $1)", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM match_veto_steps WHERE match_id IN (SELECT id FROM matches WHERE season_id = $1)", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM match_maps WHERE match_id IN (SELECT id FROM matches WHERE season_id = $1)", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM matches WHERE season_id = $1", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM event_roster_members WHERE event_roster_id IN (SELECT id FROM event_rosters WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = $1))", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM event_rosters WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = $1)", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM competition_entry_roster_revisions WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = $1)", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM competition_entries WHERE competition_id = $1", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM seasons WHERE id = $1", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM users WHERE id = $1 OR email LIKE $2", [fixture.adminId, `score-%-${fixture.seasonId}@local.test`]);
          await cleanupClient.query("COMMIT");
        } catch {
          await cleanupClient.query("ROLLBACK").catch(() => undefined);
        } finally {
          cleanupClient.release();
        }
      }
      await pool.end();
    }
  });
});
