import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { correctMapScore } from "@/actions/matches/results";
import { ErrorCode } from "@/lib/errors";
import { seedFixture } from "./harness/mizar";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireSeasonAdmin: vi.fn(async () => ({ userId: "correction-admin" })),
  auditActorId: (session: { userId: string }) => session.userId,
}));

// The canonical runner owns disposable worker databases. Unlike a mock builder,
// this evidence executes the Action and checks persisted maps, series and audit.
describe("map-score correction PostgreSQL contract", () => {
  it.each([
    { name: "BO3 same winner", format: "bo3" as const, scores: [[13, 8], [13, 10], [8, 13]], target: 0, next: [16, 14], success: true },
    { name: "illegal MR12", format: "bo3" as const, scores: [[13, 8], [13, 10], [8, 13]], target: 0, next: [14, 13], success: false, code: ErrorCode.MATCH_INVALID_SCORE },
    { name: "BO3 winner reversal", format: "bo3" as const, scores: [[13, 8], [13, 10], [8, 13]], target: 1, next: [8, 13], success: false, message: "改变比赛胜者" },
    { name: "BO3 becomes unresolved", format: "bo3" as const, scores: [[13, 8], [13, 10]], target: 1, next: [8, 13], success: false, message: "无法构成完整比分" },
    { name: "BO1 remains map-count 1:0", format: "bo1" as const, scores: [[13, 8]], target: 0, next: [16, 14], success: true },
    { name: "BO1 winner reversal", format: "bo1" as const, scores: [[13, 8]], target: 0, next: [8, 13], success: false, message: "改变比赛胜者" },
  ])("$name", async ({ format, scores, target, next, success, code, message }) => {
    const fixture = await seedFixture({ unboundSource: true });
    const ids = [fixture.mapOneId, fixture.mapTwoId, randomUUID()];
    if (scores.length === 1) await db.delete(schema.matchMaps).where(eq(schema.matchMaps.id, fixture.mapTwoId));
    if (scores.length === 3) await db.insert(schema.matchMaps).values({ id: ids[2], matchId: fixture.matchId, mapOrder: 3, mapName: "de_nuke" });
    for (const [index, [scoreA, scoreB]] of scores.entries()) {
      await db.update(schema.matchMaps).set({ scoreA, scoreB, completedAt: new Date("2026-10-01T12:00:00Z") }).where(eq(schema.matchMaps.id, ids[index]!));
    }
    const seriesA = format === "bo1" ? 1 : 2, seriesB = scores.length === 3 ? 1 : 0;
    await db.update(schema.matches).set({ format, status: "finished", scoreA: seriesA, scoreB: seriesB }).where(eq(schema.matches.id, fixture.matchId));
    const read = async () => ({
      match: await db.query.matches.findFirst({ where: eq(schema.matches.id, fixture.matchId) }),
      maps: await db.query.matchMaps.findMany({ where: eq(schema.matchMaps.matchId, fixture.matchId), orderBy: schema.matchMaps.mapOrder }),
      audits: await db.query.auditLogs.findMany({ where: eq(schema.auditLogs.targetId, fixture.matchId) }),
    });
    const before = await read();
    const result = await correctMapScore(ids[target]!, next[0]!, next[1]!, { expectedScoreA: scores[target]![0], expectedScoreB: scores[target]![1], reason: "复核正式比分" });
    expect(result.success).toBe(success);
    const after = await read();
    if (!success) {
      expect(result).toMatchObject({ error: code ? { code } : { message: expect.stringContaining(message!) } });
      expect(after).toEqual(before);
    } else {
      expect(after.maps[target]).toMatchObject({ scoreA: next[0], scoreB: next[1] });
      expect(after.match).toMatchObject({ status: "finished", scoreA: seriesA, scoreB: seriesB });
      expect(after.audits.filter(row => row.action === "match.correct_map_score")).toEqual([
        expect.objectContaining({ actorId: "correction-admin", meta: expect.objectContaining({ mapId: ids[target], scoreA: next[0], scoreB: next[1], reason: "复核正式比分" }) }),
      ]);
    }
  });
});
