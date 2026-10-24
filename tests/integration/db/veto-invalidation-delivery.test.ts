import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { beforeEach, expect, it, vi } from "vitest";
const cache = vi.hoisted(() => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/cache", () => cache);
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { finishVetoInteraction } from "@/lib/matches/veto-room/interaction";
import { reconcileVetoRoomReceipt, readVetoRoomSnapshot, rewindVetoRoom } from "@/lib/matches/veto-room/service";
import { deliverVetoInvalidation } from "@/lib/matches/veto-room/invalidation";
import { runMatchVetoTimeoutJob } from "@/lib/scheduler/runners";
import { PUBLIC_STATS_TAG, publicBetTag } from "@/lib/cache/tags";
import { seedFixture } from "./harness/mizar";
import { createLocalPool } from "./harness/database";

beforeEach(() => { vi.resetAllMocks(); });
const watermark = (matchId: string) => db.query.matchVetoInvalidations.findFirst({ where: eq(schema.matchVetoInvalidations.matchId, matchId) });

it("persists failed invalidation across a response and recovers on a no-change reconcile", async () => {
  const f = await seedFixture();
  await deliverVetoInvalidation(f.matchId, "route");
  cache.revalidateTag.mockClear();
  await db.update(schema.matchVetoSessions).set({ revision: 1 }).where(eq(schema.matchVetoSessions.matchId, f.matchId));
  const before = await watermark(f.matchId);
  expect(before!.generation).toBeGreaterThan(before!.publishedGeneration);
  let fail = true;
  cache.revalidateTag.mockImplementation(tag => { if (tag === publicBetTag(f.seasonId) && fail) { fail = false; throw new Error("cache dependency unavailable"); } });
  const first = await finishVetoInteraction(f.matchId, "applied", true, "route", null);
  expect(first.postCommit).toEqual({ invalidation: "pending", projection: "complete" });
  expect(first.room!.pendingInvalidation).toBe(true);
  expect(cache.revalidateTag.mock.calls.some(call => call[0] === PUBLIC_STATS_TAG)).toBe(false);
  expect((await watermark(f.matchId))!.publishedGeneration).toBe(before!.publishedGeneration);
  const receipt = await reconcileVetoRoomReceipt(f.matchId);
  expect(receipt.changed).toBe(false);
  const recovered = await finishVetoInteraction(f.matchId, receipt.outcome, false, "route", null);
  expect(recovered.postCommit).toEqual({ invalidation: "complete", projection: "complete" });
  expect(recovered.room!.pendingInvalidation).toBe(false);
  const after = (await watermark(f.matchId))!;
  expect(after.publishedGeneration).toBe(after.generation);
  expect(cache.revalidateTag.mock.calls.filter(call => call[0] === publicBetTag(f.seasonId))).toHaveLength(2);
});

it("does not acknowledge a generation committed while cache invalidation was in flight", async () => {
  const f = await seedFixture();
  const initial = (await watermark(f.matchId))!;
  const pool = createLocalPool({ max: 1 }); const client = await pool.connect();
  const original = client.query;
  let injected = false;
  client.query = ((...args: unknown[]) => {
    const text = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text;
    if (!injected && text?.startsWith('update "match_veto_invalidations"')) {
      injected = true;
      return db.update(schema.matchVetoSessions).set({ revision: sql`${schema.matchVetoSessions.revision}+1` })
        .where(eq(schema.matchVetoSessions.matchId, f.matchId))
        .then(() => Reflect.apply(original, client, args));
    }
    return Reflect.apply(original, client, args);
  }) as typeof client.query;
  try {
    const measured = drizzle(client, { schema });
    expect(await deliverVetoInvalidation(f.matchId, "route", measured)).toBe("pending");
    const raced = (await watermark(f.matchId))!;
    expect(raced.generation).toBeGreaterThan(initial.generation);
    expect(raced.publishedGeneration).toBe(initial.publishedGeneration);
    expect(await deliverVetoInvalidation(f.matchId, "route", measured)).toBe("complete");
    expect((await watermark(f.matchId))!.publishedGeneration).toBe(raced.generation);
  } finally { client.release(); await pool.end(); }
});

it("coalesces BP facts once per transaction and rolls the delivery obligation back with facts", async () => {
  const f = await seedFixture();
  // An old worker/backfill left an unpublished conservative category.
  await db.update(schema.matchVetoInvalidations).set({ affectedFacts: ["veto"] })
    .where(eq(schema.matchVetoInvalidations.matchId, f.matchId));
  const initial = (await watermark(f.matchId))!;
  await db.transaction(async tx => {
    await tx.update(schema.matchVetoSessions).set({ revision: 1 }).where(eq(schema.matchVetoSessions.matchId, f.matchId));
    await tx.update(schema.matchVetoSessions).set({ revision: 2 }).where(eq(schema.matchVetoSessions.matchId, f.matchId));
  });
  const committed = (await watermark(f.matchId))!;
  expect(committed.generation).toBe(initial.generation + BigInt(1));
  expect(committed.affectedFacts).toEqual(expect.arrayContaining(["veto", "veto_step"]));
  cache.revalidateTag.mockClear();
  await deliverVetoInvalidation(f.matchId, "route");
  expect(cache.revalidateTag.mock.calls.some(call => call[0] === PUBLIC_STATS_TAG)).toBe(true);
  const delivered = (await watermark(f.matchId))!;
  await expect(db.transaction(async tx => {
    await tx.update(schema.matchVetoSessions).set({ revision: 3 }).where(eq(schema.matchVetoSessions.matchId, f.matchId));
    throw new Error("rollback fixture");
  })).rejects.toThrow("rollback fixture");
  expect(await watermark(f.matchId)).toEqual(delivered);
});

it("makes scheduler delivery failures visible and recovers archived/paused rooms without domain replay", async () => {
  const f = await seedFixture();
  await db.update(schema.seasons).set({ status: "archived" }).where(eq(schema.seasons.id, f.seasonId));
  const before = (await readVetoRoomSnapshot(f.matchId)).session;
  const due = await db.execute(sql`select public.scheduler_job_is_due('resolve-match-veto-timeouts', false) as due`);
  expect(due.rows[0]!.due).toBe(true);
  cache.revalidateTag.mockImplementation(() => { throw new Error("cache delivery unavailable"); });
  await expect(runMatchVetoTimeoutJob()).rejects.toThrow("cache delivery unavailable");
  expect((await watermark(f.matchId))!.generation).toBeGreaterThan((await watermark(f.matchId))!.publishedGeneration);
  cache.revalidateTag.mockReset();
  expect(await runMatchVetoTimeoutJob()).toMatchObject({ businessTransitions: 0, result: { changed: 0, deliveryPending: 0 } });
  expect((await watermark(f.matchId))!.generation).toBe((await watermark(f.matchId))!.publishedGeneration);
  expect((await readVetoRoomSnapshot(f.matchId)).session).toEqual(before);
  expect(await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, f.matchId), eq(schema.auditLogs.action, "match.veto.timeout")))).toHaveLength(0);
});

