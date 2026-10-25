import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, seasons } from "@/db/schema";
import { assertCompetitionMatch } from "@/lib/matches/competition-context";
import { getCurrentUserAuthorization } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";

/** Scope and DB-derived authorization belong only to this request, never HTTP input. */
export async function assertVetoRoomReadable(matchId: string) {
  const [[season], authorization] = await Promise.all([
    db.select({ id: seasons.id, slug: seasons.slug, seasonId: matches.seasonId,
      entryAId: matches.entryAId, entryBId: matches.entryBId, stage: matches.stage }).from(matches)
      .leftJoin(seasons, eq(seasons.id, matches.seasonId)).where(eq(matches.id, matchId)).limit(1),
    getCurrentUserAuthorization(),
  ]);
  if (season) assertCompetitionMatch(season);
  const readable = season?.slug ? await getPublicOrAuthorizedDraftSeason(season.slug, authorization) : null;
  if (!season?.id || readable?.id !== season.id) throw new AppError(ErrorCode.MATCH_NOT_FOUND, "比赛不存在。");
  return { seasonId: season.id, authorization };
}
