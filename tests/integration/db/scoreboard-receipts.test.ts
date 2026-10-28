import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import type { DB } from "@/db/client";
const state = vi.hoisted(() => ({ actor: "", allowed: true, loseAcknowledgement: false }));
vi.mock("@/db/client", async importOriginal => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, db: new Proxy(actual.db, { get(target, key, receiver) {
    if (key === "transaction") return async (run: Parameters<DB["transaction"]>[0]) => {
      const result = await target.transaction(run);
      // Real PG COMMIT has completed; simulate only the lost response boundary.
      if (state.loseAcknowledgement) { state.loseAcknowledgement = false; throw new Error("fixture: lost COMMIT acknowledgement"); }
      return result;
    };
    return Reflect.get(target, key, receiver);
  } }) };
});
vi.mock("@/lib/auth/session", async () => {
  const { AppError, ErrorCode } = await import("@/lib/errors");
  return { requireSeasonAdmin: async () => {
    if (!state.allowed) throw new AppError(ErrorCode.FORBIDDEN, "denied");
    return { userId: state.actor };
  }, auditActorId: (session: { userId: string }) => session.userId };
});
vi.mock("next/cache", () => ({ updateTag: vi.fn(), revalidatePath: vi.fn() }));
import { db } from "@/db/client";
import { loadMatchScoreboard } from "@/lib/matches/detail-scoreboard";
import * as schema from "@/db/schema";
import { deletePlayerStatsByMap, getOperatorScoreboardSnapshot, getScoreboardOperationReceipt, savePlayerStats } from "@/actions/player-stats";
import { seedFixture } from "./harness/mizar";

