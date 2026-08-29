import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { competitivePlatformSeasons, competitiveRankFacts, educationVerifications, institutions, users } from "@/db/schema";
import { getPlayerStrengthBreakdown, type PlayerStrengthInput } from "./player-strength";
import type { CompetitiveProfileConfig } from "@/types/season";

export interface ParticipantReadiness {
  ready: boolean;
  blockers: string[];
  strength: PlayerStrengthInput;
  educationApproved: boolean;
}

export async function resolveCompetitiveContext(config: CompetitiveProfileConfig): Promise<CompetitiveProfileConfig | null> {
  if (config.currentSeasonKey && config.previousSeasonKey && config.rankOrder.length > 0) return config;
  const catalog = await db.select().from(competitivePlatformSeasons).where(and(eq(competitivePlatformSeasons.platform, config.platform), eq(competitivePlatformSeasons.active, true)));
  const current = catalog.find((item) => item.isCurrent);
  const previous = current ? catalog.filter((item) => item.sortOrder < current.sortOrder).sort((a, b) => b.sortOrder - a.sortOrder)[0] : null;
  return current && previous && current.rankOrder.length > 0
    ? { platform: config.platform, currentSeasonKey: current.seasonKey, previousSeasonKey: previous.seasonKey, rankOrder: current.rankOrder }
    : null;
}

export async function getParticipantReadiness(userId: string, config: CompetitiveProfileConfig): Promise<ParticipantReadiness> {
  const context = await resolveCompetitiveContext(config);
  if (!context) {
    return { ready: false, blockers: ["竞技平台赛季目录尚未完成当前与上一赛季配置。"], strength: { userId, label: "选手", historicalPeak: null, previousSeasonPeak: null, currentSeasonPeak: null }, educationApproved: false };
  }
  const [user, approvedEducation, facts] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    db.select({ id: educationVerifications.id, institutionName: institutions.name }).from(educationVerifications).innerJoin(institutions, eq(educationVerifications.institutionId, institutions.id)).where(and(eq(educationVerifications.userId, userId), eq(educationVerifications.status, "approved"))).limit(1),
    db.select().from(competitiveRankFacts).where(and(eq(competitiveRankFacts.userId, userId), eq(competitiveRankFacts.platform, context.platform))),
  ]);
  const historical = facts.find((fact) => fact.kind === "historical_peak" && fact.platformSeasonKey === null) ?? null;
  const previous = facts.find((fact) => fact.kind === "season_peak" && fact.platformSeasonKey === context.previousSeasonKey) ?? null;
  const current = facts.find((fact) => fact.kind === "season_peak" && fact.platformSeasonKey === context.currentSeasonKey) ?? null;
  const strength: PlayerStrengthInput = { userId, label: user?.displayName ?? user?.perfectName ?? user?.email ?? "未知选手", historicalPeak: historical ? { rank: historical.rank, rating: Number(historical.rating) } : null, previousSeasonPeak: previous ? { rank: previous.rank, rating: Number(previous.rating) } : null, currentSeasonPeak: current ? { rank: current.rank, rating: Number(current.rating) } : null };
  const blockers: string[] = [];
  if (!user?.displayName?.trim()) blockers.push("请填写展示昵称。");
  if (!user?.steam64?.trim()) blockers.push("请填写 Steam64 ID。");
  if (!user?.perfectId?.trim()) blockers.push("请填写完美世界竞技平台 ID。");
  if (!user?.qq?.trim()) blockers.push("请填写 QQ 号。");
  if (!user?.emailVerifiedAt) blockers.push("请先验证邮箱。");
  if (approvedEducation.length === 0) blockers.push("请完成并通过高校身份认证。");
  blockers.push(...getPlayerStrengthBreakdown(strength, context).blockers);
  return { ready: blockers.length === 0, blockers: [...new Set(blockers)], strength, educationApproved: approvedEducation.length > 0 };
}
