import "server-only";
import { withDbTrafficSource } from "@/lib/observability/db-traffic";
import { beginRuntimeResource } from "@/lib/observability/runtime-resources";
import { cacheLife, cacheTag } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import {
  ALL_EVENT_STATS_TAG,
  eventStatsTag,
  publicSeasonTag,
  publicBetTag,
} from "@/lib/cache/tags";
import { preserveBetPublicFillFailure } from "./public-stats-failure";
import type { UnifiedBoardScope } from "./board-read";
import {
  readBetPublicStatsSnapshot,
  projectBetPublicStats,
  type BetPublicStatsScope,
} from "./public-stats-read";

async function cachedStats(seasonId: string, slug: string, scope: BetPublicStatsScope) {
  "use cache: remote";
  // Public aggregates stay warm until their domain tags are invalidated.
  cacheLife({ stale: 0, revalidate: Infinity, expire: Infinity });
  cacheTag(
    publicBetTag(seasonId),
    publicSeasonTag(slug),
    eventStatsTag(seasonId),
    ALL_EVENT_STATS_TAG,
  );
  const done = beginRuntimeResource("stats.public.fill");
  try {
    return await withDbTrafficSource("bet.fill", async () => {
      const snapshot = await db.transaction(
        async (tx) => {
          const season = await tx.query.seasons.findFirst({
            where: eq(seasons.id, seasonId),
            columns: { status: true, competitionTemplate: true },
          });
          if (!season || season.status === "draft" || season.competitionTemplate !== "major")
            return undefined;
          return readBetPublicStatsSnapshot(tx, seasonId, scope);
        },
        { accessMode: "read only", isolationLevel: "repeatable read" },
      );
      return await (snapshot ? projectBetPublicStats(snapshot) : undefined);
    });
  } catch (error) {
    preserveBetPublicFillFailure(error);
  } finally {
    done();
  }
}

/** Caller authorizes the season and resolves the viewer outside this shared cache. */
export async function getBetPublicStats(
  season: { id: string; slug: string; status: string },
  scope: UnifiedBoardScope = {},
) {
  if (season.status === "draft") return undefined;
  const view = scope.view ?? "open";
  if (["records", "leaderboard"].includes(view)) return undefined;
  return cachedStats(season.id, season.slug, {
    matchId: scope.matchId,
    view: view === "event" ? "event" : undefined,
    includeEvent: !scope.matchId && ["event", "mine", "settled"].includes(view),
    includeFree: !["event", "records", "leaderboard"].includes(view),
  });
}
