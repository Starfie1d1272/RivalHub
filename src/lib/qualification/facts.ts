import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { competitivePlatformSeasons, competitiveRankFacts, educationVerifications, institutions, steamProfiles, users } from "@/db/schema";
import type { SeasonEducationVerification } from "@/lib/education/eligibility";

export type DatabaseExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ParticipantQualificationFacts {
  userId?: string;
  displayName: string | null;
  perfectName: string | null;
  personaName: string | null;
  email: string | null;
  emailVerifiedAt: Date | null;
  steam64: string | null;
  qq: string | null;
  approvedEducation: boolean;
  educationHistory: SeasonEducationVerification[];
  historicalPeak: QualificationPeak | null;
  /** Season peaks keyed by catalogued platform season key. */
  seasonPeaks?: Map<string, QualificationSeasonPeak>;
  /** Target-platform catalogue chronology, oldest → newest. */
  platformSeasonOrder?: string[];
  /** Optional source-platform facts, loaded only for an event's frozen fallback policy. */
  fallbackFacts?: {
    historicalPeak: QualificationPeak | null;
    seasonPeaks: Map<string, QualificationSeasonPeak>;
  };
}

export type QualificationPeak = {
  status?: "ranked" | "unranked";
  rank: string | null;
  rating: number | null;
  stars?: number | null;
  sourcePlatform?: string;
  sourceSeasonKey?: string | null;
  sourceRank?: string;
};

export type QualificationSeasonPeak = {
  status?: "ranked" | "unranked";
  rank: string | null;
  rating: number | null;
  stars?: number | null;
  sourcePlatform?: string;
  sourceSeasonKey?: string | null;
  sourceRank?: string;
};

/** Request/transaction-scoped raw facts. Never cache this bundle across requests or executors. */
export async function loadParticipantQualificationRawBundle(
  userIds: readonly string[],
  options: {
    platform?: string;
    fallbackPlatform?: string;
    executor?: DatabaseExecutor;
    /** Raw multi-platform consumers need chronology; compatibility reads without a platform do not. */
    includePlatformChronology?: boolean;
    /** Skip rank facts for education/affiliation-only decisions. */
    includeCompetitiveFacts?: boolean;
  } = {},
) {
  const executor = options.executor ?? db;
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return { userRows: [], verificationRows: [], rankRows: [], platformSeasonRows: [] };
  const includeCompetitiveFacts = options.includeCompetitiveFacts ?? true;
  const platforms = [options.platform, options.fallbackPlatform].filter((item): item is string => Boolean(item));
  const rankFactsFilter = platforms.length > 0
    ? and(inArray(competitiveRankFacts.userId, ids), inArray(competitiveRankFacts.platform, platforms))
    : inArray(competitiveRankFacts.userId, ids);
  const userRows = await executor.select({ id: users.id, displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName, email: users.email, emailVerifiedAt: users.emailVerifiedAt, steam64: users.steam64, qq: users.qq })
    .from(users).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64)).where(and(inArray(users.id, ids), eq(users.status, "active")));
  const verificationRows = await executor.select({ userId: educationVerifications.userId, id: educationVerifications.id, status: educationVerifications.status, academicStatus: educationVerifications.academicStatus, institutionCode: institutions.moeInstitutionCode, institutionName: institutions.name, submittedAt: educationVerifications.submittedAt })
    .from(educationVerifications).innerJoin(users, and(eq(educationVerifications.userId, users.id), eq(users.status, "active"))).innerJoin(institutions, eq(educationVerifications.institutionId, institutions.id))
    .where(inArray(educationVerifications.userId, ids));
  const rankRows = includeCompetitiveFacts
    ? await executor.select().from(competitiveRankFacts).where(rankFactsFilter)
    : [];
  const platformSeasonRows = includeCompetitiveFacts && options.includePlatformChronology !== false
    ? await executor.select({ platform: competitivePlatformSeasons.platform, seasonKey: competitivePlatformSeasons.seasonKey })
      .from(competitivePlatformSeasons)
      .where(options.platform ? eq(competitivePlatformSeasons.platform, options.platform) : undefined)
      .orderBy(asc(competitivePlatformSeasons.sortOrder))
    : [];
  return { userRows, verificationRows, rankRows, platformSeasonRows };
}

export type ParticipantQualificationRawBundle = Awaited<ReturnType<typeof loadParticipantQualificationRawBundle>>;

