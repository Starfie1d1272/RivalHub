import { BUILT_IN_COMPETITIVE_PLATFORMS, isBuiltInCompetitivePlatformKey } from "@/lib/competitive/builtins";
import { evaluateExternalStrengthRule, getPlayerStrengthFindings, type PlayerStrengthInput } from "@/lib/major/player-strength";
import {
  blockersFromQualificationFindings,
  uniqueQualificationFindings,
  type QualificationFinding,
} from "@/lib/qualification/finding";
import {
  evaluateRosterEducationEligibility,
  resolveSeasonEducationVerification,
  type EducationEligibilityResult,
  type SeasonEducationVerification,
} from "@/lib/education/eligibility";
import type { CompetitiveProfileConfig, InstitutionAffiliationRule } from "@/types/season";
import type { DecodedSeasonRules, EvaluateParticipant, ParticipantCandidate, QualificationDecision } from "@/lib/seasons/rules";

/**
 * Single orchestration owner for participant qualification.
 *
 * Live qualification facts (profile completeness, approved education, platform
 * rank facts) are loaded in batched queries and evaluated by the existing pure
 * evaluators. Event lifecycle stays: registration/application read live facts,
 * prestart freezes, matches read frozen facts.
 */

import { createCompetitiveCandidateResolver, toPlayerStrengthInput } from "@/lib/qualification/evidence";
export { toPlayerStrengthInput } from "@/lib/qualification/evidence";
import { loadParticipantQualificationFacts } from "@/lib/qualification/facts";
import type { ParticipantQualificationFacts, QualificationPeak, QualificationSeasonPeak } from "@/lib/qualification/facts";
export { loadParticipantQualificationFacts, loadParticipantQualificationRawBundle, projectParticipantQualificationFacts } from "@/lib/qualification/facts";
export type { DatabaseExecutor, ParticipantQualificationFacts, ParticipantQualificationRawBundle } from "@/lib/qualification/facts";

type SelectableCompetitivePeak = QualificationPeak | QualificationSeasonPeak;

type CompetitiveEvidenceSlot = {
  label: string;
  targetKey: string;
  primary: SelectableCompetitivePeak | null | undefined;
  fallback: SelectableCompetitivePeak | null | undefined;
};

function qualificationPlatformLabel(platform: string): string {
  if (platform === "perfect_world") return "完美平台";
  if (platform === "fivee") return "5E";
  return "竞技平台";
}

function qualificationSeasonLabel(seasonKey: string, fallback = "指定赛季"): string {
  const yearSeason = /^(\d{4})s(\d+)$/i.exec(seasonKey);
  if (yearSeason) return `${yearSeason[1]} S${yearSeason[2]}`;
  if (/^s\d+$/i.test(seasonKey)) return seasonKey.toUpperCase();
  const prefixedSeason = /^(?:5e[-_])(s\d+)$/i.exec(seasonKey);
  if (prefixedSeason) return prefixedSeason[1]!.toUpperCase();
  return fallback;
}

export type ParticipantEducationReadiness = "ready" | "pending_review" | "rejected" | "missing";

export interface ParticipantReadiness {
  ready: boolean;
  blockers: string[];
  findings: QualificationFinding[];
  strength: PlayerStrengthInput;
  educationApproved: boolean;
  educationState: ParticipantEducationReadiness;
}

/** Canonical long-term identity requirements shared by settings and read models. */
export function getParticipantIdentityFindings(fact: ParticipantQualificationFacts): QualificationFinding[] {
  const findings: QualificationFinding[] = [];
  if (!fact.displayName?.trim()) findings.push({ code: "identity_incomplete", message: "请填写展示昵称。", waivable: false, metadata: { field: "display_name" } });
  if (!fact.steam64?.trim()) findings.push({ code: "identity_incomplete", message: "请填写 Steam64 ID。", waivable: false, metadata: { field: "steam64" } });
  if (!fact.perfectName?.trim()) findings.push({ code: "identity_incomplete", message: "请填写完美平台昵称。", waivable: false, metadata: { field: "perfect_name" } });
  if (!fact.qq?.trim()) findings.push({ code: "identity_incomplete", message: "请填写 QQ 号。", waivable: false, metadata: { field: "qq" } });
  if (!fact.emailVerifiedAt) findings.push({ code: "identity_incomplete", message: "请先验证邮箱。", waivable: false, metadata: { field: "email_verified_at" } });
  return findings;
}

