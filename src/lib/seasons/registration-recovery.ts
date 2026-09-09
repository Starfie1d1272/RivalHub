import "server-only";

import { eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { seasons } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { openSeasonRegistrationInTx } from "@/lib/seasons/lifecycle";

export async function ensureRegistrationOpenForParticipantInTx(
  tx: TxDb,
  seasonId: string,
  now = new Date(),
): Promise<{ season: typeof seasons.$inferSelect; opened: boolean }> {
  const [season] = await tx
    .select()
    .from(seasons)
    .where(eq(seasons.id, seasonId))
    .for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛事不存在。");

  const scheduledOpeningIsDue =
    season.status === "registration" &&
    season.registrationOpenedAt === null &&
    season.registrationOpensAt !== null &&
    season.registrationOpensAt.getTime() <= now.getTime();
  const beforeClosingDeadline =
    season.registrationClosesAt === null || now.getTime() < season.registrationClosesAt.getTime();

  if (!scheduledOpeningIsDue || !beforeClosingDeadline) {
    return { season, opened: false };
  }

  const result = await openSeasonRegistrationInTx(tx, {
    seasonId,
    actorId: "system",
    now,
  });
  const [currentSeason] = await tx
    .select()
    .from(seasons)
    .where(eq(seasons.id, seasonId));
  return { season: currentSeason ?? season, opened: result.opened };
}
