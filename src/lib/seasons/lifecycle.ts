import { and, count, eq } from "drizzle-orm";
import type { db as dbClient } from "@/db/client";
import { competitivePlatformSeasons, matches, seasonRegistrations, seasons, teamApplications, teams } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { createCompetitionTemplate } from "@/lib/competition/templates";
import { normalizeTeamRegistrationConfig, type TeamRegistrationConfig } from "@/types/season";

type Transaction = Parameters<Parameters<typeof dbClient.transaction>[0]>[0];

export const SEASON_HAS_FACTS_DELETE_MESSAGE = "该赛季已经产生报名、队伍或赛程事实，不能删除。";

/**
 * Shared "no participation facts" guard for destructive draft lifecycle
 * actions (delete and revert-to-draft). Fails closed when the season already
 * produced registrations, applications, formal teams or matches.
 */
export async function assertSeasonHasNoHistoricalFacts(
  tx: Transaction,
  seasonId: string,
  message: string = SEASON_HAS_FACTS_DELETE_MESSAGE,
): Promise<void> {
  const [registrations, applications, formalTeams, scheduledMatches] = await Promise.all([
    tx.select({ value: count() }).from(seasonRegistrations).where(eq(seasonRegistrations.seasonId, seasonId)),
    tx.select({ value: count() }).from(teamApplications).where(eq(teamApplications.seasonId, seasonId)),
    tx.select({ value: count() }).from(teams).where(eq(teams.seasonId, seasonId)),
    tx.select({ value: count() }).from(matches).where(eq(matches.seasonId, seasonId)),
  ]);
  if ([registrations, applications, formalTeams, scheduledMatches].some(([row]) => Number(row?.value ?? 0) > 0)) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, message);
  }
}

/**
 * Reverts the publish-time competitive context freeze for built-in templates:
 * the frozen current/previous season keys and rank order are reset to the
 * template's draft context so the next publish resolves fresh facts from the
 * global platform catalog. Historical finished seasons are never touched by
 * this helper — it only runs inside the revert-to-draft transaction.
 */
export function unfreezeBuiltInCompetitiveContext(season: {
  competitionTemplate: "rivals" | "major" | "custom";
  teamRegistrationConfig: Partial<TeamRegistrationConfig> | null;
}): TeamRegistrationConfig | null {
  if (season.competitionTemplate !== "major" && season.competitionTemplate !== "rivals") return null;
  const config = normalizeTeamRegistrationConfig(season.teamRegistrationConfig);
  if (!config.requireCompetitiveProfile) return null;
  const draftTemplate = createCompetitionTemplate(season.competitionTemplate).teamRegistrationConfig;
  return {
    ...config,
    competitiveProfile: draftTemplate.competitiveProfile
      ? { ...draftTemplate.competitiveProfile }
      : undefined,
  };
}

/**
 * Publish-time competitive context freeze. When the season requires a
 * competitive profile but its draft configuration carries no explicit
 * context, the platform catalog's current season, the season before it and
 * the current rank order are frozen into teamRegistrationConfig. Once
 * published, later catalog changes never alter a season's frozen context.
 */
export async function freezeCompetitiveContext(
  tx: Transaction,
  season: typeof seasons.$inferSelect,
): Promise<TeamRegistrationConfig> {
  const config = normalizeTeamRegistrationConfig(season.teamRegistrationConfig);
  if (!config.requireCompetitiveProfile) return config;
  const requested = config.competitiveProfile;
  if (requested?.currentSeasonKey && requested.previousSeasonKey && requested.rankOrder.length > 0) return config;
  const platform = requested?.platform ?? "perfect_world";
  const catalog = await tx.select().from(competitivePlatformSeasons)
    .where(and(eq(competitivePlatformSeasons.platform, platform), eq(competitivePlatformSeasons.active, true)));
  const current = catalog.filter((entry) => entry.isCurrent);
  if (current.length !== 1 || current[0]!.rankOrder.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "请先在竞技平台赛季目录中设置唯一的当前赛季及段位顺序。");
  }
  const previous = catalog
    .filter((entry) => entry.sortOrder < current[0]!.sortOrder)
    .sort((a, b) => b.sortOrder - a.sortOrder)[0];
  if (!previous) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先在竞技平台赛季目录中录入并启用上一赛季。");
  return {
    ...config,
    competitiveProfile: {
      platform,
      currentSeasonKey: current[0]!.seasonKey,
      previousSeasonKey: previous.seasonKey,
      rankOrder: current[0]!.rankOrder,
    },
  };
}
