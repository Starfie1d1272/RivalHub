import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { PUBLIC_STATS_TAG, publicSeasonTag, publicBetTag } from "@/lib/cache/tags";
import type { UnifiedBoardScope } from "./board-read";
import { readBetPublicStats, type BetPublicStatsScope } from "./public-stats-read";

async function cachedStats(seasonId: string, slug: string, scope: BetPublicStatsScope) {
  "use cache: remote";
  cacheLife({stale:0,revalidate:14,expire:15});
  cacheTag(publicBetTag(seasonId),publicSeasonTag(slug),PUBLIC_STATS_TAG);
  return db.transaction(async tx=>{
    const season=await tx.query.seasons.findFirst({where:eq(seasons.id,seasonId),columns:{status:true,competitionTemplate:true}});
    if (!season || season.status === "draft" || season.competitionTemplate !== "major") return undefined;
    return readBetPublicStats(tx,seasonId,scope);
  },{accessMode:"read only",isolationLevel:"repeatable read"});
}

/** Caller authorizes the season and resolves the viewer outside this shared cache. */
export async function getBetPublicStats(season: {id:string;slug:string;status:string}, scope: UnifiedBoardScope = {}) {
  if (season.status === "draft") return undefined;
  const view=scope.view ?? "open";
  return cachedStats(season.id,season.slug,{
    matchId:scope.matchId,
    includeEvent:!scope.matchId && ["event","mine","settled"].includes(view),
    includeFree:!["event","records","leaderboard"].includes(view),
  });
}
