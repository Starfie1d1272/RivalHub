import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { competitiveRankFacts, educationVerifications, institutions, users } from "@/db/schema";
import { getPlayerStrengthBreakdown, evaluateExternalStrengthRule, type PlayerStrengthInput } from "@/lib/major/player-strength";
import {
  evaluateRosterEducationEligibility,
  resolveSeasonEducationVerification,
  type EducationEligibilityResult,
  type SeasonEducationVerification,
} from "@/lib/education/eligibility";
import type { CompetitiveProfileConfig, InstitutionAffiliationRule } from "@/types/season";

/**
 * Single orchestration owner for participant qualification.
 *
 * Live qualification facts (profile completeness, approved education, platform
 * rank facts) are loaded in batched queries and evaluated by the existing pure
 * evaluators. Event lifecycle stays: registration/application read live facts,
 * prestart freezes, matches read frozen facts.
 */

export type DatabaseExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ParticipantQualificationFacts {
  userId?: string;
  displayName: string | null;
  perfectName: string | null;
  steamName: string | null;
  email: string | null;
  emailVerifiedAt: Date | null;
  steam64: string | null;
  qq: string | null;
  approvedEducation: boolean;
  educationHistory: SeasonEducationVerification[];
  historicalPeak: QualificationPeak | null;
  /** Season peaks keyed by catalogued platform season key. */
  seasonPeaks?: Map<string, QualificationSeasonPeak>;
  /** Optional source-platform facts, loaded only for an event's frozen fallback policy. */
  fallbackFacts?: {
    historicalPeak: QualificationPeak | null;
    seasonPeaks: Map<string, QualificationSeasonPeak>;
  };
}

type QualificationPeak = {
  rank: string;
  rating: number;
  sourcePlatform?: string;
  sourceSeasonKey?: string | null;
  sourceRank?: string;
};

type QualificationSeasonPeak = {
  status?: "ranked" | "unranked";
  rank: string | null;
  rating: number | null;
  sourcePlatform?: string;
  sourceSeasonKey?: string | null;
  sourceRank?: string;
};

export interface ParticipantReadiness {
  ready: boolean;
  blockers: string[];
  strength: PlayerStrengthInput;
  educationApproved: boolean;
}

