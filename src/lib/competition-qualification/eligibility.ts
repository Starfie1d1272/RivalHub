import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { competitionQualificationRuns, eventRosterMembers, eventRosters, type Season } from "@/db/schema";
import { capabilitiesFromSeason } from "@/lib/competition/definition";
import { loadActiveRestrictionOverridesInTx } from "@/lib/competition-entries/restriction-overrides";
import { AppError, ErrorCode } from "@/lib/errors";
import { freezeAffiliationRules } from "@/lib/major/frozen-affiliation-rules";
import type { PlayerStrengthInput } from "@/lib/major/player-strength";
import type { FrozenRestrictionOverrideSnapshot } from "@/lib/major/run-snapshot";
import { loadParticipantQualificationFacts, resolveCompetitiveContext, toPlayerStrengthInput } from "@/lib/qualification/service";
import type { CompetitiveProfileConfig, InstitutionAffiliationRule } from "@/types/season";

export interface QualificationEligibilityPolicy {
  version: 1;
  affiliationRules: readonly InstitutionAffiliationRule[];
  competitiveProfile: CompetitiveProfileConfig | null;
  starterCount: number;
  maxSubstitutes: number;
  externalStrengthGapEnabled: boolean;
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
  const capabilities = capabilitiesFromSeason(season);
  const configured = capabilities.teamRegistrationConfig.competitiveProfile;
  const competitiveProfile = configured ? await resolveCompetitiveContext(configured) : null;
  if (capabilities.teamRegistrationConfig.requireCompetitiveProfile && !competitiveProfile) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "本届资格赛缺少有效竞技规则，不能锁定配置。");
  }
  return {
    version: 1,
    affiliationRules: freezeAffiliationRules(capabilities.affiliationRules),
    competitiveProfile,
    starterCount: season.starterCount,
    maxSubstitutes: 2,
    externalStrengthGapEnabled: competitiveProfile !== null,
  };
}

/** Explicit approved-roster synchronization freezes facts once per adopted revision. */
export async function freezeQualificationRosterInTx(tx: TxDb, input: {
  season: Season; entryId: string; rosterRevisionId: string; eventRosterId: string;
}): Promise<void> {
  const [run] = await tx.select({ policy: competitionQualificationRuns.eligibilityPolicy }).from(competitionQualificationRuns)
    .where(eq(competitionQualificationRuns.seasonId, input.season.id));
  if (!run) return; // Only Qualification owns this snapshot; Main Event has StageRun.
  const policy = run.policy;
  if (!policy || policy.version !== 1) throw new AppError(ErrorCode.VALIDATION_FAILED, "Play-in 缺少已锁定的资格规则，请在首轮生成前重置配置。");
  const [roster] = await tx.select({ snapshot: eventRosters.eligibilitySnapshot }).from(eventRosters).where(eq(eventRosters.id, input.eventRosterId));
  if (roster?.snapshot?.rosterRevisionId === input.rosterRevisionId && roster.snapshot.entryId === input.entryId) return;
  const members = await tx.select({ userId: eventRosterMembers.userId }).from(eventRosterMembers)
    .where(and(eq(eventRosterMembers.eventRosterId, input.eventRosterId), eq(eventRosterMembers.isCurrent, true)));
  const facts = policy.competitiveProfile ? await loadParticipantQualificationFacts(members.map(member => member.userId), {
    executor: tx, platform: policy.competitiveProfile.platform, fallbackPlatform: policy.competitiveProfile.fallbackConversion?.sourcePlatform,
  }) : new Map();
  if (policy.competitiveProfile && members.some(member => !facts.has(member.userId))) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "已确认名单的竞技资料不完整，不能同步 Play-in 资格事实。");
  }
  const overrides = await loadActiveRestrictionOverridesInTx(tx, {
    competitionId: input.season.id, entryIds: [input.entryId], rosterRevisionIds: [input.rosterRevisionId],
  });
  const snapshot: QualificationRosterEligibility = {
    version: 1, entryId: input.entryId, rosterRevisionId: input.rosterRevisionId, policy,
    competitiveFacts: policy.competitiveProfile ? members.map(member => toPlayerStrengthInput(facts.get(member.userId)!, policy.competitiveProfile)) : [],
    restrictionOverrides: overrides.map(override => ({
      entryId: override.entryId, rosterRevisionId: override.rosterRevisionId, restrictionCode: override.restrictionCode,
      findingSnapshot: override.findingSnapshot, reason: override.reason, grantedBy: override.grantedBy, grantedAt: override.grantedAt.toISOString(),
    })),
  };
  await tx.update(eventRosters).set({ eligibilitySnapshot: snapshot }).where(eq(eventRosters.id, input.eventRosterId));
}

export async function clearQualificationRosterSnapshotsInTx(tx: TxDb, entryIds: string[]): Promise<void> {
  if (entryIds.length) await tx.update(eventRosters).set({ eligibilitySnapshot: null }).where(inArray(eventRosters.entryId, entryIds));
}