/** Pure platform/fallback projection of facts read on one executor. */
export function projectParticipantQualificationFacts(
  bundle: ParticipantQualificationRawBundle,
  options: { platform?: string; fallbackPlatform?: string } = {},
): Map<string, ParticipantQualificationFacts> {
  const { userRows, verificationRows, rankRows, platformSeasonRows } = bundle;
  const facts = new Map<string, ParticipantQualificationFacts>();
  const platformSeasonOrder = options.platform
    ? platformSeasonRows.filter(row => row.platform === options.platform).map(row => row.seasonKey)
    : [];

  const approvedEducation = new Set(
    verificationRows.filter((row) => row.status === "approved").map((row) => row.userId),
  );
  const historyByUser = new Map<string, SeasonEducationVerification[]>();
  for (const row of verificationRows) {
    if (!row.status || !row.academicStatus || !row.institutionName) continue;
    const history = historyByUser.get(row.userId) ?? [];
    history.push({ id: row.id, status: row.status, academicStatus: row.academicStatus, institutionCode: row.institutionCode, institutionName: row.institutionName, submittedAt: row.submittedAt });
    historyByUser.set(row.userId, history);
  }

  for (const user of userRows) {
    const allPlatformFacts = rankRows.filter((row) => row.userId === user.id);
    const platformFacts = options.platform ? allPlatformFacts.filter((row) => row.platform === options.platform) : allPlatformFacts;
    const fallbackPlatformFacts = options.fallbackPlatform ? allPlatformFacts.filter((row) => row.platform === options.fallbackPlatform) : [];
    const historical = platformFacts.find((row) => row.kind === "historical_peak" && row.platformSeasonKey === null);
    const seasonPeaks = new Map<string, QualificationSeasonPeak>();
    for (const row of platformFacts) {
      if (row.kind === "season_peak" && row.platformSeasonKey !== null) {
        seasonPeaks.set(row.platformSeasonKey, { status: row.status, rank: row.rank, rating: row.rating === null ? null : Number(row.rating), stars: row.stars, sourcePlatform: row.platform, sourceSeasonKey: row.platformSeasonKey, sourceRank: row.rank ?? undefined });
      }
    }
    const fallbackHistorical = fallbackPlatformFacts.find((row) => row.kind === "historical_peak" && row.platformSeasonKey === null);
    const fallbackSeasonPeaks = new Map<string, QualificationSeasonPeak>();
    for (const row of fallbackPlatformFacts) if (row.kind === "season_peak" && row.platformSeasonKey !== null) fallbackSeasonPeaks.set(row.platformSeasonKey, { status: row.status, rank: row.rank, rating: row.rating === null ? null : Number(row.rating), stars: row.stars, sourcePlatform: row.platform, sourceSeasonKey: row.platformSeasonKey, sourceRank: row.rank ?? undefined });
    const toHistoricalPeak = (row: typeof historical): QualificationPeak | null => {
      if (!row) return null;
      if (row.status === "unranked") return { status: "unranked", rank: null, rating: null, stars: row.stars, sourcePlatform: row.platform, sourceSeasonKey: row.achievedSeasonKey, sourceRank: row.rank ?? undefined };
      if (row.rank === null && row.rating === null) return null;
      return { status: row.status, rank: row.rank, rating: row.rating === null ? null : Number(row.rating), stars: row.stars, sourcePlatform: row.platform, sourceSeasonKey: row.achievedSeasonKey, sourceRank: row.rank ?? undefined };
    };
    facts.set(user.id, {
      userId: user.id,
      displayName: user.displayName,
      perfectName: user.perfectName,
      personaName: user.personaName,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      steam64: user.steam64,
      qq: user.qq,
      approvedEducation: approvedEducation.has(user.id),
      educationHistory: historyByUser.get(user.id) ?? [],
      historicalPeak: toHistoricalPeak(historical),
      seasonPeaks,
      platformSeasonOrder,
      fallbackFacts: options.fallbackPlatform ? { historicalPeak: toHistoricalPeak(fallbackHistorical), seasonPeaks: fallbackSeasonPeaks } : undefined,
    });
  }
  return facts;
}

/** Compatibility entrypoint: fresh facts on the caller's executor, with the same platform scope. */
export async function loadParticipantQualificationFacts(
  userIds: readonly string[],
  options: {
    platform?: string;
    fallbackPlatform?: string;
    executor?: DatabaseExecutor;
    includeCompetitiveFacts?: boolean;
  } = {},
): Promise<Map<string, ParticipantQualificationFacts>> {
  if (userIds.length === 0) return new Map();
  return projectParticipantQualificationFacts(await loadParticipantQualificationRawBundle(userIds, { ...options, includePlatformChronology: Boolean(options.platform) }), options);
}

