import "server-only";
import { and, eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { competitivePlatformRanks, competitivePlatformSeasons, competitiveRankFacts, users } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";

/** Only absent season rows qualify. Existing unranked or differing rows are never updated. */
export async function inspectCompetitiveProfileRepair(tx: TxDb, userId?: string) {
  const facts = await tx.select().from(competitiveRankFacts).where(userId ? eq(competitiveRankFacts.userId, userId) : undefined);
  const ladder = await tx.select().from(competitivePlatformRanks);
  const seasons = await tx.select().from(competitivePlatformSeasons);
  const candidates: Array<{ userId: string; platform: string; seasonKey: string; historicalFactId: string }> = [];
  let conflicts = 0;
  let invalid = 0;
  for (const historical of facts.filter(fact => fact.kind === "historical_peak" && fact.achievedSeasonKey !== null)) {
    const season = facts.find(fact => fact.userId === historical.userId && fact.platform === historical.platform && fact.kind === "season_peak" && fact.platformSeasonKey === historical.achievedSeasonKey);
    if (season) {
      if (season.status !== historical.status || season.rank !== historical.rank || season.stars !== historical.stars || Number(season.rating) !== Number(historical.rating)) conflicts++;
      continue;
    }
    const rank = ladder.find(rank => rank.platformKey === historical.platform && rank.rankKey === historical.rank);
    const validStars = rank && (rank.starMin === null ? historical.stars === null : historical.stars !== null && historical.stars >= rank.starMin && (rank.starMax === null || historical.stars <= rank.starMax));
    if (historical.status !== "ranked" || historical.rating === null || !validStars || !seasons.some(season => season.platform === historical.platform && season.seasonKey === historical.achievedSeasonKey)) { invalid++; continue; }
    candidates.push({ userId: historical.userId, platform: historical.platform, seasonKey: historical.achievedSeasonKey!, historicalFactId: historical.id });
  }
  return { candidates, missing: candidates.length, conflicts, invalid };
}

export async function repairCompetitiveProfileMissingRows(tx: TxDb, userId?: string) {
  const report = await inspectCompetitiveProfileRepair(tx, userId);
  let repaired = 0;
  for (const candidate of report.candidates.sort((left, right) => left.userId.localeCompare(right.userId))) {
    // Same user-row lock as the canonical profile save; re-read after the lock.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, candidate.userId)).for("update");
    const [historical] = await tx.select().from(competitiveRankFacts).where(eq(competitiveRankFacts.id, candidate.historicalFactId));
    if (!historical || historical.achievedSeasonKey !== candidate.seasonKey) continue;
    const [existing] = await tx.select({ id: competitiveRankFacts.id }).from(competitiveRankFacts).where(and(eq(competitiveRankFacts.userId, candidate.userId), eq(competitiveRankFacts.platform, candidate.platform), eq(competitiveRankFacts.kind, "season_peak"), eq(competitiveRankFacts.platformSeasonKey, candidate.seasonKey)));
    if (existing) continue;
    // Revalidate after concurrent profile/catalog edits; never materialize an invalid fact.
    const current = await inspectCompetitiveProfileRepair(tx, candidate.userId);
    if (!current.candidates.some(fact => fact.historicalFactId === historical.id && fact.seasonKey === candidate.seasonKey)) continue;
    const [inserted] = await tx.insert(competitiveRankFacts).values({ userId: candidate.userId, platform: candidate.platform, kind: "season_peak", platformSeasonKey: candidate.seasonKey, status: "ranked", rank: historical.rank, stars: historical.stars, rating: historical.rating }).onConflictDoNothing().returning({ id: competitiveRankFacts.id });
    if (!inserted) continue;
    await writeAuditInTx(tx, { action: "competitive_profile.repair_missing_season", actorId: "system:competitive-profile-repair-v1", targetId: candidate.userId, meta: { platform: candidate.platform, seasonKey: candidate.seasonKey, historicalFactId: historical.id, createdFactId: inserted.id, source: "only-missing-v1" } });
    repaired++;
  }
  return { ...report, repaired, after: await inspectCompetitiveProfileRepair(tx, userId) };
}