/** Adapts long-term facts to the event's frozen evidence policy in one place. */
export function toPlayerStrengthInput(
  fact: Pick<ParticipantQualificationFacts, "userId" | "displayName" | "perfectName" | "email" | "historicalPeak" | "seasonPeaks" | "fallbackFacts">,
  context: CompetitiveProfileConfig | null,
): PlayerStrengthInput {
  const policy = context?.evidencePolicy;
  const fallback = context?.fallbackConversion;
  const lowestRank = context?.rankOrder[0] ?? null;
  const resolve = (
    primary: { status?: "ranked" | "unranked"; rank: string | null; rating: number | null; sourcePlatform?: string; sourceSeasonKey?: string | null; sourceRank?: string } | null | undefined,
    fallbackFact: { rank: string | null; rating: number | null; sourcePlatform?: string; sourceSeasonKey?: string | null; sourceRank?: string } | null | undefined,
  ) => {
    if (primary?.status !== "unranked" && primary?.rank && primary.rating !== null && primary.rating !== undefined) {
      return { rank: primary.rank, rating: primary.rating, sourcePlatform: primary.sourcePlatform, sourceSeasonKey: primary.sourceSeasonKey, sourceRank: primary.sourceRank };
    }
    if (fallback && fallbackFact?.rank && fallbackFact.rating !== null) {
      const rank = fallback.rankMap[fallbackFact.rank];
      // A 5E Rating+ has no reviewed conversion to Perfect Rating Pro. It can
      // establish an equivalent rank, but must not participate in Rating Pro's
      // final tie-break.
      if (rank) return { rank, rating: 0, ratingComparable: false, sourcePlatform: fallback.sourcePlatform, sourceSeasonKey: fallbackFact.sourceSeasonKey, sourceRank: fallbackFact.rank, conversionVersion: fallback.version };
    }
    // Explicitly unranked is a declared lowest available platform state. The
    // lowest frozen rank is derived from the event map, not a magic rank key.
    if (primary?.status === "unranked" && lowestRank) return { rank: lowestRank, rating: 0, sourcePlatform: primary.sourcePlatform, sourceSeasonKey: primary.sourceSeasonKey };
    return null;
  };
  const fallbackFor = (seasonKey: string) => {
    const sourceSeasonKey = fallback?.seasonKeyMap[seasonKey];
    const source = sourceSeasonKey ? fact.fallbackFacts?.seasonPeaks.get(sourceSeasonKey) : undefined;
    return source
      ? { ...source, sourcePlatform: source.sourcePlatform ?? fallback?.sourcePlatform, sourceSeasonKey: source.sourceSeasonKey ?? sourceSeasonKey }
      : undefined;
  };
  const referenceSeasonKey = policy?.referenceSeasonKey ?? context?.previousSeasonKey ?? "";
  const recentSeasonKeys = policy?.recentSeasonKeys ?? (context?.currentSeasonKey ? [context.currentSeasonKey] : []);
  return {
    userId: fact.userId ?? "",
    label: fact.displayName ?? fact.perfectName ?? fact.email ?? "未知选手",
    historicalPeak: resolve(fact.historicalPeak, fact.fallbackFacts?.historicalPeak),
    previousSeasonPeak: resolve(fact.seasonPeaks?.get(referenceSeasonKey), fallbackFor(referenceSeasonKey)),
    currentSeasonPeak: resolve(fact.seasonPeaks?.get(context?.currentSeasonKey ?? ""), fallbackFor(context?.currentSeasonKey ?? "")),
    recentSeasonPeaks: recentSeasonKeys.map((key) => resolve(fact.seasonPeaks?.get(key), fallbackFor(key))),
  };
}

/** Canonical long-term identity requirements shared by settings and read models. */
export function getParticipantIdentityBlockers(fact: ParticipantQualificationFacts): string[] {
  const blockers: string[] = [];
  if (!fact.displayName?.trim()) blockers.push("请填写展示昵称。");
  if (!fact.steam64?.trim()) blockers.push("请填写 Steam64 ID。");
  if (!fact.perfectName?.trim()) blockers.push("请填写完美平台昵称。");
  if (!fact.qq?.trim()) blockers.push("请填写 QQ 号。");
  if (!fact.emailVerifiedAt) blockers.push("请先验证邮箱。");
  return blockers;
}

/** Canonical competitive-profile completeness for one frozen or catalog context. */
function getCompetitiveProfileBlockers(
  fact: ParticipantQualificationFacts,
  context: CompetitiveProfileConfig | null,
): string[] {
  if (!context) return ["竞技平台赛季目录尚未完成当前与上一赛季配置。"];
  const strength = toPlayerStrengthInput(fact, context);
  return getPlayerStrengthBreakdown(strength, context).blockers.map((blocker) => {
    if (!context.evidencePolicy && blocker.includes("缺少上赛季")) return `缺少${context.platform} · ${context.previousSeasonKey} 的最高段位及 Rating。`;
    if (!context.evidencePolicy && blocker.includes("缺少当前赛季")) return `缺少${context.platform} · ${context.currentSeasonKey} 的最高段位及 Rating。`;
    if (context.evidencePolicy && blocker.includes("前一完整")) return `缺少${context.platform} · ${context.evidencePolicy.referenceSeasonKey} 的最高段位及 Rating。`;
    if (context.evidencePolicy && blocker.includes("近期赛季")) return `缺少${context.platform} · ${context.evidencePolicy.recentSeasonKeys.join(" / ")} 的可用竞技资料。`;
    return blocker;
  });
}

