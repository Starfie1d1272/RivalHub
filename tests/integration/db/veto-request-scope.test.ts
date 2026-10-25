import { expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { seedFixture } from "./harness/mizar";
import { assertVetoRoomReadable } from "@/lib/matches/veto-room/access";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getVetoRoomView } from "@/lib/matches/veto-room/read-model";
import { reconcileVetoRoomReceipt } from "@/lib/matches/veto-room/service";

const authorization = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", async original => ({
  ...await original<typeof import("@/lib/auth/session")>(), getCurrentUserAuthorization: authorization,
}));
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

it("reuses only this request's authorization while preserving draft grants and scope fences", async () => {
  const f = await seedFixture({ isTest: true });
  const entry = (await db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, f.entryAId) }))!;
  await db.update(schema.seasons).set({ status: "draft" }).where(eq(schema.seasons.id, f.seasonId));
  const season = (await db.query.seasons.findFirst({ where: eq(schema.seasons.id, f.seasonId) }))!;
  authorization.mockResolvedValue(null);
  await expect(assertVetoRoomReadable(f.matchId)).rejects.toMatchObject({ code: "MATCH_NOT_FOUND" });
  expect(authorization).toHaveBeenCalledTimes(1);

  const actor = { userId: entry.representativeUserId, email: "scope@fixture.local", role: "user" as const, seasonIds: [f.seasonId] };
  authorization.mockClear(); authorization.mockResolvedValue(actor);
  const access = await assertVetoRoomReadable(f.matchId);
  const room = await getVetoRoomView(f.matchId, access.authorization, access.seasonId);
  expect(room.match.id).toBe(f.matchId);
  expect(authorization).toHaveBeenCalledTimes(1);
  expect(access.authorization).toBe(actor);

  authorization.mockResolvedValue(null);
  // Explicit anonymous authorization cannot fall back to a different lookup.
  const authorizationCalls = authorization.mock.calls.length;
  expect(await getPublicOrAuthorizedDraftSeason(season.slug, null)).toBeNull();
  expect(authorization).toHaveBeenCalledTimes(authorizationCalls);
  await expect(assertVetoRoomReadable(f.matchId)).rejects.toMatchObject({ code: "MATCH_NOT_FOUND" });
  authorization.mockResolvedValue({ ...actor, seasonIds: ["00000000-0000-4000-8000-000000000001"] });
  await expect(assertVetoRoomReadable(f.matchId)).rejects.toMatchObject({ code: "MATCH_NOT_FOUND" });
  authorization.mockResolvedValue({ ...actor, role: "super_admin", seasonIds: [] });
  expect((await assertVetoRoomReadable(f.matchId)).seasonId).toBe(f.seasonId);
  // Other callers retain the canonical default authorization lookup.
  authorization.mockClear();
  expect((await getPublicOrAuthorizedDraftSeason(season.slug))?.id).toBe(f.seasonId);
  expect(authorization).toHaveBeenCalledTimes(1);

  const other = await seedFixture();
  const sessionBefore = await db.query.matchVetoSessions.findFirst({ where: eq(schema.matchVetoSessions.matchId, f.matchId) });
  await expect(reconcileVetoRoomReceipt(f.matchId, other.seasonId)).rejects.toMatchObject({ code: "MATCH_NOT_FOUND" });
  expect(await db.query.matchVetoSessions.findFirst({ where: eq(schema.matchVetoSessions.matchId, f.matchId) })).toEqual(sessionBefore);
  await expect(getVetoRoomView(f.matchId, actor, other.seasonId)).rejects.toMatchObject({ code: "MATCH_NOT_FOUND" });
});
