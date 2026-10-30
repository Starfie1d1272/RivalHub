import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { testSteam64 } from "./database";

export const NOW = new Date("2026-09-28T00:00:00.000Z");

export interface Fixture {
  seasonId: string;
  entryAId: string;
  entryBId: string;
  matchId: string;
  mapOneId: string;
  mapTwoId: string;
  installationId: string;
  installationBId: string;
  credentialHash: string;
  credentialBHash: string;
  sessionId: string;
  producerInstanceId: string;
  liveSessionId: string;
  contextRevision: string;
  authorityRevision: number;
  steam64: string[];
}

/** Bare schedule rows only: prevent large read fixtures from becoming cron work
 * in later specs sharing this worker DB. The base fixture has its own lifetime. */
export async function withExtraMizarScheduleMatches<T>(
  fixture: Fixture,
  work: (add: (count: number, scheduledAt: Date | null) => Promise<string[]>) => Promise<T>,
): Promise<T> {
  const ids: string[] = [];
  try {
    return await work(async (count, scheduledAt) => {
      const addedIds = Array.from({ length: count }, () => randomUUID());
      // Register before the fallible INSERT, including any earlier batch.
      ids.push(...addedIds);
      if (addedIds.length) await db.insert(schema.matches).values(addedIds.map(id => ({
        id, seasonId: fixture.seasonId, entryAId: fixture.entryAId, entryBId: fixture.entryBId,
        stage: "fixture-stage", format: "bo3" as const, status: "scheduled" as const, scheduledAt,
      })));
      return addedIds;
    });
  } finally {
    if (ids.length) await db.delete(schema.matches).where(and(eq(schema.matches.seasonId, fixture.seasonId), inArray(schema.matches.id, ids)));
  }
}