export function getParticipantIdentityBlockers(fact: ParticipantQualificationFacts): string[] {
  return blockersFromQualificationFindings(getParticipantIdentityFindings(fact));
}

/** Star-rank facts remain nullable in storage for migration compatibility, but
 * a declared fact used by a live qualification context is incomplete until its
 * exact stars are supplied by the participant. */
function getMissingStarFindings(
  fact: ParticipantQualificationFacts,
  context: CompetitiveProfileConfig,
): QualificationFinding[] {
  const fallbackPlatform = context.fallbackConversion?.sourcePlatform;
  const policy = context.evidencePolicy;
  const sourceSelection = policy?.sourceSelection ?? "primary_then_fallback";
  const resolve = createCompetitiveCandidateResolver(context);
  const fallbackFor = (seasonKey: string) => {
    const sourceSeasonKey = context.fallbackConversion?.seasonKeyMap[seasonKey];
    return sourceSeasonKey ? fact.fallbackFacts?.seasonPeaks.get(sourceSeasonKey) : undefined;
  };
  const slots: CompetitiveEvidenceSlot[] = [
    { label: "历史最高", targetKey: "historical", primary: fact.historicalPeak, fallback: fact.fallbackFacts?.historicalPeak },
  ];
  const referenceSeasonKey = policy?.referenceSeasonKey ?? context.previousSeasonKey;
  slots.push({
    label: policy ? `前一完整赛季 · ${referenceSeasonKey}` : `上一赛季 · ${referenceSeasonKey}`,
    targetKey: referenceSeasonKey,
    primary: fact.seasonPeaks?.get(referenceSeasonKey),
    fallback: fallbackFor(referenceSeasonKey),
  });
  const recentSeasonKeys = policy?.recentSeasonKeys ?? [context.currentSeasonKey];
  for (const seasonKey of recentSeasonKeys) {
    slots.push({
      label: policy ? `近期赛季 · ${qualificationSeasonLabel(seasonKey)}` : `当前赛季 · ${qualificationSeasonLabel(seasonKey)}`,
      targetKey: seasonKey,
      primary: fact.seasonPeaks?.get(seasonKey),
      fallback: fallbackFor(seasonKey),
    });
  }

  const definitionsByPlatform = new Map<string, Map<string, { label: string; starMin: number | null }>>();
  if (isBuiltInCompetitivePlatformKey(context.platform)) {
    definitionsByPlatform.set(context.platform, new Map(
      BUILT_IN_COMPETITIVE_PLATFORMS[context.platform].ranks.map((rank) => [rank.rankKey, { label: rank.label, starMin: rank.starMin }]),
    ));
  }
  if (fallbackPlatform && isBuiltInCompetitivePlatformKey(fallbackPlatform)) {
    definitionsByPlatform.set(fallbackPlatform, new Map(
      BUILT_IN_COMPETITIVE_PLATFORMS[fallbackPlatform].ranks.map((rank) => [rank.rankKey, { label: rank.label, starMin: rank.starMin }]),
    ));
  }

  const findings: QualificationFinding[] = [];
  const missingStarsFor = (
    peak: SelectableCompetitivePeak | null | undefined,
    platform: string | undefined,
  ): { label: string; rankKey: string } | null => {
    if (!peak?.rank || !platform) return null;
    const rank = definitionsByPlatform.get(platform)?.get(peak.rank);
    if (!rank || rank.starMin === null || rank.starMin === undefined || (peak.stars !== null && peak.stars !== undefined)) return null;
    return { label: rank.label, rankKey: peak.rank };
  };
  for (const slot of slots) {
    const selected = resolve(slot.primary, slot.fallback);
    const primaryMissing = missingStarsFor(slot.primary, context.platform);
    const fallbackMissing = missingStarsFor(slot.fallback, fallbackPlatform);
    const primaryHasPriorityInLegacy = slot.primary?.status !== "unranked" && Boolean(
      slot.primary?.rank && slot.primary.rating !== null && slot.primary.rating !== undefined,
    );
    const selectedFallback = Boolean(fallbackPlatform && selected?.sourcePlatform === fallbackPlatform);
    const report = sourceSelection === "strongest_equivalent"
      ? fallbackMissing ?? (primaryMissing && !selectedFallback ? primaryMissing : null)
      : primaryHasPriorityInLegacy ? primaryMissing : fallbackMissing;
    if (report) {
      const reportUsesFallback = report === fallbackMissing;
      const sourcePeak = reportUsesFallback ? slot.fallback : slot.primary;
      findings.push({
        code: "competitive_profile_incomplete",
        message: `${slot.label}的 ${report.label} 段位需要填写准确星数，竞技资料未填写完整。`,
        waivable: false,
        metadata: {
          field: "stars",
          slot: slot.label,
          platform: reportUsesFallback ? fallbackPlatform ?? context.platform : context.platform,
          seasonKey: slot.targetKey === "historical" ? "historical" : sourcePeak?.sourceSeasonKey ?? slot.targetKey,
          rankKey: report.rankKey,
          rankLabel: report.label,
        },
      });
    }
  }
  return findings;
}