it("hard-invalidates map catalog consumers when a BP plan is rewound or maps are replaced before finish", async () => {
  const f = await seedFixture();
  await deliverVetoInvalidation(f.matchId, "route");
  cache.revalidateTag.mockClear();
  const actor = (await db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, f.entryAId) }))!.representativeUserId;
  await rewindVetoRoom({ matchId: f.matchId, actorId: actor, targetTurnKey: "choose-veto-team-a", reason: "fixture map plan rewind" });
  expect((await watermark(f.matchId))!.affectedFacts).toContain("map_plan");
  expect(await deliverVetoInvalidation(f.matchId, "route")).toBe("complete");
  expect(cache.revalidateTag.mock.calls.some(call => call[0] === PUBLIC_STATS_TAG)).toBe(true);
  expect(cache.revalidateTag.mock.calls.some(call => call[0] === publicBetTag(f.seasonId))).toBe(true);
  cache.revalidateTag.mockClear();
  await db.transaction(async tx => {
    await tx.insert(schema.matchMaps).values({ matchId: f.matchId, mapOrder: 1, mapName: "de_vertigo" });
    await tx.update(schema.matchVetoSessions).set({ revision: sql`${schema.matchVetoSessions.revision}+1` }).where(eq(schema.matchVetoSessions.matchId, f.matchId));
  });
  expect((await watermark(f.matchId))!.affectedFacts).toEqual(expect.arrayContaining(["map_plan", "veto_step"]));
  expect(await deliverVetoInvalidation(f.matchId, "route")).toBe("complete");
  expect(cache.revalidateTag.mock.calls.some(call => call[0] === PUBLIC_STATS_TAG)).toBe(true);
});

it.each(["in_progress", "scheduled"] as const)("delivers pending obligations when an archived %s room also has a rejected lifecycle transition", async status => {
  const f = await seedFixture();
  await db.update(schema.matches).set({ status }).where(eq(schema.matches.id, f.matchId));
  await db.update(schema.matchVetoSessions).set({ completedAt: null, pausedAt: null,
    startedAt: status === "in_progress" ? new Date() : null,
    entryAStartRequestedAt: new Date(), turnDeadlineAt: sql`clock_timestamp() - interval '10 seconds'`,
  }).where(eq(schema.matchVetoSessions.matchId, f.matchId));
  await db.update(schema.seasons).set({ status: "archived" }).where(eq(schema.seasons.id, f.seasonId));
  const session = (await readVetoRoomSnapshot(f.matchId)).session;
  const before = (await watermark(f.matchId))!;
  expect(before.generation).toBeGreaterThan(before.publishedGeneration);
  cache.revalidateTag.mockClear();
  await expect(runMatchVetoTimeoutJob()).rejects.toThrow("赛季已归档");
  const after = (await watermark(f.matchId))!;
  expect(after.publishedGeneration).toBe(after.generation);
  expect(cache.revalidateTag.mock.calls.some(call => call[0] === publicBetTag(f.seasonId))).toBe(true);
  expect((await readVetoRoomSnapshot(f.matchId)).session).toEqual(session);
});
