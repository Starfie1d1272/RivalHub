import { count, eq } from "drizzle-orm";
import type { db as dbClient } from "@/db/client";
import { auditLogs, competitionEntries, matches, seasonRegistrations, seasons } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { resolveLiveCompetitiveContext } from "@/lib/competitive/catalog";
import { createCompetitionTemplate } from "@/lib/competition/templates";
import { normalizeTeamRegistrationConfig, type SeasonStatus, type TeamRegistrationConfig } from "@/types/season";

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
 * Reverts the registration-open competitive context freeze for built-in
 * templates, restoring the draft's unbound policy. Historical finished events
 * are never touched by this helper — it only runs inside revert-to-draft.
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
 * Canonical row-locked season status transition with its audit record in the
 * same transaction. `SELECT … FOR UPDATE` closes the check-then-write race
 * between concurrent admins, so a committed business fact always has its
 * committed audit counterpart and an illegal transition writes nothing.
 */
export async function transitionSeasonStatusInTx(
  tx: Transaction,
  input: { seasonId: string; from: SeasonStatus; to: SeasonStatus; action: string; actorId: string; failureMessage: string },
): Promise<{ slug: string }> {
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, input.seasonId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在。");
  if (season.status !== input.from) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, input.failureMessage);
  await tx.update(seasons).set({ status: input.to, updatedAt: new Date() }).where(eq(seasons.id, season.id));
  await tx.insert(auditLogs).values({
    seasonId: season.id,
    action: input.action,
    actorId: input.actorId,
    targetId: season.id,
    targetType: "season",
    meta: { slug: season.slug, from: season.status, to: input.to },
  });
  return { slug: season.slug };
}

/**
 * Registration-open competitive context freeze. The event consumes two stable
 * completed-season references plus the catalog's current (possibly ongoing)
 * season, while the catalog itself remains free to advance its current pointer.
 * This function must run in the same transaction that opens participation.
 */
export async function freezeCompetitiveContext(
  tx: Transaction,
  season: typeof seasons.$inferSelect,
): Promise<TeamRegistrationConfig> {
  const config = normalizeTeamRegistrationConfig(season.teamRegistrationConfig);
  if (!config.requireCompetitiveProfile) return config;
  const platform = config.competitiveProfile?.platform ?? "perfect_world";
  const context = await resolveLiveCompetitiveContext(tx, platform);
  if (!context || !context.priorSeasonKey) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `请先在竞技平台目录中为 ${platform} 配置唯一的当前赛季、两届启用的历史赛季和平台段位表。`);
  }
  return {
    ...config,
    competitiveProfile: {
      platform,
      // Keep these stable slots for compatibility with pre-2.1 frozen
      // snapshots; new evaluators consume evidencePolicy instead.
      currentSeasonKey: context.previousSeasonKey,
      previousSeasonKey: context.priorSeasonKey,
      rankOrder: context.rankOrder,
      evidencePolicy: {
        historicalWeight: 50,
        referenceSeasonKey: context.priorSeasonKey,
        referenceSeasonWeight: 20,
        recentSeasonKeys: [context.previousSeasonKey, context.currentSeasonKey],
        recentSeasonWeight: 30,
      },
    },
  };
}

/**
 * Canonical participation-open transition. It row-locks the published event,
 * freezes its competitive evidence exactly once, and records the audit fact in
 * the same transaction. Both the admin "open now" action and scheduled cron
 * processing use this owner so a catalog change cannot race an application.
 */
export async function openSeasonRegistrationInTx(
  tx: Transaction,
  input: { seasonId: string; actorId: string; now?: Date; openNow?: boolean },
): Promise<{ slug: string; opened: boolean }> {
  const now = input.now ?? new Date();
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, input.seasonId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛事不存在。");
  if (season.status !== "registration") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有已发布赛事可以开放报名。");
  if (season.registrationOpenedAt) return { slug: season.slug, opened: false };
  const configuredOpenAt = input.openNow ? now : season.registrationOpensAt;
  if (!configuredOpenAt || configuredOpenAt.getTime() > now.getTime()) return { slug: season.slug, opened: false };
  const config = normalizeTeamRegistrationConfig(season.teamRegistrationConfig);
  const teamRegistrationConfig = config.requireCompetitiveProfile
    ? await freezeCompetitiveContext(tx, season)
    : config;
  await tx.update(seasons).set({
    registrationOpensAt: configuredOpenAt,
    registrationOpenedAt: now,
    teamRegistrationConfig,
    updatedAt: now,
  }).where(eq(seasons.id, season.id));
  await tx.insert(auditLogs).values({
    seasonId: season.id,
    action: "season.registration_open",
    actorId: input.actorId,
    targetId: season.id,
    targetType: "season",
    meta: { slug: season.slug, registrationOpensAt: configuredOpenAt.toISOString(), competitiveContextFrozen: config.requireCompetitiveProfile },
  });
  return { slug: season.slug, opened: true };
}