/** Canonical competitive-profile findings for one frozen or catalog context. */
function getCompetitiveProfileFindings(
  fact: ParticipantQualificationFacts,
  context: CompetitiveProfileConfig | null,
): QualificationFinding[] {
  if (!context) return [{ code: "competitive_context_unavailable", message: "本届赛事的竞技资料要求暂时无法确认，请联系赛事管理员。", waivable: false, metadata: { field: "competitive_context" } }];
  const strength = toPlayerStrengthInput(fact, context);
  const strengthFindings = getPlayerStrengthFindings(strength, context).map((finding) => {
    if (finding.code !== "competitive_profile_incomplete") return finding;
    const field = finding.metadata?.field;
    if (field === "reference_season_peak") {
      const seasonKey = context.evidencePolicy?.referenceSeasonKey ?? context.previousSeasonKey;
      return {
        ...finding,
        message: context.evidencePolicy
          ? `缺少${qualificationPlatformLabel(context.platform)} ${qualificationSeasonLabel(context.evidencePolicy.referenceSeasonKey, "前一完整赛季")}的最高段位和 Rating。`
          : `缺少${qualificationPlatformLabel(context.platform)} ${qualificationSeasonLabel(context.previousSeasonKey, "上一赛季")}的最高段位和 Rating。`,
        metadata: { ...finding.metadata, platform: context.platform, seasonKey },
      };
    }
    if (field === "recent_season_peak") {
      const seasonKeys = context.evidencePolicy?.recentSeasonKeys ?? [context.currentSeasonKey];
      const seasonKey = seasonKeys.find((key) => !fact.seasonPeaks?.has(key)) ?? seasonKeys[0] ?? context.currentSeasonKey;
      return {
        ...finding,
        message: context.evidencePolicy
          ? `请补充${qualificationPlatformLabel(context.platform)} ${[...new Set(context.evidencePolicy.recentSeasonKeys.map((key) => qualificationSeasonLabel(key, "近期赛季")))].join(" / ")}中至少一个赛季的最高段位和 Rating。`
          : `缺少${qualificationPlatformLabel(context.platform)} ${qualificationSeasonLabel(context.currentSeasonKey, "当前赛季")}的最高段位和 Rating。`,
        metadata: { ...finding.metadata, platform: context.platform, seasonKey },
      };
    }
    if (field === "historical_peak") {
      return { ...finding, metadata: { ...finding.metadata, platform: context.platform, seasonKey: "historical" } };
    }
    return finding;
  });
  return uniqueQualificationFindings([
    ...getMissingStarFindings(fact, context),
    ...strengthFindings,
  ]);
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
    policy.recentSeasonKeys.every((key) => key.trim()) &&
    (policy.sourceSelection === undefined || policy.sourceSelection === "primary_then_fallback" || policy.sourceSelection === "strongest_equivalent"),
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
    (
      (
        config.fallbackConversion.mapping &&
        Object.keys(config.fallbackConversion.mapping.belowSRankMap).length > 0 &&
        config.fallbackConversion.mapping.starSegments.length > 0 &&
        config.fallbackConversion.mapping.starSegments.every((segment) => config.rankOrder.includes(segment.targetRank))
      ) ||
      (
        config.fallbackConversion.rankMap &&
        Object.keys(config.fallbackConversion.rankMap).length > 0 &&
        Object.values(config.fallbackConversion.rankMap).every((rank) => config.rankOrder.includes(rank))
      )
    ),
  );
  return policyComplete && fallbackComplete;
}