export async function seedFixture(options: { isTest?: boolean; matchStatus?: "scheduled" | "in_progress"; freezeEventRoster?: boolean; unboundSource?: boolean; seasonSlug?: string } = {}): Promise<Fixture & { fixtureUserIds: string[] }> {
  const seasonId = randomUUID();
  const entryAId = randomUUID();
  const entryBId = randomUUID();
  const matchId = randomUUID();
  const mapOneId = randomUUID();
  const mapTwoId = randomUUID();
  const revisionA = randomUUID();
  const revisionB = randomUUID();
  const eventRosterA = randomUUID();
  const eventRosterB = randomUUID();
  const rosterA = randomUUID();
  const rosterB = randomUUID();
  const pairingIntentA = randomUUID();
  const pairingIntentB = randomUUID();
  const installationId = randomUUID();
  const installationBId = randomUUID();
  const credentialHash = randomUUID();
  const credentialBHash = randomUUID();
  const userIds = Array.from({ length: 10 }, () => randomUUID());
  const participantIds = Array.from({ length: 10 }, () => randomUUID());
  const eventMemberIds = Array.from({ length: 10 }, () => randomUUID());
  const steam64 = userIds.map((id) => testSteam64(id));
  const producerInstanceId = "producer-fixture";
  const liveSessionId = "live-fixture";
  const contextRevision = "context-fixture";
  const authorityRevision = 1;
  let session: { id: string }[] | undefined;

  await db.transaction(async (tx) => {
    await tx.insert(schema.users).values(userIds.map((id, index) => ({ id, email: `${id}@local.test`, steam64: steam64[index]! })));
    await tx.insert(schema.seasons).values({ id: seasonId, slug: options.seasonSlug ?? seasonId, name: "Mizar live boundary", kind: "custom", status: "playing" });
    await tx.insert(schema.competitionEntries).values([
      { id: entryAId, competitionId: seasonId, source: "event_native", name: "Provider A", representativeUserId: userIds[0]!, registrationStatus: "approved", currentRosterRevisionId: revisionA, approvedRosterRevisionId: revisionA, reviewReason: "private-review-marker", perfectTeamId: "private-perfect-marker" },
      { id: entryBId, competitionId: seasonId, source: "event_native", name: "Provider B", representativeUserId: userIds[5]!, registrationStatus: "approved", currentRosterRevisionId: revisionB, approvedRosterRevisionId: revisionB },
    ]);
    await tx.insert(schema.competitionEntryRepresentativeChanges).values([
      { entryId: entryAId, fromUserId: null, toUserId: userIds[0]!, changedByActorId: "integration-test" },
      { entryId: entryBId, fromUserId: null, toUserId: userIds[5]!, changedByActorId: "integration-test" },
    ]);
    await tx.insert(schema.competitionEntryRosterRevisions).values([
      { id: revisionA, entryId: entryAId, revisionNumber: 1, status: "approved", createdBy: userIds[0]!, approvedAt: NOW },
      { id: revisionB, entryId: entryBId, revisionNumber: 1, status: "approved", createdBy: userIds[5]!, approvedAt: NOW },
    ]);
    await tx.insert(schema.competitionEntryParticipants).values(userIds.map((userId, index) => ({
      id: participantIds[index]!,
      entryId: index < 5 ? entryAId : entryBId,
      userId,
      status: "confirmed" as const,
      invitedByUserId: index < 5 ? userIds[0]! : userIds[5]!,
      confirmedAt: NOW,
    })));
    await tx.insert(schema.competitionEntryRosterMembers).values(userIds.map((userId, index) => ({
      id: randomUUID(),
      revisionId: index < 5 ? revisionA : revisionB,
      participantId: participantIds[index]!,
      userId,
      isPrimaryStarter: true,
    })));
    // Members must be written before the roster is frozen; the active chain has a
    // trigger that makes frozen event-roster members immutable.
    await tx.insert(schema.eventRosters).values([
      { id: eventRosterA, entryId: entryAId, sourceRosterRevisionId: revisionA, status: "confirmed", confirmedAt: NOW, confirmedBy: userIds[0]! },
      { id: eventRosterB, entryId: entryBId, sourceRosterRevisionId: revisionB, status: "confirmed", confirmedAt: NOW, confirmedBy: userIds[5]! },
    ]);
    await tx.insert(schema.eventRosterMembers).values(userIds.map((userId, index) => ({
      id: eventMemberIds[index]!,
      eventRosterId: index < 5 ? eventRosterA : eventRosterB,
      userId,
      participantId: participantIds[index]!,
      isPrimaryStarter: true,
    })));    if (options.freezeEventRoster) {
      await tx.update(schema.eventRosters).set({ status: "frozen", frozenAt: NOW, frozenBy: userIds[0]! }).where(inArray(schema.eventRosters.id, [eventRosterA, eventRosterB]));
    }
    await tx.insert(schema.matches).values({
      id: matchId,
      seasonId,
      entryAId,
      entryBId,
      stage: options.isTest ? "test" : "fixture-stage",
      ...(options.isTest ? { testConfig: { mapPool: ["de_ancient", "de_mirage", "de_nuke", "de_dust2", "de_inferno", "de_anubis", "de_train"], operatorAId: userIds[0]!, operatorBId: userIds[5]! } } : {}),
      format: "bo3",
      status: options.matchStatus ?? "in_progress",
      scheduledAt: new Date("2026-09-28T01:00:00.000Z"),
    });
    await tx.insert(schema.matchMaps).values([
      { id: mapOneId, matchId, mapOrder: 1, mapName: "de_ancient" },
      { id: mapTwoId, matchId, mapOrder: 2, mapName: "de_mirage" },
    ]);
    await tx.insert(schema.matchVetoSessions).values({ matchId, startedAt: NOW, completedAt: NOW });
    await tx.insert(schema.matchRosters).values([
      { id: rosterA, matchId, entryId: entryAId, source: "admin_select", status: "submitted" },
      { id: rosterB, matchId, entryId: entryBId, source: "admin_select", status: "submitted" },
    ]);
    await tx.insert(schema.matchRosterPlayers).values(userIds.map((_, index) => ({
      rosterId: index < 5 ? rosterA : rosterB,
      eventRosterMemberId: eventMemberIds[index]!,
      isStarter: true,
    })));
    await tx.insert(schema.mizarPairingIntents).values([
      { id: pairingIntentA, pollTokenHash: randomUUID(), status: "authorized", competitionId: seasonId, authorizedByUserId: userIds[0]!, authorizedAt: NOW, expiresAt: new Date(NOW.getTime() + 600_000) },
      { id: pairingIntentB, pollTokenHash: randomUUID(), status: "authorized", competitionId: seasonId, authorizedByUserId: userIds[5]!, authorizedAt: NOW, expiresAt: new Date(NOW.getTime() + 600_000) },
    ]);
    await tx.insert(schema.mizarInstallations).values([
      { id: installationId, competitionId: seasonId, pairingIntentId: pairingIntentA, authorizedByUserId: userIds[0]!, credentialHash },
      { id: installationBId, competitionId: seasonId, pairingIntentId: pairingIntentB, authorizedByUserId: userIds[5]!, credentialHash: credentialBHash },
    ]);
    session = await tx.insert(schema.matchLiveSessions).values({
      matchId,
      installationId,
      producerInstanceId,
      liveSessionId,
      contextRevision,
      authorityRevision,
      programSourceGeneration: 0,
      mapEpoch: 1,
      identityHealth: "healthy",
      lineupHealth: "healthy",
      continuityHealth: "healthy",
      autoCanonicalizationArmed: !options.unboundSource,
      currentMapId: options.unboundSource ? null : mapOneId,
      mapExecutionPhase: options.unboundSource ? "waiting" : "gameplay",
    }).returning({ id: schema.matchLiveSessions.id });
  });
  return { fixtureUserIds: userIds, seasonId, entryAId, entryBId, matchId, mapOneId, mapTwoId, installationId, installationBId, credentialHash, credentialBHash, sessionId: session![0]!.id, producerInstanceId, liveSessionId, contextRevision, authorityRevision, steam64 };
}