it("atomically commits one receipt, detects stale versions, recovers lost ACK and rolls back a reused ID", async () => {
  const f = await seedFixture({ unboundSource: true });
  const entry = await db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, f.entryAId) });
  state.actor = entry!.representativeUserId;
  const snapshot = async (mapId = f.mapOneId) => {
    const result = await getOperatorScoreboardSnapshot(mapId);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("fixture snapshot unavailable");
    return result.data;
  };
  await db.insert(schema.matchPlayerStats).values({ mapId: f.mapOneId, matchId: f.matchId, perfectName: "Synthetic OCR", ratingPro: 1.4 });
  const before = await snapshot();
  const command = { operationId: randomUUID(), expectedActor: state.actor, expectedVersion: before.version };
  const outcomes = await Promise.all([deletePlayerStatsByMap(f.mapOneId, command), deletePlayerStatsByMap(f.mapOneId, command)]);
  expect(outcomes.every(outcome => outcome.success)).toBe(true);
  expect(outcomes.filter(outcome => outcome.success && outcome.data.replayed)).toHaveLength(1);
  const receipts = () => db.execute(sql`select * from public.operator_scoreboard_receipts where actor_user_id=${state.actor}::uuid`);
  expect((await receipts()).rows).toHaveLength(1);
  expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.targetId, f.mapOneId))).toHaveLength(1);
  expect((await snapshot()).rows).toEqual([]);
  const stale = await deletePlayerStatsByMap(f.mapOneId, { ...command, operationId: randomUUID() });
  expect(stale).toMatchObject({ success: false, error: { meta: { outcome: "conflict" } } });
  expect((await receipts()).rows).toHaveLength(1);

  // Distinct commands against the same nonempty version cannot both replace it.
  await db.insert(schema.matchPlayerStats).values({ mapId: f.mapOneId, matchId: f.matchId, perfectName: "Synthetic current", ratingPro: 2 });
  const concurrentBase = await snapshot();
  const concurrent = await Promise.all([0, 1].map(() => deletePlayerStatsByMap(f.mapOneId, { operationId: randomUUID(), expectedActor: state.actor, expectedVersion: concurrentBase.version })));
  expect(concurrent.filter(outcome => outcome.success)).toHaveLength(1);
  expect(concurrent.filter(outcome => !outcome.success && outcome.error.meta?.outcome === "conflict")).toHaveLength(1);

  // A reused actor/operation ID on another map rolls back its deletion and audit.
  await db.insert(schema.matchPlayerStats).values({ mapId: f.mapTwoId, matchId: f.matchId, perfectName: "Retained on conflict", ratingPro: 3 });
  const secondBefore = await snapshot(f.mapTwoId);
  expect(await deletePlayerStatsByMap(f.mapTwoId, { ...command, expectedVersion: secondBefore.version })).toMatchObject({ success: false });
  expect(await snapshot(f.mapTwoId)).toEqual(secondBefore);
  expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.targetId, f.mapTwoId))).toHaveLength(0);

  // A real PG receipt INSERT failure must roll back preceding facts and audit.
  const faultName = `ocr_receipt_${randomUUID().replaceAll("-", "")}`;
  await db.execute(sql.raw(`CREATE FUNCTION ${faultName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture receipt unavailable'; END $$`));
  await db.execute(sql.raw(`CREATE TRIGGER ${faultName} BEFORE INSERT ON public.operator_scoreboard_receipts FOR EACH ROW WHEN (NEW.map_id = '${f.mapTwoId}'::uuid) EXECUTE FUNCTION ${faultName}()`));
  try {
    expect(await deletePlayerStatsByMap(f.mapTwoId, { operationId: randomUUID(), expectedActor: state.actor, expectedVersion: secondBefore.version })).toMatchObject({ success: false });
    expect(await snapshot(f.mapTwoId)).toEqual(secondBefore);
    expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.targetId, f.mapTwoId))).toHaveLength(0);
  } finally {
    await db.execute(sql.raw(`DROP TRIGGER ${faultName} ON public.operator_scoreboard_receipts`));
    await db.execute(sql.raw(`DROP FUNCTION ${faultName}()`));
  }

  await db.update(schema.matchMaps).set({ scoreA: 13, scoreB: 8, completedAt: new Date() }).where(eq(schema.matchMaps.id, f.mapOneId));
  const saveCommand = { operationId: randomUUID(), expectedActor: state.actor, expectedVersion: (await snapshot()).version, rows: [] };
  state.loseAcknowledgement = true;
  expect(await savePlayerStats(f.mapOneId, saveCommand)).toMatchObject({ success: false, error: { code: "INTERNAL_ERROR" } });
  const locator = { operationId: saveCommand.operationId, expectedActor: saveCommand.expectedActor, expectedVersion: saveCommand.expectedVersion, operation: "save" as const };
  const recovered = await getScoreboardOperationReceipt(f.mapOneId, locator);
  expect(recovered).toMatchObject({ success: true, data: { status: "committed", superseded: false, receipt: { operationId: saveCommand.operationId } } });
  expect(await savePlayerStats(f.mapOneId, saveCommand)).toMatchObject({ success: true, data: { replayed: true } });
  const unconfirmed = await getScoreboardOperationReceipt(f.mapOneId, { ...saveCommand, operationId: randomUUID(), operation: "save" });
  expect(unconfirmed).toEqual({ success: true, data: { status: "unconfirmed" } });
  await db.insert(schema.matchPlayerStats).values({ mapId: f.mapOneId, matchId: f.matchId, perfectName: "Later unrelated change", ratingPro: 5 });
  expect(await getScoreboardOperationReceipt(f.mapOneId, { ...saveCommand, operation: "save" })).toMatchObject({ success: true, data: { superseded: true } });
  const originalActor = state.actor;
  const otherEntry = await db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, f.entryBId) });
  state.actor = otherEntry!.representativeUserId;
  expect(await getScoreboardOperationReceipt(f.mapOneId, locator)).toMatchObject({ success: false, error: { code: "FORBIDDEN" } });
  state.actor = originalActor;
  const countBeforeDenial = (await receipts()).rows.length;
  state.allowed = false;
  expect(await getScoreboardOperationReceipt(f.mapOneId, { ...saveCommand, operation: "save" })).toMatchObject({ success: false, error: { code: "FORBIDDEN" } });
  expect(await deletePlayerStatsByMap(f.mapOneId, { operationId: randomUUID(), expectedActor: state.actor, expectedVersion: secondBefore.version })).toMatchObject({ success: false });
  state.allowed = true;
  expect((await receipts()).rows).toHaveLength(countBeforeDenial);
});

