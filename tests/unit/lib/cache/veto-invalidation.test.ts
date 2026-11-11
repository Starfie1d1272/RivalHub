import { beforeEach, expect, it, vi } from "vitest";
import { createDefaultCacheHandler } from "next/dist/server/lib/cache-handlers/default";
import type { CacheEntry } from "next/dist/server/lib/cache-handlers/types";
import { revalidateMatchProjectionPaths } from "@/lib/matches/projection-invalidation/next-adapter";
import { ALL_EVENT_STATS_TAG, PUBLIC_STATS_TAG, eventStatsTag, publicBetTag } from "@/lib/cache/tags";

const cache = vi.hoisted(() => ({ updateTag: vi.fn(), revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/cache", () => cache);
const context = { slug: "fixture-season", seasonId: "fixture-season-id", matchId: "fixture-match", matchStatus: "in_progress" };
beforeEach(() => { vi.clearAllMocks(); });
it("does nothing for a receipt without committed changes", () => {
  revalidateMatchProjectionPaths(context, { changed: false, affectedFacts: ["veto"] });
  expect(cache.updateTag).not.toHaveBeenCalled(); expect(cache.revalidateTag).not.toHaveBeenCalled(); expect(cache.revalidatePath).not.toHaveBeenCalled();
});
it("keeps warm statistics for another event and expires the corrected event and platform results", async () => {
  const matchStatus = "finished";
  const scoped = { ...context, matchStatus, seasonId: `${context.seasonId}-${matchStatus}` };
  const handler = createDefaultCacheHandler(4096);
  const timestamp = performance.timeOrigin + performance.now() - 10;
  const entry = (tag: string): CacheEntry => ({ value: new Blob(["fixture"]).stream(), tags: [tag], timestamp, stale: 60, revalidate: 3600, expire: 86400 });
  await handler.set("history", Promise.resolve(entry(PUBLIC_STATS_TAG)));
  await handler.set("corrected", Promise.resolve(entry(eventStatsTag(scoped.seasonId))));
  await handler.set("unaffected", Promise.resolve(entry(eventStatsTag("different-season"))));
  await handler.set("support", Promise.resolve(entry(publicBetTag(scoped.seasonId))));
  expect(await handler.get("history", [])).toBeDefined(); expect(await handler.get("support", [])).toBeDefined();
  const updates: Promise<void>[] = [];
  cache.revalidateTag.mockImplementation((tag: string, durations: { expire: number } | string) => {
    updates.push(handler.updateTags([tag], typeof durations === "object" ? durations : { expire: 3600 }));
  });
  try {
    revalidateMatchProjectionPaths(scoped, { changed: true, affectedFacts: ["map_plan"] }, { mode: "route" });
    await Promise.all(updates);
    await new Promise(resolve => setTimeout(resolve, 2));
    expect(cache.revalidateTag).not.toHaveBeenCalledWith(ALL_EVENT_STATS_TAG, expect.anything());
    expect(await handler.get("history", [])).toBeUndefined();
    expect(await handler.get("corrected", [])).toBeUndefined();
    expect(await handler.get("unaffected", [])).toBeDefined();
    expect(await handler.get("support", [])).toBeUndefined();
    expect(cache.revalidatePath).toHaveBeenCalledWith(`/${context.slug}/matches/${context.matchId}`);
  } finally { cache.revalidateTag.mockReset(); }
});
it("preserves historical statistics when a live lineup or BP turn changes", () => {
  revalidateMatchProjectionPaths(context, { changed: true, affectedFacts: ["lineups", "veto_step"] }, { mode: "route" });
  expect(cache.revalidateTag).not.toHaveBeenCalledWith(PUBLIC_STATS_TAG, expect.anything());
  expect(cache.revalidateTag).toHaveBeenCalledWith(publicBetTag(context.seasonId), { expire: 0 });
});
it("keeps action read-your-writes for the event and platform", () => {
  revalidateMatchProjectionPaths(context, { changed: true, affectedFacts: ["veto"] }, { statistics: true });
  expect(cache.updateTag).toHaveBeenCalledWith(PUBLIC_STATS_TAG);
  expect(cache.updateTag).toHaveBeenCalledWith(publicBetTag(context.seasonId));
  expect(cache.revalidateTag).not.toHaveBeenCalled();
});
