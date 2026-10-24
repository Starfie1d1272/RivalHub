import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { readVetoRoomSnapshot, reconcileVetoRoom, reconcileVetoRoomReceipt, submitVetoCommandReceipt, requestVetoStartReceipt } from "@/lib/matches/veto-room/service";
import { seedFixture } from "./harness/mizar";

// Real transactions protect the outcome used to decide cache invalidation.
// Action mocks cannot detect lineup-only writes or duplicate timeout settlement.
describe("Veto reconciliation committed changes", () => {
  it.each([false, true])("reports default lineup creation with session=%s, then leaves retries unchanged", async hasSession => {
    const f = await seedFixture({ freezeEventRoster: true });
    const matchId = randomUUID();
    await db.insert(schema.matches).values({
      id: matchId, seasonId: f.seasonId, entryAId: f.entryAId, entryBId: f.entryBId,
      stage: "fixture-stage", format: "bo3", status: "scheduled",
      scheduledAt: new Date(Date.now() + 60 * 60_000),
    });
    if (hasSession) await db.insert(schema.matchVetoSessions).values({ matchId });
    const session = await db.query.matchVetoSessions.findFirst({ where: eq(schema.matchVetoSessions.matchId, matchId) });

    expect(await reconcileVetoRoom(matchId)).toBe("applied");
    const rosters = await db.select().from(schema.matchRosters).where(eq(schema.matchRosters.matchId, matchId));
    expect(rosters).toHaveLength(2);
    expect(rosters.every(row => row.source === "system_default")).toBe(true);
    for (const roster of rosters) {
      expect(await db.select().from(schema.matchRosterPlayers).where(eq(schema.matchRosterPlayers.rosterId, roster.id))).toHaveLength(5);
      expect(await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, roster.id), eq(schema.auditLogs.action, "match.roster.system_default")))).toHaveLength(1);
    }
    expect(await reconcileVetoRoom(matchId)).toBe("idempotent");
    expect(await db.select().from(schema.matchRosters).where(eq(schema.matchRosters.matchId, matchId))).toEqual(rosters);
    expect(await db.query.matchVetoSessions.findFirst({ where: eq(schema.matchVetoSessions.matchId, matchId) })).toEqual(session);
  });

  it("settles a due timeout once under competing boundary calls and returns the current room on retry", async () => {
    const f = await seedFixture();
    await db.update(schema.matchVetoSessions).set({
      completedAt: null, privilegedEntryId: f.entryAId, vetoTeamAEntryId: f.entryAId,
      mapPoolSnapshot: ["de_ancient", "de_mirage", "de_nuke", "de_dust2", "de_inferno", "de_anubis", "de_train"],
      currentTurnKey: "ban-veto-a-opening", turnStartedAt: sql`clock_timestamp() - interval '50 seconds'`,
      turnDeadlineAt: sql`clock_timestamp() - interval '5 seconds'`,
    }).where(eq(schema.matchVetoSessions.matchId, f.matchId));
    const before = await readVetoRoomSnapshot(f.matchId);
    const maps = await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, f.matchId));

    expect((await Promise.all([reconcileVetoRoom(f.matchId), reconcileVetoRoom(f.matchId)])).sort()).toEqual(["applied", "idempotent"]);
    const room = await readVetoRoomSnapshot(f.matchId);
    expect(room.session.revision).toBeGreaterThan(before.session.revision);
    expect(room.currentTurn?.key).toBe("ban-veto-b-opening");
    expect(room.incidents).toHaveLength(1);
    expect(room.steps).toHaveLength(1);
    expect(room.steps[0]).toMatchObject({ source: "timeout", turnKey: "ban-veto-a-opening" });
    expect(await reconcileVetoRoom(f.matchId)).toBe("idempotent");
    const retry = await readVetoRoomSnapshot(f.matchId);
    expect(retry.session).toEqual(room.session);
    expect(retry.steps).toEqual(room.steps);
    expect(retry.incidents).toEqual(room.incidents);
    expect(await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, f.matchId))).toEqual(maps);
    expect(await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, f.matchId), eq(schema.auditLogs.action, "match.veto.timeout")))).toHaveLength(1);
  });
});