it("writes nonempty stats once, binds the fresh actor, then detects save CAS and supersession without replay writes", async () => {
  state.allowed = true;
  state.loseAcknowledgement = false;
  const f = await seedFixture({ unboundSource: true, freezeEventRoster: true });
  const entryA = await db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, f.entryAId) });
  const entryB = await db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, f.entryBId) });
  const actorA = entryA!.representativeUserId;
  state.actor = actorA;
  await db.update(schema.matchMaps).set({ scoreA: 13, scoreB: 8, completedAt: new Date(), provisionalPlayers: [{ userId: actorA, name: "provisional", kills: 4, deaths: null, assists: 0 }] }).where(eq(schema.matchMaps.id, f.mapOneId));
  const [match] = await db.select().from(schema.matches).where(eq(schema.matches.id, f.matchId));
  const maps = await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, f.matchId));
  const teams = new Map([[actorA, f.entryAId]]);
  const before = await loadMatchScoreboard(match!, maps, teams);
  expect(before.mapPlayers.get(f.mapOneId)).toMatchObject([{ userId: actorA, kills: 4, deaths: null, assists: 0 }]);
  expect(before.provisionalMapIds.has(f.mapOneId)).toBe(true);
  const initial = await getOperatorScoreboardSnapshot(f.mapOneId);
  if (!initial.success) throw new Error("fixture snapshot unavailable");
  const row = { userId: actorA, perfectName: "Synthetic confirmed player", kills: 15, deaths: 10, assists: 4, hsPercent: 40,
    firstKills: 1, multiKills: 1, clutches: 0, adr: 80, rws: 10, ratingPro: 1.2, we: 8 };
  const command = { operationId: randomUUID(), expectedActor: actorA, expectedVersion: initial.data.version, rows: [row] };
  const facts = () => db.select().from(schema.matchPlayerStats).where(eq(schema.matchPlayerStats.mapId, f.mapOneId));
  const audit = () => db.select().from(schema.auditLogs).where(eq(schema.auditLogs.targetId, f.mapOneId));
  const receipts = () => db.execute(sql`select * from public.operator_scoreboard_receipts where map_id=${f.mapOneId}::uuid`);
  // Another tab changed the authenticated actor after the editor snapshot.
  state.actor = entryB!.representativeUserId;
  expect(await savePlayerStats(f.mapOneId, command)).toMatchObject({ success: false, error: { code: "FORBIDDEN" } });
  expect(await facts()).toEqual([]);
  expect(await audit()).toEqual([]);
  expect((await receipts()).rows).toEqual([]);
  state.actor = actorA;
  const sameOperation = await Promise.all([savePlayerStats(f.mapOneId, command), savePlayerStats(f.mapOneId, command)]);
  expect(sameOperation.every(result => result.success)).toBe(true);
  expect(sameOperation.filter(result => result.success && result.data.replayed)).toHaveLength(1);
  const firstFacts = await facts();
  expect(firstFacts).toHaveLength(1);
  expect(firstFacts[0]).toMatchObject({ userId: actorA, ratingPro: 1.2, kills: 15, verifiedByAdmin: actorA });
  const confirmed = await loadMatchScoreboard(match!, maps, teams);
  expect(confirmed.provisionalMapIds.has(f.mapOneId)).toBe(false);
  expect(confirmed.mapPlayers.get(f.mapOneId)).toMatchObject([{ userId: actorA, kills: 15, ratingPro: 1.2 }]);
  expect(await audit()).toHaveLength(1);
  expect((await receipts()).rows).toHaveLength(1);
  const firstSnapshot = await getOperatorScoreboardSnapshot(f.mapOneId);
  if (!firstSnapshot.success) throw new Error("fixture committed snapshot unavailable");
  const next = [1.4, 1.6].map(ratingPro => ({ operationId: randomUUID(), expectedActor: actorA, expectedVersion: firstSnapshot.data.version, rows: [{ ...row, ratingPro }] }));
  const competing = await Promise.all(next.map(input => savePlayerStats(f.mapOneId, input)));
  expect(competing.filter(result => result.success)).toHaveLength(1);
  expect(competing.filter(result => !result.success && result.error.meta?.outcome === "conflict")).toHaveLength(1);
  const winningRating = next[competing.findIndex(result => result.success)]!.rows[0]!.ratingPro;
  const latestFacts = await facts();
  expect(latestFacts).toHaveLength(1);
  expect(latestFacts[0]).toMatchObject({ id: firstFacts[0]!.id, ratingPro: winningRating, kills: 15 });
  expect(await audit()).toHaveLength(2);
  expect((await receipts()).rows).toHaveLength(2);
  const locator = { operationId: command.operationId, expectedActor: actorA, expectedVersion: command.expectedVersion, operation: "save" as const };
  expect(await getScoreboardOperationReceipt(f.mapOneId, locator)).toMatchObject({ success: true, data: { status: "committed", superseded: true, snapshot: { rows: [expect.objectContaining({ ratingPro: winningRating })] } } });
  expect(await savePlayerStats(f.mapOneId, command)).toMatchObject({ success: true, data: { replayed: true } });
  expect(await facts()).toEqual(latestFacts);
  expect(await audit()).toHaveLength(2);
  expect((await receipts()).rows).toHaveLength(2);
});


