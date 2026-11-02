import "server-only";

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { competitionQualificationRuns, eventRosterMembers, eventRosters, matchRosters, matches, type Season } from "@/db/schema";
import { loadActiveRestrictionOverridesInTx } from "@/lib/competition-entries/restriction-overrides";
import { AppError, ErrorCode } from "@/lib/errors";
import { freezeAffiliationRules } from "@/lib/major/frozen-affiliation-rules";
import type { PlayerStrengthInput } from "@/lib/major/player-strength";
import type { FrozenRestrictionOverrideSnapshot } from "@/lib/major/run-snapshot";
import type { ParticipantQualificationFacts } from "@/lib/qualification/facts";
import { loadParticipantQualificationFacts, resolveCompetitiveContext, toPlayerStrengthInput } from "@/lib/qualification/service";
import { normalizeTeamRegistrationConfig, resolveQualificationPolicy } from "@/lib/seasons/compatibility";
import type { CompetitiveProfileConfig, InstitutionAffiliationRule, QualificationPolicyV1 } from "@/types/season";

export interface QualificationEligibilityPolicy {
  version: 1;
  affiliationRules: readonly InstitutionAffiliationRule[];
  competitiveProfile: CompetitiveProfileConfig | null;
  starterCount: number;
  maxSubstitutes: number;
  externalStrengthGapEnabled: boolean;
  qualificationPolicy?: QualificationPolicyV1;
}

export interface QualificationRosterEligibility {
  version: 1;
  entryId: string;
  rosterRevisionId: string;
  policy: QualificationEligibilityPolicy;
  competitiveFacts: PlayerStrengthInput[];
  restrictionOverrides: FrozenRestrictionOverrideSnapshot[];
}

export async function freezeQualificationPolicy(season: Season): Promise<QualificationEligibilityPolicy> {
  if (season.teamRegistrationConfig.qualificationPolicy?.version === 2) throw new AppError(ErrorCode.VALIDATION_FAILED, "本赛事使用新版资格规则，尚不能用旧版快照锁定。");
  const config = normalizeTeamRegistrationConfig(season.teamRegistrationConfig);
  const definition = config.qualificationPolicy;
  const resolved = resolveQualificationPolicy(season.teamRegistrationConfig, season.affiliationRules, "roster");
  const configured = definition ? (resolved.competitiveProfileRequired || resolved.externalStrengthGap.enabled ? resolved.competitiveProfile : null) : config.competitiveProfile;
  const competitiveProfile = configured ? await resolveCompetitiveContext(configured) : null;
  if ((definition ? resolved.competitiveProfileRequired || resolved.externalStrengthGap.enabled : config.requireCompetitiveProfile) && !competitiveProfile) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "本届资格赛缺少有效竞技规则，不能锁定配置。");
  }
  return {
    version: 1,
    affiliationRules: freezeAffiliationRules(resolved.affiliationRules),
    competitiveProfile,
    starterCount: season.starterCount,
    maxSubstitutes: 2,
    externalStrengthGapEnabled: definition ? resolved.externalStrengthGap.enabled : competitiveProfile !== null,
    ...(definition ? { qualificationPolicy: { ...definition, competitiveProfile } } : {}),
  };
}