export async function resolveCompetitiveContext(config: CompetitiveProfileConfig): Promise<CompetitiveProfileConfig | null> {
  return isCompleteCompetitiveContext(config) ? config : null;
}

function resolveParticipantEducationReadiness(fact: ParticipantQualificationFacts): ParticipantEducationReadiness {
  if (fact.approvedEducation) return "ready";
  if (fact.educationHistory.some((entry) => entry.status === "pending")) return "pending_review";
  const latest = [...fact.educationHistory].sort(
    (left, right) => (right.submittedAt?.getTime() ?? 0) - (left.submittedAt?.getTime() ?? 0),
  )[0];
  return latest?.status === "rejected" ? "rejected" : "missing";
}

function educationReadinessFinding(state: Exclude<ParticipantEducationReadiness, "ready">): QualificationFinding {
  const message = state === "pending_review"
    ? "高校身份认证审核中 · 等待赛委会"
    : state === "rejected"
      ? "需要本人处理 · 高校身份认证已驳回"
      : "需要本人补充 · 高校身份认证";
  return { code: "education_incomplete", message, waivable: false, metadata: { field: "approved_education", state } };
}

/** Evaluate independent participant requirements. Team affiliation counts and
 * relative strength are evaluated against the complete roster separately. */
export function computePolicyParticipantReadiness(
  fact: ParticipantQualificationFacts,
  policy: import("@/types/season").QualificationPolicyV1,
): ParticipantReadiness {
  const context = policy.competitiveProfileRequired ? policy.competitiveProfile : null;
  const educationState = resolveParticipantEducationReadiness(fact);
  const identity = getParticipantIdentityFindings(fact).filter((finding) => {
    const field = finding.metadata?.field;
    if (field === "qq") return policy.contacts.qqRequired;
    if (field === "email_verified_at") return policy.contacts.emailVerifiedRequired;
    if (field === "perfect_name") return context?.platform === "perfect_world";
    return true;
  });
  const findings = uniqueQualificationFindings([
    ...identity,
    ...(policy.educationRequired && educationState !== "ready" ? [educationReadinessFinding(educationState)] : []),
    ...(policy.competitiveProfileRequired ? getCompetitiveProfileFindings(fact, context) : []),
  ]);
  return {
    ready: findings.length === 0,
    blockers: blockersFromQualificationFindings(findings),
    findings,
    strength: toPlayerStrengthInput(fact, context),
    educationApproved: fact.approvedEducation,
    educationState,
  };
}

