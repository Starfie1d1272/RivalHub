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
  const command = { operationId: randomUUID(), expectedVersion: before.version };
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
  const concurrent = await Promise.all([0, 1].map(() => deletePlayerStatsByMap(f.mapOneId, { operationId: randomUUID(), expectedVersion: concurrentBase.version })));
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
    expect(await deletePlayerStatsByMap(f.mapTwoId, { operationId: randomUUID(), expectedVersion: secondBefore.version })).toMatchObject({ success: false });
    expect(await snapshot(f.mapTwoId)).toEqual(secondBefore);
    expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.targetId, f.mapTwoId))).toHaveLength(0);
  } finally {
    await db.execute(sql.raw(`DROP TRIGGER ${faultName} ON public.operator_scoreboard_receipts`));
    await db.execute(sql.raw(`DROP FUNCTION ${faultName}()`));
  }

  await db.update(schema.matchMaps).set({ scoreA: 13, scoreB: 8, completedAt: new Date() }).where(eq(schema.matchMaps.id, f.mapOneId));
  const saveCommand = { operationId: randomUUID(), expectedVersion: (await snapshot()).version, rows: [] };
  state.loseAcknowledgement = true;
  expect(await savePlayerStats(f.mapOneId, saveCommand)).toMatchObject({ success: false, error: { code: "INTERNAL_ERROR" } });
  const recovered = await getScoreboardOperationReceipt(f.mapOneId, { ...saveCommand, operation: "save" });
  expect(recovered).toMatchObject({ success: true, data: { status: "committed", superseded: false, receipt: { operationId: saveCommand.operationId } } });
  expect(await savePlayerStats(f.mapOneId, saveCommand)).toMatchObject({ success: true, data: { replayed: true } });
  const unconfirmed = await getScoreboardOperationReceipt(f.mapOneId, { ...saveCommand, operationId: randomUUID(), operation: "save" });
  expect(unconfirmed).toEqual({ success: true, data: { status: "unconfirmed" } });
  await db.insert(schema.matchPlayerStats).values({ mapId: f.mapOneId, matchId: f.matchId, perfectName: "Later unrelated change", ratingPro: 5 });
  expect(await getScoreboardOperationReceipt(f.mapOneId, { ...saveCommand, operation: "save" })).toMatchObject({ success: true, data: { superseded: true } });
  const countBeforeDenial = (await receipts()).rows.length;
  state.allowed = false;
  expect(await getScoreboardOperationReceipt(f.mapOneId, { ...saveCommand, operation: "save" })).toMatchObject({ success: false, error: { code: "FORBIDDEN" } });
  expect(await deletePlayerStatsByMap(f.mapOneId, { operationId: randomUUID(), expectedVersion: secondBefore.version })).toMatchObject({ success: false });
  state.allowed = true;
  expect((await receipts()).rows).toHaveLength(countBeforeDenial);
});
