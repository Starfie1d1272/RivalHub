import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { competitiveRankFacts, educationVerifications, institutions, users } from "@/db/schema";
import { resolveLiveCompetitiveContext, toCompetitiveProfileConfig } from "@/lib/competitive/catalog";
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
  perfectId: string | null;
  qq: string | null;
  approvedEducation: boolean;
  educationHistory: SeasonEducationVerification[];
  historicalPeak: { rank: string; rating: number } | null;
  /** Season peaks keyed by catalogued platform season key. */
  seasonPeaks?: Map<string, { rank: string; rating: number }>;
}

export interface ParticipantReadiness {
  ready: boolean;
  blockers: string[];
  strength: PlayerStrengthInput;
  educationApproved: boolean;
}

/**
 * Event qualification context resolution. A fully frozen event context is used
 * as-is; an incomplete context (legacy row) is resolved live from the
 * platform catalog. No hardcoded rank fallback exists — an incomplete
 * catalog yields null and callers fail closed.
 */
export async function resolveCompetitiveContext(config: CompetitiveProfileConfig): Promise<CompetitiveProfileConfig | null> {
  if (config.currentSeasonKey && config.previousSeasonKey && config.rankOrder.length > 0) return config;
  const context = await resolveLiveCompetitiveContext(db, config.platform);
  return context ? toCompetitiveProfileConfig(context) : null;
}

/** Batched loader for every live fact a qualification decision may need. */
export async function loadParticipantQualificationFacts(
  userIds: readonly string[],
  options: { platform?: string; executor?: DatabaseExecutor } = {},
): Promise<Map<string, ParticipantQualificationFacts>> {
  const executor = options.executor ?? db;
  const facts = new Map<string, ParticipantQualificationFacts>();
  if (userIds.length === 0) return facts;
  const ids = [...new Set(userIds)];
  const rankFactsFilter = options.platform
    ? and(inArray(competitiveRankFacts.userId, ids), eq(competitiveRankFacts.platform, options.platform))
    : inArray(competitiveRankFacts.userId, ids);
  const [userRows, verificationRows, rankRows] = await Promise.all([
    executor.select({ id: users.id, displayName: users.displayName, perfectName: users.perfectName, steamName: users.steamName, email: users.email, emailVerifiedAt: users.emailVerifiedAt, steam64: users.steam64, perfectId: users.perfectId, qq: users.qq })
      .from(users).where(inArray(users.id, ids)),
    executor.select({ userId: educationVerifications.userId, id: educationVerifications.id, status: educationVerifications.status, academicStatus: educationVerifications.academicStatus, institutionCode: institutions.moeInstitutionCode, institutionName: institutions.name, submittedAt: educationVerifications.submittedAt })
      .from(educationVerifications).innerJoin(institutions, eq(educationVerifications.institutionId, institutions.id))
      .where(inArray(educationVerifications.userId, ids)),
    executor.select().from(competitiveRankFacts).where(rankFactsFilter),
  ]);

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
    const platformFacts = rankRows.filter((row) => row.userId === user.id);
    const historical = platformFacts.find((row) => row.kind === "historical_peak" && row.platformSeasonKey === null);
    const seasonPeaks = new Map<string, { rank: string; rating: number }>();
    for (const row of platformFacts) {
      if (row.kind === "season_peak" && row.platformSeasonKey !== null) {
        seasonPeaks.set(row.platformSeasonKey, { rank: row.rank, rating: Number(row.rating) });
      }
    }
    facts.set(user.id, {
      userId: user.id,
      displayName: user.displayName,
      perfectName: user.perfectName,
      steamName: user.steamName,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      steam64: user.steam64,
      perfectId: user.perfectId,
      qq: user.qq,
      approvedEducation: approvedEducation.has(user.id),
      educationHistory: historyByUser.get(user.id) ?? [],
      historicalPeak: historical ? { rank: historical.rank, rating: Number(historical.rating) } : null,
      seasonPeaks,
    });
  }
  return facts;
}

/** Pure evaluation of one participant's readiness from loaded facts. */
export function computeParticipantReadiness(
  fact: ParticipantQualificationFacts,
  context: CompetitiveProfileConfig | null,
): ParticipantReadiness {
  const strength: PlayerStrengthInput = {
    userId: fact.userId ?? "",
    label: fact.displayName ?? fact.perfectName ?? fact.email ?? "未知选手",
    historicalPeak: fact.historicalPeak,
    previousSeasonPeak: fact.seasonPeaks?.get(context?.previousSeasonKey ?? "") ?? null,
    currentSeasonPeak: fact.seasonPeaks?.get(context?.currentSeasonKey ?? "") ?? null,
  };
  const blockers: string[] = [];
  if (!context) {
    blockers.push("竞技平台赛季目录尚未完成当前与上一赛季配置。");
  } else {
    if (!fact.displayName?.trim()) blockers.push("请填写展示昵称。");
    if (!fact.steam64?.trim()) blockers.push("请填写 Steam64 ID。");
    if (!fact.perfectId?.trim()) blockers.push("请填写完美世界竞技平台 ID。");
    if (!fact.qq?.trim()) blockers.push("请填写 QQ 号。");
    if (!fact.emailVerifiedAt) blockers.push("请先验证邮箱。");
    if (!fact.approvedEducation) blockers.push("请完成并通过高校身份认证。");
    blockers.push(...getPlayerStrengthBreakdown(strength, context).blockers);
  }
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
  const facts = await loadParticipantQualificationFacts(userIds, { platform: context?.platform ?? config.platform });
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
  const { members, affiliationRules, competitiveProfile, primaryStarterUserIds } = input;
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

  let readinessByUser = new Map<string, ParticipantReadiness>();
  if (competitiveProfile) {
    readinessByUser = await getParticipantReadinessBatch(members.map((member) => member.userId), competitiveProfile);
    for (const member of members) {
      const readiness = readinessByUser.get(member.userId);
      if (!readiness?.ready) blockers.push(...(readiness?.blockers ?? ["选手资料不可确认。"]));
    }
    if (primaryStarterUserIds) {
      const primary = primaryStarterUserIds
        .map((userId) => {
          const member = members.find((item) => item.userId === userId);
          const readiness = readinessByUser.get(userId);
          return member && readiness ? { ...readiness.strength, isHome: member.isHome ?? false } : null;
        })
        .filter((item): item is PlayerStrengthInput & { isHome: boolean } => item !== null);
      const strength = evaluateExternalStrengthRule({ config: competitiveProfile, players: primary });
      if (!strength.eligible) blockers.push(...strength.blockers);
    }
  }

  return { eligible: blockers.length === 0, blockers, education, readinessByUser };
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