/** Pure participant decision over the evidence supplied by the event. */
export const evaluateParticipant: EvaluateParticipant = (candidate, rules, evidence) => {
  const fact = candidate.facts;
  const findings = getParticipantIdentityFindings(fact).filter((finding) => {
    const field = finding.metadata?.field;
    if (field === "qq") return rules.contacts.qqRequired;
    if (field === "email_verified_at") return rules.contacts.emailVerifiedRequired;
    if (field === "perfect_name") return Boolean(rules.legacySolo);
    return true;
  });
  const educationState = resolveParticipantEducationReadiness(fact);
  if (rules.educationRequired && educationState !== "ready") findings.push(educationReadinessFinding(educationState));
  if (rules.allowedPlayerTypes && (!candidate.playerType || !rules.allowedPlayerTypes.includes(candidate.playerType))) {
    findings.push({ code: "player_type_ineligible", message: "所选身份类型不符合赛事报名要求。", waivable: false, metadata: { field: "player_type" } });
  }
  const threshold = rules.rankThreshold;
  const hasThreshold = Boolean(threshold && (threshold.currentMin !== null || threshold.peakMin !== null));
  if (rules.competitiveProfileRequired || hasThreshold) {
    const player = evidence.kind === "competitive" ? evidence.byUser.get(candidate.userId) : undefined;
    const profile = evidence.kind === "competitive" ? evidence.context.profile : null;
    if (!player || !profile || !isCompleteCompetitiveContext(profile)) {
      findings.push({ code: "competitive_context_unavailable", message: "本届赛事的竞技资料要求暂时无法确认，请联系赛事管理员。", waivable: false, metadata: { field: "competitive_context" } });
    } else {
      if (rules.competitiveProfileRequired) {
        findings.push(...getCompetitiveProfileFindings(fact, profile));
      }
      if (threshold && hasThreshold) {
        const meets = (rank: string | undefined, minimum: string | null) => {
          if (!rank || !minimum) return false;
          const value = profile.rankOrder.indexOf(rank);
          const required = profile.rankOrder.indexOf(minimum);
          return value >= 0 && required >= 0 && value >= required;
        };
        if (!meets(player.seasons.get(profile.currentSeasonKey)?.rank, threshold.currentMin) && !meets(player.historicalPeak?.rank, threshold.peakMin)) {
          findings.push({ code: "rank_threshold", message: "未达到赛事段位门槛，请检查竞技资料。", waivable: false, metadata: { field: "rank_threshold" } });
        }
      }
    }
  }
  const result = uniqueQualificationFindings(findings);
  return result.length ? { state: "blocked", findings: result as [QualificationFinding, ...QualificationFinding[]] } : { state: "ready", findings: [] };
};

/** Evaluate a participant independently of roster and lineup decisions. */
export function evaluateSeasonParticipant(candidate: ParticipantCandidate, rules: DecodedSeasonRules): QualificationDecision {
  const { participant, competitive } = rules;
  const readiness = computePolicyParticipantReadiness(candidate.facts, {
    version: 1,
    educationRequired: participant.educationRequired,
    contacts: participant.contacts,
    competitiveProfileRequired: participant.competitiveProfileRequired,
    competitiveProfile: competitive.competitiveProfile,
    externalStrengthGap: competitive.externalStrengthGap,
    affiliationRules: [],
  });
  const findings = readiness.findings.filter((finding) => finding.metadata?.field !== "perfect_name");
  if (participant.allowedPlayerTypes && (!candidate.playerType || !participant.allowedPlayerTypes.includes(candidate.playerType))) {
    findings.push({ code: "player_type_ineligible", message: "所选身份类型不符合赛事报名要求。", waivable: false, metadata: { field: "player_type" } });
  }
  const threshold = participant.rankThreshold;
  if (threshold && (threshold.currentMin !== null || threshold.peakMin !== null)) {
    const context = competitive.competitiveProfile;
    if (!context || !isCompleteCompetitiveContext(context)) {
      findings.push({ code: "competitive_context_unavailable", message: "赛事段位门槛所需的竞技赛季配置不可用，请联系赛事管理员。", waivable: false, metadata: { field: "competitive_context" } });
    } else {
      const strength = toPlayerStrengthInput(candidate.facts, context);
      const meets = (rank: string | undefined, minimum: string | null) => {
        if (!rank || !minimum) return false;
        const value = context.rankOrder.indexOf(rank);
        const required = context.rankOrder.indexOf(minimum);
        return value >= 0 && required >= 0 && value >= required;
      };
      if (!meets(strength.currentSeasonPeak?.rank, threshold.currentMin) && !meets(strength.historicalPeak?.rank, threshold.peakMin)) {
        findings.push({ code: "rank_threshold", message: "未达到赛事段位门槛，请检查竞技资料。", waivable: false, metadata: { field: "rank_threshold" } });
      }
    }
  }
  const result = uniqueQualificationFindings(findings);
  return result.length ? { state: "blocked", findings: result as [QualificationFinding, ...QualificationFinding[]] } : { state: "ready", findings: [] };
}

