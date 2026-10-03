import { expect, it, vi } from "vitest";
import type { Match, MatchMap } from "@/db/schema";
vi.mock("@/db/client", () => ({ db: { query: {
  matchVetoSessions: { findFirst: vi.fn(async () => undefined) },
  matchLiveSessions: { findFirst: vi.fn(async () => ({ currentMapId: "one", mapExecutionPhase: "inter_map" })) },
} } }));
import { loadPublicMatchPhase } from "./public-phase";
it("keeps the latest completed result and series wins independent of database row order", async () => {
  const match = { status: "in_progress", format: "bo3" } as Match;
  const map = (id: string, mapOrder: number, scoreA: number | null, scoreB: number | null) => ({ id, mapOrder, mapName: "de_ancient", scoreA, scoreB, completedAt: scoreA === null ? null : new Date() }) as MatchMap;
  const maps = [map("two", 2, 9, 13), map("three", 3, null, null), map("one", 1, 13, 9)];
  const context = await loadPublicMatchPhase(match, maps);
  expect(context).toMatchObject({ phase: "inter_map", currentMapId: "three", seriesProgress: { scoreA: 1, scoreB: 1 }, lastCompletedMap: { id: "two", scoreA: 9, scoreB: 13 } });
  maps[0].scoreA = 11;
  expect((await loadPublicMatchPhase(match, maps)).lastCompletedMap?.scoreA).toBe(11);
});