/** Explicit approved-roster synchronization freezes facts once per adopted revision. */
export async function freezeQualificationRosterInTx(tx: TxDb, input: {
  season: Season; entryId: string; rosterRevisionId: string; eventRosterId: string;
  participantFacts?: ReadonlyMap<string, ParticipantQualificationFacts>;
}): Promise<void> {
  const [run] = await tx.select({ policy: competitionQualificationRuns.eligibilityPolicy }).from(competitionQualificationRuns)
    .where(eq(competitionQualificationRuns.seasonId, input.season.id));
  if (!run) return; // Only Qualification owns this snapshot; Main Event has StageRun.
  const policy = run.policy;
  if (!policy || policy.version !== 1) throw new AppError(ErrorCode.VALIDATION_FAILED, "Play-in 缺少已锁定的资格规则，请在首轮生成前重置配置。");
  const [roster] = await tx.select({ snapshot: eventRosters.eligibilitySnapshot, revisionId: eventRosters.sourceRosterRevisionId }).from(eventRosters)
    .where(and(eq(eventRosters.id, input.eventRosterId), eq(eventRosters.entryId, input.entryId))).for("update");
  if (!roster || roster.revisionId !== input.rosterRevisionId) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "赛事名单与已批准名单版本不一致，不能锁定资格事实。");
  }
  if (roster?.snapshot?.rosterRevisionId === input.rosterRevisionId && roster.snapshot.entryId === input.entryId) return;
  if (roster?.snapshot) {
    const [used] = await tx.select({ id: matchRosters.id }).from(matchRosters)
      .innerJoin(matches, eq(matches.id, matchRosters.matchId))
      .where(and(eq(matchRosters.entryId, input.entryId), isNotNull(matches.qualificationRunId))).limit(1);
    if (used) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "赛事名单资格快照已用于比赛，不能覆盖。 ");
  }
  const snapshot = await buildRosterEligibilityInTx(tx, { ...input, policy });
  await tx.update(eventRosters).set({ eligibilitySnapshot: snapshot }).where(eq(eventRosters.id, input.eventRosterId));
}

/** Shared frozen roster facts for qualification and event rehearsals. */
export async function buildRosterEligibilityInTx(tx: TxDb, input: {
  season: Season; entryId: string; rosterRevisionId: string; eventRosterId: string; policy: QualificationEligibilityPolicy;
  /** Facts from the same transaction and competitive context as the roster assessment, when already loaded. */
  participantFacts?: ReadonlyMap<string, ParticipantQualificationFacts>;
}): Promise<QualificationRosterEligibility> {
  const { policy } = input;
  const members = await tx.select({ userId: eventRosterMembers.userId }).from(eventRosterMembers)
    .where(and(eq(eventRosterMembers.eventRosterId, input.eventRosterId), eq(eventRosterMembers.isCurrent, true)));
  const facts = policy.competitiveProfile ? input.participantFacts ?? await loadParticipantQualificationFacts(members.map(member => member.userId), {
    executor: tx, platform: policy.competitiveProfile.platform, fallbackPlatform: policy.competitiveProfile.fallbackConversion?.sourcePlatform,
  }) : new Map();
  if (policy.competitiveProfile && members.some(member => !facts.has(member.userId))) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "已确认名单的竞技资料不完整，不能同步 Play-in 资格事实。");
  }
  const overrides = await loadActiveRestrictionOverridesInTx(tx, {
    competitionId: input.season.id, entryIds: [input.entryId], rosterRevisionIds: [input.rosterRevisionId],
  });
  return {
    version: 1, entryId: input.entryId, rosterRevisionId: input.rosterRevisionId, policy,
    competitiveFacts: policy.competitiveProfile ? members.map(member => toPlayerStrengthInput(facts.get(member.userId)!, policy.competitiveProfile)) : [],
    restrictionOverrides: overrides.map(override => ({
      entryId: override.entryId, rosterRevisionId: override.rosterRevisionId, restrictionCode: override.restrictionCode,
      findingSnapshot: override.findingSnapshot, reason: override.reason, grantedBy: override.grantedBy, grantedAt: override.grantedAt.toISOString(),
    })),
  };
}

export async function clearQualificationRosterSnapshotsInTx(tx: TxDb, entryIds: string[]): Promise<void> {
  if (!entryIds.length) return;
  const used = await tx.select({ entryId: matchRosters.entryId }).from(matchRosters)
    .innerJoin(matches, eq(matches.id, matchRosters.matchId))
    .where(and(inArray(matchRosters.entryId, entryIds), isNotNull(matches.qualificationRunId))).limit(1);
  if (used.length) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "赛事名单资格快照已用于比赛，不能清除。 ");
  await tx.update(eventRosters).set({ eligibilitySnapshot: null }).where(inArray(eventRosters.entryId, entryIds));
}