it("keeps confirmed DAK gameplay above provisional data when OCR later enriches the same player", async () => {
  state.allowed = true;
  const f = await seedFixture({ unboundSource: true, freezeEventRoster: true });
  const actor = f.fixtureUserIds[0]!;
  state.actor = actor;
  await db.update(schema.matchMaps).set({ scoreA: 13, scoreB: 8, completedAt: new Date(), provisionalPlayers: [{ userId: actor, name: "provisional", kills: 5, deaths: null, assists: 0 }] }).where(eq(schema.matchMaps.id, f.mapOneId));
  const intent = randomUUID(), pairing = randomUUID(), importId = randomUUID();
  await db.insert(schema.dakPairingIntents).values({ id: intent, pollTokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60000) });
  await db.insert(schema.dakPairings).values({ id: pairing, pairingIntentId: intent, userId: actor, tokenHash: randomUUID(), scopes: [], seasonIds: [f.seasonId] });
  await db.insert(schema.matchDemoImports).values({ id: importId, seasonId: f.seasonId, matchId: f.matchId, matchMapId: f.mapOneId, stageKey: "fixture-stage", demoSha256: "a".repeat(64), payloadSha256: "b".repeat(64), contractVersion: "rivalhub-demo-evidence/1", semanticProfile: "fixture", analysisVersion: "fixture", evidenceRevision: "fixture", status: "confirmed", payload: {}, submittedByPairingId: pairing, confirmedAt: new Date() });
  await db.insert(schema.matchPlayerStats).values({ matchId: f.matchId, mapId: f.mapOneId, userId: actor, perfectName: "confirmed DAK", kills: 20, deaths: 10, assists: 4, adr: 88, dakImportId: importId, verifiedByAdmin: "dak", verifiedAt: new Date() });
  const snapshot = await getOperatorScoreboardSnapshot(f.mapOneId);
  if (!snapshot.success) throw new Error("fixture snapshot unavailable");
  const row = { userId: actor, perfectName: "confirmed DAK", kills: 1, deaths: 1, assists: 1, hsPercent: null, firstKills: null, multiKills: null, clutches: null, adr: 1, rws: 8, ratingPro: 1.2, we: 7 };
  const result = await savePlayerStats(f.mapOneId, { operationId: randomUUID(), expectedActor: actor, expectedVersion: snapshot.data.version, rows: [row] });
  expect(result.success).toBe(true);
  const [match] = await db.select().from(schema.matches).where(eq(schema.matches.id, f.matchId));
  const maps = await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, f.matchId));
  const scoreboard = await loadMatchScoreboard(match!, maps, new Map([[actor, f.entryAId]]));
  expect(scoreboard.provisionalMapIds.has(f.mapOneId)).toBe(false);
  expect(scoreboard.mapPlayers.get(f.mapOneId)).toMatchObject([{ userId: actor, kills: 20, deaths: 10, assists: 4, adr: 88, rws: 8, ratingPro: 1.2, we: 7 }]);
  const [stored] = await db.select().from(schema.matchPlayerStats).where(eq(schema.matchPlayerStats.mapId, f.mapOneId));
  expect(stored).toMatchObject({ dakImportId: importId, verifiedByAdmin: "dak", kills: 20 });
});
