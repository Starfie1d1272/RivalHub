import { beforeEach, expect, it, vi } from "vitest";
import { createDefaultCacheHandler } from "next/dist/server/lib/cache-handlers/default";
import type { CacheEntry } from "next/dist/server/lib/cache-handlers/types";
import { revalidateVetoRoomPaths } from "@/lib/revalidation";
import { PUBLIC_STATS_TAG, publicBetTag } from "@/lib/cache/tags";

const cache = vi.hoisted(() => ({ updateTag: vi.fn(), revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/cache", () => cache);
const context = { slug: "fixture-season", seasonId: "fixture-season-id", matchId: "fixture-match", matchStatus: "in_progress" };
beforeEach(() => { vi.clearAllMocks(); });
it("does nothing for a receipt without committed changes", () => {
  revalidateVetoRoomPaths(context, { changed: false, affectedFacts: ["veto"] });
  expect(cache.updateTag).not.toHaveBeenCalled(); expect(cache.revalidateTag).not.toHaveBeenCalled(); expect(cache.revalidatePath).not.toHaveBeenCalled();
});
it.each(["scheduled", "in_progress"])("preserves historical stats but hard-expires real cached BP support for %s", async matchStatus => {
  const scoped = { ...context, matchStatus, seasonId: `${context.seasonId}-${matchStatus}` };
  const handler = createDefaultCacheHandler(4096);
  const timestamp = performance.timeOrigin + performance.now() - 10;
  const entry = (tag: string): CacheEntry => ({ value: new Blob(["fixture"]).stream(), tags: [tag], timestamp, stale: 60, revalidate: 3600, expire: 86400 });
  await handler.set("history", Promise.resolve(entry(PUBLIC_STATS_TAG)));
  await handler.set("support", Promise.resolve(entry(publicBetTag(scoped.seasonId))));
  expect(await handler.get("history", [])).toBeDefined(); expect(await handler.get("support", [])).toBeDefined();
  const updates: Promise<void>[] = [];
  cache.revalidateTag.mockImplementation((tag: string, durations: { expire: number } | string) => {
    updates.push(handler.updateTags([tag], typeof durations === "object" ? durations : { expire: 3600 }));
  });
  try {
    revalidateVetoRoomPaths(scoped, { changed: true, affectedFacts: ["lineups", "appeals"] }, { mode: "route" });
    await Promise.all(updates);
    await new Promise(resolve => setTimeout(resolve, 2));
    expect(cache.revalidateTag).not.toHaveBeenCalledWith(PUBLIC_STATS_TAG, expect.anything());
    expect(await handler.get("history", [])).toBeDefined();
    expect(await handler.get("support", [])).toBeUndefined();
    expect(cache.revalidatePath).toHaveBeenCalledWith(`/${context.slug}/matches/${context.matchId}`);
  } finally { cache.revalidateTag.mockReset(); }
});
it.each([
  { matchStatus: "in_progress", affectedFacts: ["veto"] },
  { matchStatus: "finished", affectedFacts: ["veto"] },
  { matchStatus: "cancelled", affectedFacts: ["veto"] },
  { matchStatus: "in_progress", affectedFacts: ["official_result"] },
  { matchStatus: "in_progress", affectedFacts: [] },
  { matchStatus: "in_progress", affectedFacts: undefined },
])("keeps the hard global fallback for conservative fact context %j", facts => {
  revalidateVetoRoomPaths({ ...context, matchStatus: facts.matchStatus }, { changed: true, affectedFacts: facts.affectedFacts }, { mode: "route" });
  expect(cache.revalidateTag).toHaveBeenCalledWith(PUBLIC_STATS_TAG, { expire: 0 });
  expect(cache.revalidateTag).toHaveBeenCalledWith(publicBetTag(context.seasonId), { expire: 0 });
});
it("keeps action read-your-writes and an explicit emergency global fallback", () => {
  revalidateVetoRoomPaths(context, { changed: true, affectedFacts: ["veto"] }, { statistics: true });
  expect(cache.updateTag).toHaveBeenCalledWith(PUBLIC_STATS_TAG);
  expect(cache.updateTag).toHaveBeenCalledWith(publicBetTag(context.seasonId));
  expect(cache.revalidateTag).not.toHaveBeenCalled();
});