/**
 * Event qualification only accepts the publish-time frozen context. A missing
 * or partial legacy snapshot is deliberately not repaired from today's live
 * catalog: that would rewrite historical event semantics.
 */
function isCompleteCompetitiveContext(config: CompetitiveProfileConfig): boolean {
  const baseComplete = Boolean(
    config.platform.trim() &&
    config.currentSeasonKey.trim() &&
    config.previousSeasonKey.trim() &&
    config.rankOrder.length > 0 &&
    config.rankOrder.every((rank) => rank.trim().length > 0),
  );
  if (!baseComplete) return false;
  const policy = config.evidencePolicy;
  const policyComplete = !policy || Boolean(
    policy.historicalWeight === 50 &&
    policy.referenceSeasonWeight === 20 &&
    policy.recentSeasonWeight === 30 &&
    policy.referenceSeasonKey.trim() &&
    policy.recentSeasonKeys.length > 0 &&
    policy.recentSeasonKeys.every((key) => key.trim()),
  );
  const requiredFallbackSeasonKeys = [...new Set([
    config.currentSeasonKey,
    policy?.referenceSeasonKey ?? config.previousSeasonKey,
    ...(policy?.recentSeasonKeys ?? [config.currentSeasonKey]),
  ])];
  const fallbackComplete = !config.fallbackConversion || Boolean(
    config.platform === "perfect_world" &&
    config.fallbackConversion.sourcePlatform === "fivee" &&
    config.fallbackConversion.version.trim() &&
    requiredFallbackSeasonKeys.every((primary) => config.fallbackConversion!.seasonKeyMap[primary]?.trim()) &&
    Object.entries(config.fallbackConversion.seasonKeyMap).every(([primary, source]) => primary.trim() && source.trim()) &&
    Object.keys(config.fallbackConversion.rankMap).length > 0 &&
    Object.entries(config.fallbackConversion.rankMap).every(([source, target]) => source.trim() && config.rankOrder.includes(target)),
  );
  return policyComplete && fallbackComplete;
}

export async function resolveCompetitiveContext(config: CompetitiveProfileConfig): Promise<CompetitiveProfileConfig | null> {
  return isCompleteCompetitiveContext(config) ? config : null;
}