/** Load the same facts inside the caller's mutation transaction. */
export async function evaluateSeasonParticipantInTx(
  executor: import("@/lib/qualification/facts").DatabaseExecutor,
  userId: string,
  playerType: string,
  rules: DecodedSeasonRules,
): Promise<QualificationDecision> {
  const context = rules.competitive.competitiveProfile;
  const facts = await loadParticipantQualificationFacts([userId], {
    executor,
    platform: context?.platform,
    fallbackPlatform: context?.fallbackConversion?.sourcePlatform,
    includeCompetitiveFacts: rules.participant.competitiveProfileRequired || Boolean(rules.participant.rankThreshold?.currentMin || rules.participant.rankThreshold?.peakMin),
  });
  const fact = facts.get(userId);
  if (!fact) return { state: "blocked", findings: [{ code: "participant_missing", message: "选手账号不存在。", waivable: false, metadata: { field: "participant" } }] };
  const parsedType = playerType === "enrolled" || playerType === "graduated" || playerType === "external" ? playerType : null;
  return evaluateSeasonParticipant({ userId, facts: { ...fact, userId }, playerType: parsedType }, rules);
}

/** Pure legacy readiness evaluation from loaded facts. */
export function computeParticipantReadiness(
  fact: ParticipantQualificationFacts,
  context: CompetitiveProfileConfig | null,
): ParticipantReadiness {
  const strength = toPlayerStrengthInput(fact, context);
  const educationState = resolveParticipantEducationReadiness(fact);
  const findings = context
    ? [
      ...getParticipantIdentityFindings(fact),
      ...(educationState === "ready" ? [] : [educationReadinessFinding(educationState)]),
      ...getCompetitiveProfileFindings(fact, context),
    ]
    : getCompetitiveProfileFindings(fact, null);
  const uniqueFindings = uniqueQualificationFindings(findings);
  return {
    ready: uniqueFindings.length === 0,
    blockers: blockersFromQualificationFindings(uniqueFindings),
    findings: uniqueFindings,
    strength,
    educationApproved: fact.approvedEducation,
    educationState,
  };
}

/** Batched readiness for a roster. Single-user helper delegates here with [userId]. */
export async function getParticipantReadinessBatch(
  userIds: readonly string[],
  config: CompetitiveProfileConfig,
  options: { facts?: ReadonlyMap<string, ParticipantQualificationFacts> } = {},
): Promise<Map<string, ParticipantReadiness>> {
  const context = await resolveCompetitiveContext(config);
  // Rank facts are platform-scoped: a participant's facts on another platform
  // must never satisfy this event's frozen context.
  const facts = options.facts ?? await loadParticipantQualificationFacts(userIds, { platform: context?.platform ?? config.platform, fallbackPlatform: context?.fallbackConversion?.sourcePlatform });
  const result = new Map<string, ParticipantReadiness>();
  for (const userId of [...new Set(userIds)]) {
    const fact = facts.get(userId);
    if (!fact) {
      const findings: QualificationFinding[] = [{ code: "participant_missing", message: "选手账号不存在。", waivable: false, metadata: { field: "participant" } }];
      result.set(userId, { ready: false, blockers: blockersFromQualificationFindings(findings), findings, strength: { userId, label: "选手", historicalPeak: null, previousSeasonPeak: null, currentSeasonPeak: null }, educationApproved: false, educationState: "missing" });
      continue;
    }
    result.set(userId, computeParticipantReadiness({ ...fact, userId }, context));
  }
  return result;
}

export async function getParticipantReadiness(userId: string, config: CompetitiveProfileConfig): Promise<ParticipantReadiness> {
  const [readiness] = (await getParticipantReadinessBatch([userId], config)).values();
  if (readiness) return readiness;
  const findings: QualificationFinding[] = [{ code: "participant_missing", message: "选手账号不存在。", waivable: false, metadata: { field: "participant" } }];
  return { ready: false, blockers: blockersFromQualificationFindings(findings), findings, strength: { userId, label: "选手", historicalPeak: null, previousSeasonPeak: null, currentSeasonPeak: null }, educationApproved: false, educationState: "missing" };
}

export interface RosterQualificationMember {
  userId: string;
  label: string;
  emailVerifiedAt: Date | null;
  educationHistory: SeasonEducationVerification[];
  /** Whether this member counts as an institutional ("home") member. */
  isHome?: boolean;
}

