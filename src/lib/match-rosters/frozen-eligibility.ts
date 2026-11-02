import { AppError, ErrorCode } from "@/lib/errors";
import { decodeEventRosterEligibilitySnapshotV2 } from "@/lib/seasons/eligibility-snapshot";
import type { FrozenLineupEligibility, QualificationEvidence } from "@/lib/seasons/rules";

/** Decode one adopted snapshot and bind it to the expected event and roster revision. */
export function decodeFrozenLineupEligibility(value: unknown, expected: {
  seasonId: string; entryId: string; rosterRevisionId: string;
}): FrozenLineupEligibility {
  const snapshot = decodeEventRosterEligibilitySnapshotV2(value);
  if (snapshot.seasonId !== expected.seasonId || snapshot.entryId !== expected.entryId || snapshot.rosterRevisionId !== expected.rosterRevisionId) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "冻结资格快照与赛事名单版本不一致。");
  }
  const membersById: FrozenLineupEligibility["membersById"] = new Map(snapshot.members.map((member) => [member.eventRosterMemberId, {
    eventRosterMemberId: member.eventRosterMemberId, userId: member.userId, verification: member.education,
  }]));
  if (membersById.size !== snapshot.members.length || new Set(snapshot.members.map((member) => member.userId)).size !== snapshot.members.length ||
      snapshot.members.some((member) => member.source.rosterRevisionId !== snapshot.rosterRevisionId)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "冻结资格快照的成员身份不一致。");
  }
  let evidence: QualificationEvidence = { kind: "none" };
  if (snapshot.competitive) {
    const { profile, requirements, byUser } = snapshot.competitive;
    if (!profile || new Set(byUser.map((fact) => fact.userId)).size !== byUser.length || byUser.some((fact) => !snapshot.members.some((member) => member.userId === fact.userId))) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "冻结竞技资格事实不完整或不属于该名单。");
    }
    evidence = {
      kind: "competitive",
      context: { profile, platform: profile.platform, rankOrder: profile.rankOrder, fallback: profile.fallbackConversion ?? null,
        sourceSelection: profile.evidencePolicy?.sourceSelection ?? "primary_then_fallback", evidencePolicy: profile.evidencePolicy ?? null },
      requirements,
      byUser: new Map(byUser.map((fact) => [fact.userId, {
        historicalPeak: fact.historicalPeak, seasons: new Map(Object.entries(fact.seasons)),
        strength: { userId: fact.userId, label: fact.userId, historicalPeak: fact.historicalPeak,
          previousSeasonPeak: fact.seasons[profile.previousSeasonKey] ?? null,
          currentSeasonPeak: fact.seasons[profile.currentSeasonKey] ?? null,
          ...(profile.evidencePolicy ? { recentSeasonPeaks: profile.evidencePolicy.recentSeasonKeys.map((key) => fact.seasons[key] ?? null) } : {}) },
      }])),
    };
  }
  return {
    entryId: snapshot.entryId, rosterRevisionId: snapshot.rosterRevisionId,
    starterCount: snapshot.rules.starterCount, maxSubstitutes: snapshot.rules.maxSubstitutes,
    affiliationRules: snapshot.rules.affiliationRules, educationRequired: snapshot.rules.qualificationPolicy.educationRequired,
    competitiveProfileRequired: snapshot.rules.qualificationPolicy.competitiveProfileRequired,
    externalStrengthGap: snapshot.rules.qualificationPolicy.externalStrengthGap,
    membersById, evidence, overrides: snapshot.overrides,
  };
}