/** Batched loader for every live fact a qualification decision may need. */
export async function loadParticipantQualificationFacts(
  userIds: readonly string[],
  options: { platform?: string; fallbackPlatform?: string; executor?: DatabaseExecutor } = {},
): Promise<Map<string, ParticipantQualificationFacts>> {
  const executor = options.executor ?? db;
  const facts = new Map<string, ParticipantQualificationFacts>();
  if (userIds.length === 0) return facts;
  const ids = [...new Set(userIds)];
  const platforms = [options.platform, options.fallbackPlatform].filter((item): item is string => Boolean(item));
  const rankFactsFilter = platforms.length > 0
    ? and(inArray(competitiveRankFacts.userId, ids), inArray(competitiveRankFacts.platform, platforms))
    : inArray(competitiveRankFacts.userId, ids);
  const userRows = await executor.select({ id: users.id, displayName: users.displayName, perfectName: users.perfectName, steamName: users.steamName, email: users.email, emailVerifiedAt: users.emailVerifiedAt, steam64: users.steam64, qq: users.qq })
    .from(users).where(inArray(users.id, ids));
  const verificationRows = await executor.select({ userId: educationVerifications.userId, id: educationVerifications.id, status: educationVerifications.status, academicStatus: educationVerifications.academicStatus, institutionCode: institutions.moeInstitutionCode, institutionName: institutions.name, submittedAt: educationVerifications.submittedAt })
    .from(educationVerifications).innerJoin(institutions, eq(educationVerifications.institutionId, institutions.id))
    .where(inArray(educationVerifications.userId, ids));
  const rankRows = await executor.select().from(competitiveRankFacts).where(rankFactsFilter);

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
        seasonPeaks.set(row.platformSeasonKey, { status: row.status, rank: row.rank, rating: row.rating === null ? null : Number(row.rating), sourcePlatform: row.platform, sourceSeasonKey: row.platformSeasonKey, sourceRank: row.rank ?? undefined });
      }
    }
    const fallbackHistorical = fallbackPlatformFacts.find((row) => row.kind === "historical_peak" && row.platformSeasonKey === null);
    const fallbackSeasonPeaks = new Map<string, QualificationSeasonPeak>();
    for (const row of fallbackPlatformFacts) if (row.kind === "season_peak" && row.platformSeasonKey !== null) fallbackSeasonPeaks.set(row.platformSeasonKey, { status: row.status, rank: row.rank, rating: row.rating === null ? null : Number(row.rating), sourcePlatform: row.platform, sourceSeasonKey: row.platformSeasonKey, sourceRank: row.rank ?? undefined });
    facts.set(user.id, {
      userId: user.id,
      displayName: user.displayName,
      perfectName: user.perfectName,
      steamName: user.steamName,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      steam64: user.steam64,
      qq: user.qq,
      approvedEducation: approvedEducation.has(user.id),
      educationHistory: historyByUser.get(user.id) ?? [],
      historicalPeak: historical?.rank && historical.rating !== null ? { rank: historical.rank, rating: Number(historical.rating), sourcePlatform: historical.platform, sourceSeasonKey: historical.achievedSeasonKey, sourceRank: historical.rank } : null,
      seasonPeaks,
      fallbackFacts: options.fallbackPlatform ? { historicalPeak: fallbackHistorical?.rank && fallbackHistorical.rating !== null ? { rank: fallbackHistorical.rank, rating: Number(fallbackHistorical.rating), sourcePlatform: fallbackHistorical.platform, sourceSeasonKey: fallbackHistorical.achievedSeasonKey, sourceRank: fallbackHistorical.rank } : null, seasonPeaks: fallbackSeasonPeaks } : undefined,
    });
  }
  return facts;
}

/** Pure evaluation of one participant's readiness from loaded facts. */
export function computeParticipantReadiness(
  fact: ParticipantQualificationFacts,
  context: CompetitiveProfileConfig | null,
): ParticipantReadiness {
  const strength = toPlayerStrengthInput(fact, context);
  const blockers = context
    ? [
      ...getParticipantIdentityBlockers(fact),
      ...(fact.approvedEducation ? [] : ["请完成并通过高校身份认证。"]),
      ...getCompetitiveProfileBlockers(fact, context),
    ]
    : getCompetitiveProfileBlockers(fact, null);
  return { ready: blockers.length === 0, blockers: [...new Set(blockers)], strength, educationApproved: fact.approvedEducation };
}

/** Batched readiness for a roster. Single-user helper delegates here with [userId]. */
export async function getParticipantReadinessBatch(
  userIds: readonly string[],
  config: CompetitiveProfileConfig,
): Promise<Map<string, ParticipantReadiness>> {
  const context = await resolveCompetitiveContext(config);
  // Rank facts are platform-scoped: a participant's facts on another platform
  // must never satisfy this event's frozen context.
  const facts = await loadParticipantQualificationFacts(userIds, { platform: context?.platform ?? config.platform, fallbackPlatform: context?.fallbackConversion?.sourcePlatform });
  const result = new Map<string, ParticipantReadiness>();
  for (const userId of [...new Set(userIds)]) {
    const fact = facts.get(userId);
    if (!fact) {
      result.set(userId, { ready: false, blockers: ["选手账号不存在。"], strength: { userId, label: "选手", historicalPeak: null, previousSeasonPeak: null, currentSeasonPeak: null }, educationApproved: false });
      continue;
    }
    result.set(userId, computeParticipantReadiness({ ...fact, userId }, context));
  }
  return result;
}

