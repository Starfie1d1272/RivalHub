import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { competitivePlatforms, competitivePlatformRanks, competitivePlatformSeasons, competitiveRankFacts, users } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { writeAuditInTx } from "@/lib/audit/write";
import { normalizeCompetitivePeaks, type SeasonPeak, type HistoricalPeak } from "./normalize-profile";

export async function saveCompetitiveProfileInTx(tx: TxDb, { userId, actorId, platform, historicalPeak, seasonPeaks }: { userId: string; actorId: string; platform: string; historicalPeak: HistoricalPeak; seasonPeaks: SeasonPeak[] }) {
  if (new Set(seasonPeaks.map(peak => peak.seasonKey)).size !== seasonPeaks.length) throw new AppError(ErrorCode.VALIDATION_FAILED, "平台赛季资料不能重复同一赛季。");
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
  const [platformRow] = await tx.select().from(competitivePlatforms).where(eq(competitivePlatforms.key, platform)).limit(1);
  if (!platformRow) throw new AppError(ErrorCode.VALIDATION_FAILED, "竞技平台不存在，不能保存竞技档案。");
  const ladder = await tx.select().from(competitivePlatformRanks).where(eq(competitivePlatformRanks.platformKey, platform));
  const seasons = await tx.select().from(competitivePlatformSeasons).where(eq(competitivePlatformSeasons.platform, platform)).orderBy(asc(competitivePlatformSeasons.sortOrder), asc(competitivePlatformSeasons.seasonKey));
  const ladderByKey = new Map(ladder.map((rank) => [rank.rankKey, rank]));
  const seasonKeys = new Set(seasons.map((season) => season.seasonKey));
  const existingFacts = await tx.select().from(competitiveRankFacts).where(and(eq(competitiveRankFacts.userId, userId), eq(competitiveRankFacts.platform, platform)));
  const existingByKey = new Map(existingFacts.map((fact) => [fact.kind === "historical_peak" ? "historical_peak" : `season_peak:${fact.platformSeasonKey}`, fact]));
  const validateFact = (fact: { rank: string; rating: number; stars: number | null }) => {
    const rank = ladderByKey.get(fact.rank);
    if (!rank) throw new AppError(ErrorCode.VALIDATION_FAILED, `段位不在平台段位表中，不能保存：${fact.rank}`);
    if (rank.starMin === null) {
      if (fact.stars !== null) throw new AppError(ErrorCode.VALIDATION_FAILED, `${rank.label} 不使用星数，不能填写星数。`);
      return;
    }
    if (fact.stars !== null) {
      if (fact.stars < rank.starMin || (rank.starMax !== null && fact.stars > rank.starMax)) {
        const range = rank.starMax === null ? `${rank.starMin}+` : `${rank.starMin}–${rank.starMax}`;
        throw new AppError(ErrorCode.VALIDATION_FAILED, `${rank.label} 的星数必须在 ${range} 范围内。`);
      }
      return;
    }
    throw new AppError(ErrorCode.VALIDATION_FAILED, `${rank.label} 需要填写准确星数。`);
  };
  if (historicalPeak.achievedSeasonKey && !seasonKeys.has(historicalPeak.achievedSeasonKey)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `历史最高达成赛季 ${historicalPeak.achievedSeasonKey} 不在目录中，不能保存。`);
  }
  for (const peak of seasonPeaks) {
    if (!seasonKeys.has(peak.seasonKey)) throw new AppError(ErrorCode.VALIDATION_FAILED, `平台赛季 ${peak.seasonKey} 不在目录中，不能保存。`);
    if (peak.status === "ranked") validateFact(peak);
  }
  validateFact(historicalPeak);
  const submitted = new Map(seasonPeaks.map(peak => [peak.seasonKey, peak]));
  const merged: SeasonPeak[] = seasons.map(season => {
    const peak = submitted.get(season.seasonKey);
    const existing = existingByKey.get(`season_peak:${season.seasonKey}`);
    // Deleting a linked conflicting row cannot silently turn it into a missing fact.
    if (peak && !(peak.status === "unrecorded" && historicalPeak.achievedSeasonKey === season.seasonKey && existing)) return peak;
    if (!existing) return { seasonKey: season.seasonKey, status: "unrecorded" };
    return existing.status === "unranked"
      ? { seasonKey: season.seasonKey, status: "unranked", rating: existing.rating === null ? null : Number(existing.rating) }
      : { seasonKey: season.seasonKey, status: "ranked", rank: existing.rank!, rating: Number(existing.rating), stars: existing.stars };
  });
  for (const peak of merged) if (peak.status === "ranked") validateFact(peak);
  const normalized = normalizeCompetitivePeaks(historicalPeak, merged, ladder);
  const facts = [
    { key: "historical_peak", kind: "historical_peak" as const, platformSeasonKey: null as string | null, value: normalized.historicalPeak },
    ...normalized.seasonPeaks.map((peak) => ({ key: `season_peak:${peak.seasonKey}`, kind: "season_peak" as const, platformSeasonKey: peak.seasonKey, value: peak })),
  ];
  for (const fact of facts) {
    const existing = existingByKey.get(fact.key);
    if (fact.kind === "season_peak" && fact.value.status === "unrecorded") {
      if (existing) await tx.delete(competitiveRankFacts).where(eq(competitiveRankFacts.id, existing.id));
      continue;
    }
    if (fact.value.status !== "ranked" && fact.value.status !== "unranked") continue;
    const values = fact.value.status === "unranked"
      ? { status: "unranked" as const, rank: null, rating: fact.value.rating === null ? null : String(fact.value.rating), stars: null, achievedSeasonKey: null, updatedAt: new Date() }
      : { status: "ranked" as const, rank: fact.value.rank, rating: String(fact.value.rating), stars: fact.value.stars, achievedSeasonKey: fact.kind === "historical_peak" ? fact.value.achievedSeasonKey : null, updatedAt: new Date() };
    if (existing) await tx.update(competitiveRankFacts).set(values).where(eq(competitiveRankFacts.id, existing.id));
    else await tx.insert(competitiveRankFacts).values({ userId: userId, platform, kind: fact.kind, platformSeasonKey: fact.platformSeasonKey, ...values });
  }
  await writeAuditInTx(tx, { action: "competitive_profile.self_declare", actorId: actorId, targetId: userId,meta: { platform, seasonKeys: normalized.seasonPeaks.map((peak) => peak.seasonKey), notices: normalized.notices } });
  return normalized;
}
