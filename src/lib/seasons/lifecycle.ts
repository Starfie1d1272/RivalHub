import { and, count, desc, eq } from "drizzle-orm";
import type { db as dbClient } from "@/db/client";
import { auditLogs, competitionEntries, conversionPolicies, matches, seasonRegistrations, seasons } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { fallbackCatalogReferencesExist, resolveLiveCompetitiveContext, type ResolvedCatalogContext } from "@/lib/competitive/catalog";
import { resolveCompetitiveContext } from "@/lib/qualification/service";
import { createCompetitionTemplate } from "@/lib/competition/templates";
import { normalizeTeamRegistrationConfig, type CompetitiveFallbackConversion, type SeasonStatus, type TeamRegistrationConfig } from "@/types/season";

type Transaction = Parameters<Parameters<typeof dbClient.transaction>[0]>[0];

const SEASON_HAS_FACTS_DELETE_MESSAGE = "该赛季已经产生报名、队伍或赛程事实，不能删除。";

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
  const registrations = await tx.select({ value: count() }).from(seasonRegistrations).where(eq(seasonRegistrations.seasonId, seasonId));
  const entries = await tx.select({ value: count() }).from(competitionEntries).where(eq(competitionEntries.competitionId, seasonId));
  const scheduledMatches = await tx.select({ value: count() }).from(matches).where(eq(matches.seasonId, seasonId));
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
      ? { ...draftTemplate.competitiveProfile, fallbackConversion: config.competitiveProfile?.fallbackConversion }
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
 * Resolves and locks the approved ConversionPolicy on season publish.
 * Fails closed if the requested policy is missing or not approved,
 * or if no approved policy exists when competitive profile is required.
 */
export async function resolveConversionPolicyForPublish(
  tx: Transaction,
  platform: string,
  requestedPolicyId?: string,
  requestedPolicyVersion?: string,
): Promise<{ id: string; version: string }> {
  if (requestedPolicyId) {
    const [policy] = await tx.select().from(conversionPolicies)
      .where(and(
        eq(conversionPolicies.id, requestedPolicyId),
        eq(conversionPolicies.sourcePlatform, "fivee"),
        eq(conversionPolicies.targetPlatform, platform),
      ))
      .limit(1);
    if (!policy) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "指定的 5E 换算策略不存在。");
    }
    if (policy.status !== "approved") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `指定的 5E 换算策略 (${policy.version}) 尚未启用或已被废弃。`);
    }
    return { id: policy.id, version: policy.version };
  }

  if (requestedPolicyVersion) {
    const [policy] = await tx.select().from(conversionPolicies)
      .where(and(
        eq(conversionPolicies.version, requestedPolicyVersion),
        eq(conversionPolicies.sourcePlatform, "fivee"),
        eq(conversionPolicies.targetPlatform, platform),
      ))
      .limit(1);
    if (!policy) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `指定的 5E 换算策略版本 (${requestedPolicyVersion}) 不存在。`);
    }
    if (policy.status !== "approved") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `指定的 5E 换算策略版本 (${policy.version}) 尚未启用或已被废弃。`);
    }
    return { id: policy.id, version: policy.version };
  }

  const [currentPolicy] = await tx.select().from(conversionPolicies)
    .where(and(
      eq(conversionPolicies.sourcePlatform, "fivee"),
      eq(conversionPolicies.targetPlatform, platform),
      eq(conversionPolicies.status, "approved"),
      eq(conversionPolicies.isCurrent, true),
    ))
    .limit(1);

  if (currentPolicy) {
    return { id: currentPolicy.id, version: currentPolicy.version };
  }

  const [latestApproved] = await tx.select().from(conversionPolicies)
    .where(and(
      eq(conversionPolicies.sourcePlatform, "fivee"),
      eq(conversionPolicies.targetPlatform, platform),
      eq(conversionPolicies.status, "approved"),
    ))
    .orderBy(desc(conversionPolicies.approvedAt))
    .limit(1);

  if (latestApproved) {
    return { id: latestApproved.id, version: latestApproved.version };
  }

  throw new AppError(ErrorCode.VALIDATION_FAILED, "未找到已启用的 5E 换算策略，不能发布赛事。");
}

/**
 * Resolve the frozen 5E fallback for a standard Major at registration open.
 * The season correspondence is positional (current↔current, previous↔previous,
 * prior↔prior); the mapping content comes from the policy locked at publish
 * or the active approved policy.
 */
