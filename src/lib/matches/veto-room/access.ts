import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { getMatchOrThrow } from "@/lib/action-utils";
import { AppError, ErrorCode } from "@/lib/errors";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";

export async function assertVetoRoomReadable(matchId: string): Promise<void> {
  const match = await getMatchOrThrow(matchId);
  const [season] = await db.select({ id: seasons.id, slug: seasons.slug }).from(seasons)
    .where(eq(seasons.id, match.seasonId)).limit(1);
  const readable = season ? await getPublicOrAuthorizedDraftSeason(season.slug) : null;
  if (!season || readable?.id !== season.id) throw new AppError(ErrorCode.MATCH_NOT_FOUND, "比赛不存在。");
}
