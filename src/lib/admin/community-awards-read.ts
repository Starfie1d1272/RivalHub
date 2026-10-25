import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";
import { normalizeStagePlan } from "@/lib/seasons/compatibility";
import { getAdminCommunityAwardDetail, getCommunityAwardFormOptions } from "@/lib/community-awards/data";

async function authorizeAwardSeason(seasonId: string) {
  await requireSeasonAdmin(seasonId);
  const [season] = await db.select({ stagePlan: seasons.stagePlan, enabled: seasons.hasCommunityAwards }).from(seasons).where(eq(seasons.id, seasonId));
  if (!season?.enabled) throw new AppError(ErrorCode.NOT_FOUND, "社区奖管理已不可用。");
  return normalizeStagePlan(season.stagePlan);
}

export async function readAdminCommunityAward(input: { seasonId: string; awardId: string }) {
  const stagePlan = await authorizeAwardSeason(input.seasonId);
  const award = await getAdminCommunityAwardDetail(db, { ...input, stagePlan });
  if (!award) throw new AppError(ErrorCode.NOT_FOUND, "未找到本赛事可访问的社区奖。");
  return award;
}

export async function readAdminCommunityAwardOptions(seasonId: string) {
  const stagePlan = await authorizeAwardSeason(seasonId);
  return getCommunityAwardFormOptions(db, seasonId, stagePlan);
}