/** Synthetic official history for the current fixture's two entrants. */
export async function seedMizarStatsHistory(f: Fixture & { fixtureUserIds: string[] }) {
  const matchId = randomUUID();
  const mapIds = [randomUUID(), randomUUID()];
  const rosterIds = [randomUUID(), randomUUID()];
  await db.transaction(async tx => {
    const members = await tx.select({ userId: schema.eventRosterMembers.userId, memberId: schema.eventRosterMembers.id, entryId: schema.eventRosters.entryId })
      .from(schema.eventRosterMembers).innerJoin(schema.eventRosters, eq(schema.eventRosters.id, schema.eventRosterMembers.eventRosterId))
      .where(inArray(schema.eventRosters.entryId, [f.entryAId, f.entryBId]));
    if (members.length !== 10 || f.fixtureUserIds.some(id => !members.some(member => member.userId === id))) throw new Error("Mizar stats fixture roster mismatch");
    await tx.insert(schema.matches).values({ id: matchId, seasonId: f.seasonId, entryAId: f.entryAId, entryBId: f.entryBId, stage: "mizar-stats-fixture", format: "bo3", status: "finished", scoreA: 2, scoreB: 0, completedAt: NOW });
    await tx.insert(schema.matchMaps).values([
      { id: mapIds[0]!, matchId, mapOrder: 1, mapName: "de_ancient", scoreA: 13, scoreB: 7, completedAt: NOW },
      { id: mapIds[1]!, matchId, mapOrder: 2, mapName: "de_mirage", scoreA: 13, scoreB: 7, completedAt: NOW },
    ]);
    await tx.insert(schema.matchRosters).values([f.entryAId, f.entryBId].map((entryId, index) => ({ id: rosterIds[index]!, matchId, entryId, source: "admin_select" as const, status: "confirmed" as const, confirmedAt: NOW, confirmedBy: "fixture" })));
    await tx.insert(schema.matchRosterPlayers).values(members.map(member => ({ rosterId: rosterIds[member.entryId === f.entryAId ? 0 : 1]!, eventRosterMemberId: member.memberId, isStarter: true })));
    const stats = f.fixtureUserIds.flatMap((userId, index) => mapIds.slice(0, index === 0 ? 2 : 1).map((mapId, mapIndex) => ({
      matchId, mapId, userId, perfectName: `Fixture player ${index + 1}`, verifiedByAdmin: "fixture", verifiedAt: NOW,
      kills: 10 + index, deaths: 8, ratingPro: index === 0 ? 1.5 : index === 1 ? 1.25 : 1,
      adr: index === 0 ? null : mapIndex === 0 ? 80 : 60,
    })));
    await tx.insert(schema.matchPlayerStats).values(stats);
  });
  return { matchId, mapIds };
}
