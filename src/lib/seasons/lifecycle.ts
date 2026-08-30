import { count, eq } from "drizzle-orm";
import type { db as dbClient } from "@/db/client";
import { competitionEntries, matches, seasonRegistrations, seasons } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { resolveLiveCompetitiveContext } from "@/lib/competitive/catalog";
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
  const [registrations, entries, scheduledMatches] = await Promise.all([
    tx.select({ value: count() }).from(seasonRegistrations).where(eq(seasonRegistrations.seasonId, seasonId)),
    tx.select({ value: count() }).from(competitionEntries).where(eq(competitionEntries.competitionId, seasonId)),
    tx.select({ value: count() }).from(matches).where(eq(matches.seasonId, seasonId)),
  ]);
  if ([registrations, entries, scheduledMatches].some(([row]) => Number(row?.value ?? 0) > 0)) {
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
 * competitive profile, the platform catalog's current season, the active
 * season before it and the platform-owned rank ladder are frozen into
 * teamRegistrationConfig. Once published, later catalog changes never alter a
 * season's frozen context. A missing current/previous season or an empty
 * ladder fails closed — there is no fallback rank order.
 */
export async function freezeCompetitiveContext(
  tx: Transaction,
  season: typeof seasons.$inferSelect,
): Promise<TeamRegistrationConfig> {
  const config = normalizeTeamRegistrationConfig(season.teamRegistrationConfig);
  if (!config.requireCompetitiveProfile) return config;
  const platform = config.competitiveProfile?.platform ?? "perfect_world";
  const context = await resolveLiveCompetitiveContext(tx, platform);
  if (!context) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `请先在竞技平台目录中为 ${platform} 配置唯一的当前赛季、启用的上一赛季和平台段位表。`);
  }
  return {
    ...config,
    competitiveProfile: {
      platform,
      currentSeasonKey: context.currentSeasonKey,
      previousSeasonKey: context.previousSeasonKey,
      rankOrder: context.rankOrder,
    },
  };
}