export async function getParticipantReadiness(userId: string, config: CompetitiveProfileConfig): Promise<ParticipantReadiness> {
  const [readiness] = (await getParticipantReadinessBatch([userId], config)).values();
  return readiness ?? { ready: false, blockers: ["选手账号不存在。"], strength: { userId, label: "选手", historicalPeak: null, previousSeasonPeak: null, currentSeasonPeak: null }, educationApproved: false };
}

/** Batched education assertion loader usable inside open transactions. */
export async function loadEducationMembershipFacts(
  executor: DatabaseExecutor,
  userIds: readonly string[],
): Promise<Map<string, { email: string; emailVerifiedAt: Date | null; history: SeasonEducationVerification[] }>> {
  const result = new Map<string, { email: string; emailVerifiedAt: Date | null; history: SeasonEducationVerification[] }>();
  if (userIds.length === 0) return result;
  const rows = await executor.select({ userId: users.id, email: users.email, emailVerifiedAt: users.emailVerifiedAt, verificationId: educationVerifications.id, verificationStatus: educationVerifications.status, verificationAcademicStatus: educationVerifications.academicStatus, institutionCode: institutions.moeInstitutionCode, institutionName: institutions.name, verificationSubmittedAt: educationVerifications.submittedAt })
    .from(users)
    .leftJoin(educationVerifications, eq(educationVerifications.userId, users.id))
    .leftJoin(institutions, eq(educationVerifications.institutionId, institutions.id))
    .where(inArray(users.id, [...new Set(userIds)]));
  for (const row of rows) {
    const current = result.get(row.userId) ?? { email: row.email, emailVerifiedAt: row.emailVerifiedAt, history: [] };
    if (row.verificationId && row.verificationStatus && row.verificationAcademicStatus && row.institutionName) {
      current.history.push({ id: row.verificationId, status: row.verificationStatus, academicStatus: row.verificationAcademicStatus, institutionCode: row.institutionCode, institutionName: row.institutionName, submittedAt: row.verificationSubmittedAt });
    }
    result.set(row.userId, current);
  }
  return result;
}

export interface RosterQualificationMember {
  userId: string;
  email: string;
  emailVerifiedAt: Date | null;
  educationHistory: SeasonEducationVerification[];
  /** Whether this member counts as an institutional ("home") member. */
  isHome?: boolean;
}

export interface RosterQualificationResult {
  eligible: boolean;
  blockers: string[];
  education: EducationEligibilityResult;
  readinessByUser: Map<string, ParticipantReadiness>;
}

function memberIsHomeFromFacts(
  fact: ParticipantQualificationFacts,
  affiliationRules: readonly InstitutionAffiliationRule[],
): boolean {
  const selected = resolveSeasonEducationVerification(fact.educationHistory, affiliationRules).selectedVerification;
  return isHomeAffiliatedMember(
    { institutionCode: selected?.institutionCode ?? null, academicStatus: selected?.academicStatus ?? null },
    affiliationRules,
  );
}

/**
 * Pure roster qualification decision over facts the caller already loaded.
 * Freeze-time callers (Major start) must pass the same facts map they
 * serialize into the frozen snapshot, so validation and freezing can never
 * observe two different database reads.
 */