it("reports a timeout commit even when the submitted command is stale, then returns a no-change replay", async () => {
  const f = await seedFixture({ isTest: true });
  const match = (await db.query.matches.findFirst({ where: eq(schema.matches.id, f.matchId) }))!;
  await db.update(schema.matchVetoSessions).set({ completedAt: null, privilegedEntryId: f.entryAId, vetoTeamAEntryId: f.entryAId,
    mapPoolSnapshot: match.testConfig!.mapPool, currentTurnKey: "ban-veto-a-opening",
    turnStartedAt: sql`clock_timestamp() - interval '50 seconds'`, turnDeadlineAt: sql`clock_timestamp() - interval '5 seconds'`,
  }).where(eq(schema.matchVetoSessions.matchId, f.matchId));
  const before = await readVetoRoomSnapshot(f.matchId);
  const input = { matchId: f.matchId, actorId: match.testConfig!.operatorAId, expectedRevision: before.session.revision,
    expectedTurnKey: "ban-veto-a-opening", clientRequestId: randomUUID(), command: { kind: "step" as const, actionType: "ban" as const, mapName: "de_nuke" } };
  const receipt = await submitVetoCommandReceipt(input);
  expect(receipt).toMatchObject({ outcome: "stale", changed: true, affectedFacts: ["veto"] });
  expect(receipt.committedRevision).toBeGreaterThan(before.session.revision);
  expect(await submitVetoCommandReceipt(input)).toMatchObject({ outcome: "stale", changed: false, committedRevision: receipt.committedRevision, affectedFacts: [] });
  expect(await db.select().from(schema.matchVetoTimeoutIncidents).where(eq(schema.matchVetoTimeoutIncidents.matchId, f.matchId))).toHaveLength(1);
});

it("reports an actual start commit when an already-ready request returns idempotent", async () => {
  const f = await seedFixture({ isTest: true, matchStatus: "scheduled" });
  const match = (await db.query.matches.findFirst({ where: eq(schema.matches.id, f.matchId) }))!;
  await db.update(schema.matches).set({ scheduledAt: null }).where(eq(schema.matches.id, f.matchId));
  await db.update(schema.matchVetoSessions).set({ startedAt: null, completedAt: null, privilegedEntryId: f.entryAId,
    entryAStartRequestedBy: match.testConfig!.operatorAId, entryBStartRequestedBy: match.testConfig!.operatorBId,
    entryAStartRequestedAt: new Date(), entryBStartRequestedAt: new Date(),
  }).where(eq(schema.matchVetoSessions.matchId, f.matchId));
  const input = { matchId: f.matchId, entryId: f.entryAId, actorId: match.testConfig!.operatorAId, expectedRevision: 0, expectedTurnKey: null };
  const receipt = await requestVetoStartReceipt(input);
  expect(receipt).toMatchObject({ outcome: "idempotent", changed: true, affectedFacts: ["veto"] });
  expect(await requestVetoStartReceipt(input)).toMatchObject({ outcome: "idempotent", changed: false, affectedFacts: [] });
  expect(await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, f.matchId), eq(schema.auditLogs.action, "match.veto.start")))).toHaveLength(1);
});


it("reports map_plan independently when timeout catch-up completes and replaces the map catalog", async () => {
  const f = await seedFixture({ isTest: true });
  const match = (await db.query.matches.findFirst({ where: eq(schema.matches.id, f.matchId) }))!;
  await db.update(schema.matches).set({ format: "bo1" }).where(eq(schema.matches.id, f.matchId));
  await db.update(schema.matchVetoSessions).set({ completedAt: null, privilegedEntryId: f.entryAId, vetoTeamAEntryId: null,
    mapPoolSnapshot: match.testConfig!.mapPool, currentTurnKey: "choose-veto-team-a",
    turnStartedAt: sql`clock_timestamp() - interval '1 day'`, turnDeadlineAt: sql`clock_timestamp() - interval '1 day' + interval '45 seconds'`,
  }).where(eq(schema.matchVetoSessions.matchId, f.matchId));
  const receipt = await reconcileVetoRoomReceipt(f.matchId);
  expect(receipt).toMatchObject({ changed: true, outcome: "applied" });
  expect(receipt.affectedFacts).toEqual(expect.arrayContaining(["veto", "map_plan"]));
  expect((await readVetoRoomSnapshot(f.matchId)).session.completedAt).not.toBeNull();
  expect(await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, f.matchId))).toHaveLength(1);
});
