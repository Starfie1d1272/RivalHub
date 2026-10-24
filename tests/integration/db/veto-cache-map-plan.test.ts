import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { createDefaultCacheHandler } from "next/dist/server/lib/cache-handlers/default";
import { fixture } from "./harness/bet-fixture";
import * as schema from "@/db/schema";
import { getTournamentStats } from "@/lib/stats/tournament-query";
import { revalidateVetoRoomPaths } from "@/lib/revalidation";
import { PUBLIC_STATS_TAG } from "@/lib/cache/tags";

const bridge = vi.hoisted<{ invalidate: (tag: string, expire?: number) => void }>(() => ({ invalidate: () => {} }));
vi.mock("next/cache", () => ({
  revalidateTag: (tag: string, durations: { expire?: number } | string) => bridge.invalidate(tag, typeof durations === "object" ? durations.expire : 3600),
  updateTag: (tag: string) => bridge.invalidate(tag), revalidatePath: () => {},
}));

it("expires warm statistics options/selection after a pre-finish map-plan replacement hidden by a legacy veto receipt", async () => fixture(async f => {
  const [season] = await f.db.select({ slug: schema.seasons.slug }).from(schema.seasons).where(eq(schema.seasons.id, f.seasonId));
  for (const matchStatus of ["scheduled", "in_progress"] as const) {
    for (const affectedFacts of [["veto"], ["map_plan"], ["veto_step", "map_plan"]]) {
    await f.db.update(schema.matches).set({ status: matchStatus }).where(eq(schema.matches.id, f.matchId));
    await f.db.delete(schema.matchMaps).where(eq(schema.matchMaps.matchId, f.matchId));
    await f.db.insert(schema.matchMaps).values({ matchId: f.matchId, mapOrder: 1, mapName: "de_mirage" });
    const before = await getTournamentStats({ seasonId: f.seasonId }, f.db);
    expect(before.options.maps).toContain("de_mirage");
    expect(before.selection.some(row => row.mapName === "de_mirage")).toBe(true);
    const cache = createDefaultCacheHandler(1024 * 1024);
    const put = (value: unknown) => cache.set("stats", Promise.resolve({ value: new Blob([JSON.stringify(value)]).stream(), timestamp: performance.timeOrigin + performance.now(), tags: [PUBLIC_STATS_TAG], stale: 60, revalidate: 3600, expire: 86400 }));
    await put(before);
    // These are real PG fixture writes modelling the map-plan owner's replace;
    // this verifies cache dependency, not the BP command/lock protocol itself.
    await f.db.delete(schema.matchMaps).where(eq(schema.matchMaps.matchId, f.matchId));
    await f.db.insert(schema.matchMaps).values({ matchId: f.matchId, mapOrder: 1, mapName: "de_nuke" });
    const fresh = await getTournamentStats({ seasonId: f.seasonId }, f.db);
    expect(fresh.options.maps).toContain("de_nuke");
    expect(fresh.selection.some(row => row.mapName === "de_nuke")).toBe(true);
    const warm = JSON.parse(await new Response((await cache.get("stats", []))!.value).text());
    expect(warm.options.maps).not.toContain("de_nuke");
    const pending: Promise<void>[] = [];
    bridge.invalidate = (tag, expire) => { pending.push(cache.updateTags([tag], expire === undefined ? undefined : { expire })); };
    try {
      revalidateVetoRoomPaths({ slug: season!.slug, seasonId: f.seasonId, matchId: f.matchId, matchStatus }, { changed: true, affectedFacts }, { mode: "route" });
      await Promise.all(pending);
      // Next rounds tag timestamps to integer milliseconds; let that at-most
      // half-ms future boundary pass before asserting a subsequent read.
      await new Promise(resolve => setTimeout(resolve, 2));
      expect(await cache.get("stats", [])).toBeUndefined();
      await put(fresh);
      const rebuilt = JSON.parse(await new Response((await cache.get("stats", []))!.value).text());
      expect(rebuilt.options.maps).toContain("de_nuke");
      expect(rebuilt.selection.some((row: { mapName: string }) => row.mapName === "de_nuke")).toBe(true);
    } finally { bridge.invalidate = () => {}; }
    }
  }
}));