async function resolveFallbackConversionForFreeze(
  tx: Transaction,
  context: ResolvedCatalogContext,
  platform: string,
  selectedPolicyId?: string,
  selectedPolicyVersion?: string,
): Promise<CompetitiveFallbackConversion | undefined> {
  if (platform !== "perfect_world") return undefined;

  let policy: typeof conversionPolicies.$inferSelect | undefined;

  if (selectedPolicyId) {
    const [found] = await tx.select().from(conversionPolicies)
      .where(and(
        eq(conversionPolicies.id, selectedPolicyId),
        eq(conversionPolicies.sourcePlatform, "fivee"),
        eq(conversionPolicies.targetPlatform, platform),
      ))
      .limit(1);
    if (!found) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "赛事选用的 5E 换算策略不存在，不能开放报名。");
    }
    if (found.status !== "approved") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `赛事选用的 5E 换算策略 (${found.version}) 状态为 ${found.status}，只有 approved 策略可以开放报名。`);
    }
    policy = found;
  } else if (selectedPolicyVersion) {
    const [found] = await tx.select().from(conversionPolicies)
      .where(and(
        eq(conversionPolicies.version, selectedPolicyVersion),
        eq(conversionPolicies.sourcePlatform, "fivee"),
        eq(conversionPolicies.targetPlatform, platform),
      ))
      .limit(1);
    if (!found) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `赛事选用的 5E 换算策略版本 (${selectedPolicyVersion}) 不存在，不能开放报名。`);
    }
    if (found.status !== "approved") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `赛事选用的 5E 换算策略 (${found.version}) 状态为 ${found.status}，只有 approved 策略可以开放报名。`);
    }
    policy = found;
  } else {
    const [current] = await tx.select().from(conversionPolicies)
      .where(and(
        eq(conversionPolicies.sourcePlatform, "fivee"),
        eq(conversionPolicies.targetPlatform, platform),
        eq(conversionPolicies.status, "approved"),
        eq(conversionPolicies.isCurrent, true),
      ))
      .limit(1);
    if (current) {
      policy = current;
    } else {
      const [latest] = await tx.select().from(conversionPolicies)
        .where(and(
          eq(conversionPolicies.sourcePlatform, "fivee"),
          eq(conversionPolicies.targetPlatform, platform),
          eq(conversionPolicies.status, "approved"),
        ))
        .orderBy(desc(conversionPolicies.approvedAt))
        .limit(1);
      policy = latest;
    }
  }

  if (!policy) return undefined;

  const fiveeContext = await resolveLiveCompetitiveContext(tx, "fivee");
  if (!fiveeContext || !fiveeContext.currentSeasonKey || !fiveeContext.previousSeasonKey || !fiveeContext.priorSeasonKey) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "5E 平台竞技目录未配置完整的当前赛季、上一赛季或前一赛季，无法完成相对赛季对齐。");
  }

  return {
    sourcePlatform: "fivee",
    version: policy.version,
    seasonKeyMap: {
      [context.currentSeasonKey]: fiveeContext.currentSeasonKey,
      [context.previousSeasonKey]: fiveeContext.previousSeasonKey,
      ...(context.priorSeasonKey && fiveeContext.priorSeasonKey ? { [context.priorSeasonKey]: fiveeContext.priorSeasonKey } : {}),
    },
    mapping: policy.mapping,
  };
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
  const fallbackConversion = await resolveFallbackConversionForFreeze(
    tx,
    context,
    platform,
    config.competitiveProfile?.conversionPolicyId,
    config.competitiveProfile?.conversionPolicyVersion,
  );
  const competitiveProfile = {
    platform,
    // Keep their literal catalog meaning for every frozen event. New
    // evaluators consume evidencePolicy for the distinct reference rule.
    currentSeasonKey: context.currentSeasonKey,
    previousSeasonKey: context.previousSeasonKey,
    rankOrder: context.rankOrder,
    evidencePolicy: {
      historicalWeight: 50 as const,
      referenceSeasonKey: context.priorSeasonKey,
      referenceSeasonWeight: 20 as const,
      recentSeasonKeys: [context.previousSeasonKey, context.currentSeasonKey],
      recentSeasonWeight: 30 as const,
    },
    conversionPolicyVersion: fallbackConversion?.version ?? config.competitiveProfile?.conversionPolicyVersion,
    conversionPolicyId: config.competitiveProfile?.conversionPolicyId,
    fallbackConversion,
  };
  if (!await resolveCompetitiveContext(competitiveProfile)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "5E fallback 映射必须覆盖本届冻结的全部赛季证据槽，并映射到已公布的 Perfect 段位后才能开放报名。");
  }
  if (competitiveProfile.fallbackConversion && !await fallbackCatalogReferencesExist(tx, competitiveProfile.fallbackConversion)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "5E fallback 映射引用的赛季或段位已不在竞技目录中，不能开放报名。");
  }
  return {
    ...config,
    competitiveProfile,
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