export interface RosterQualificationResult {
  eligible: boolean;
  blockers: string[];
  findings: QualificationFinding[];
  education: EducationEligibilityResult;
  readinessByUser: Map<string, ParticipantReadiness>;
}

function memberIsHomeFromFacts(
  fact: ParticipantQualificationFacts,
  affiliationRules: readonly InstitutionAffiliationRule[],
  requireApproved = false,
): boolean {
  const selected = resolveSeasonEducationVerification(fact.educationHistory, affiliationRules).selectedVerification;
  if (requireApproved && selected?.status !== "approved") return false;
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
  policy?: import("@/types/season").QualificationPolicyV1;
}): Promise<RosterQualificationResult> {
  const { members, facts, competitiveProfile, primaryStarterUserIds, policy } = input;
  const affiliationRules = policy?.affiliationRules ?? input.affiliationRules;
  const findings: QualificationFinding[] = [];
  const education = evaluateRosterEducationEligibility(
    members.map((member) => ({
      userId: member.userId,
      label: member.label,
      emailVerifiedAt: member.emailVerifiedAt,
      verificationHistory: member.educationHistory,
    })),
    affiliationRules,
    policy ? { requireMemberEducation: policy.educationRequired, requireVerifiedEmail: false, requireApprovedAffiliation: true } : undefined,
  );
  if (affiliationRules.length > 0 || policy?.educationRequired) {
    findings.push(...education.blockers.map((message) => ({
      code: "education_incomplete",
      message,
      waivable: false,
      metadata: { field: "affiliation" },
    })));
  }

  const readinessByUser = new Map<string, ParticipantReadiness>();
  const context = competitiveProfile && isCompleteCompetitiveContext(competitiveProfile)
    ? competitiveProfile
    : null;
  if (competitiveProfile && !context) {
    findings.push({ code: "competitive_context_unavailable", message: "竞技平台赛季目录尚未完成当前与上一赛季配置。", waivable: false, metadata: { field: "competitive_context" } });
  }
  if (context || policy) {
    for (const member of members) {
      const fact = facts.get(member.userId);
      const readiness = fact
        ? policy ? computePolicyParticipantReadiness({ ...fact, userId: member.userId }, { ...policy, competitiveProfile: context }) : computeParticipantReadiness({ ...fact, userId: member.userId }, context)
        : { ready: false, blockers: ["选手账号不存在。"], findings: [{ code: "participant_missing", message: "选手账号不存在。", waivable: false, metadata: { field: "participant" } }], strength: { userId: member.userId, label: "选手", historicalPeak: null, previousSeasonPeak: null, currentSeasonPeak: null }, educationApproved: false, educationState: "missing" as const };
      readinessByUser.set(member.userId, readiness);
      findings.push(...readiness.findings);
    }
    if (primaryStarterUserIds && context && (!policy || policy.externalStrengthGap.enabled)) {
      const primary = primaryStarterUserIds
        .map((userId) => {
          const member = members.find((item) => item.userId === userId);
          const readiness = readinessByUser.get(userId);
          if (!member || !readiness) return null;
          const fact = facts.get(userId);
          const isHome = policy
            ? Boolean(fact && memberIsHomeFromFacts(fact, affiliationRules, true))
            : member.isHome ?? Boolean(fact && memberIsHomeFromFacts(fact, affiliationRules));
          const strength = policy && fact ? toPlayerStrengthInput(fact, context) : readiness.strength;
          return { ...strength, isHome };
        })
        .filter((item): item is PlayerStrengthInput & { isHome: boolean } => item !== null);
      const strength = evaluateExternalStrengthRule({ config: policy ? { ...context, externalStrengthMaxStarGap: policy.externalStrengthGap.maxGap } : context, players: primary });
      findings.push(...strength.findings);
    }
  }

  const uniqueFindings = uniqueQualificationFindings(findings);
  return { eligible: uniqueFindings.length === 0, blockers: blockersFromQualificationFindings(uniqueFindings), findings: uniqueFindings, education, readinessByUser };
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

// Re-exported for consumers that build member histories before calling the
// facts-based roster evaluator.
export { resolveSeasonEducationVerification };
export type { QualificationFinding } from "@/lib/qualification/finding";