export async function evaluateRosterQualificationFromFacts(input: {
  members: readonly RosterQualificationMember[];
  /** Preloaded live facts keyed by userId; a missing member fails closed. */
  facts: ReadonlyMap<string, ParticipantQualificationFacts>;
  affiliationRules: readonly InstitutionAffiliationRule[];
  /** Frozen event context; omit when the event does not require a competitive profile. */
  competitiveProfile?: CompetitiveProfileConfig | null;
  primaryStarterUserIds?: readonly string[];
}): Promise<RosterQualificationResult> {
  const { members, facts, affiliationRules, competitiveProfile, primaryStarterUserIds } = input;
  const blockers: string[] = [];
  const education = evaluateRosterEducationEligibility(
    members.map((member) => ({
      userId: member.userId,
      email: member.email,
      emailVerifiedAt: member.emailVerifiedAt,
      verificationHistory: member.educationHistory,
    })),
    affiliationRules,
  );
  if (affiliationRules.length > 0) blockers.push(...education.blockers);

  const readinessByUser = new Map<string, ParticipantReadiness>();
  const context = competitiveProfile && isCompleteCompetitiveContext(competitiveProfile)
    ? competitiveProfile
    : null;
  if (competitiveProfile && !context) {
    blockers.push("竞技平台赛季目录尚未完成当前与上一赛季配置。");
  }
  if (context) {
    for (const member of members) {
      const fact = facts.get(member.userId);
      const readiness = fact
        ? computeParticipantReadiness({ ...fact, userId: member.userId }, context)
        : { ready: false, blockers: ["选手账号不存在。"], strength: { userId: member.userId, label: "选手", historicalPeak: null, previousSeasonPeak: null, currentSeasonPeak: null }, educationApproved: false };
      readinessByUser.set(member.userId, readiness);
      if (!readiness.ready) blockers.push(...readiness.blockers);
    }
    if (primaryStarterUserIds) {
      const primary = primaryStarterUserIds
        .map((userId) => {
          const member = members.find((item) => item.userId === userId);
          const readiness = readinessByUser.get(userId);
          if (!member || !readiness) return null;
          const isHome = member.isHome ?? (facts.get(userId) ? memberIsHomeFromFacts(facts.get(userId)!, affiliationRules) : false);
          return { ...readiness.strength, isHome };
        })
        .filter((item): item is PlayerStrengthInput & { isHome: boolean } => item !== null);
      const strength = evaluateExternalStrengthRule({ config: context, players: primary });
      if (!strength.eligible) blockers.push(...strength.blockers);
    }
  }

  return { eligible: blockers.length === 0, blockers, education, readinessByUser };
}

/**
 * Full roster qualification decision: roster education eligibility (pure) plus
 * batched live readiness and the external-strength rule when the event freezes
 * a competitive profile context.
 */
export async function evaluateRosterQualification(input: {
  members: readonly RosterQualificationMember[];
  affiliationRules: readonly InstitutionAffiliationRule[];
  /** Frozen event context; omit when the event does not require a competitive profile. */
  competitiveProfile?: CompetitiveProfileConfig | null;
  primaryStarterUserIds?: readonly string[];
}): Promise<RosterQualificationResult> {
  const { members, competitiveProfile } = input;
  const resolvedCompetitiveProfile = competitiveProfile
    ? await resolveCompetitiveContext(competitiveProfile)
    : null;
  const facts = competitiveProfile
    ? await loadParticipantQualificationFacts(members.map((member) => member.userId), {
        platform: resolvedCompetitiveProfile?.platform ?? competitiveProfile.platform,
        fallbackPlatform: resolvedCompetitiveProfile?.fallbackConversion?.sourcePlatform,
      })
    : new Map<string, ParticipantQualificationFacts>();
  return evaluateRosterQualificationFromFacts({
    ...input,
    competitiveProfile: resolvedCompetitiveProfile ?? competitiveProfile,
    facts,
  });
}

/** Home-member test shared by application submit and admin review flows. */
export function isHomeAffiliatedMember(
  member: { institutionCode: string | null; academicStatus: string | null },
  affiliationRules: readonly InstitutionAffiliationRule[],
): boolean {
  return Boolean(
    member.institutionCode &&
    member.academicStatus &&
    affiliationRules.some((rule) => rule.institutionCode === member.institutionCode && rule.eligibleAcademicStatuses.includes(member.academicStatus as "enrolled" | "graduated")),
  );
}

// Re-exported for the resolveSeasonEducationVerification consumers that build
// member histories before calling evaluateRosterQualification.
export { resolveSeasonEducationVerification };
