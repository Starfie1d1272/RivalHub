import { createHash } from "node:crypto";
import type { CompetitiveFallbackConversion, CompetitiveProfileConfig } from "@/types/season";
import {
  buildTeamSeedRecommendations,
  TEAM_SEED_STRENGTH_SCALE,
  type TeamSeedRecommendationInput,
} from "./team-seed-recommendation";
import type { PlayerStrengthBreakdown, PlayerStrengthFact, PlayerStrengthInput } from "./player-strength";

const SEED_RECOMMENDATION_SNAPSHOT_VERSION = 1 as const;

export type SeedRecommendationSnapshotStatus = "missing" | "ready" | "mismatch";

interface SeedRecommendationPlayerFactV1 {
  rank: string;
  rating: number;
  ratingComparable: boolean;
  sourcePlatform: string | null;
  sourceSeasonKey: string | null;
  sourceRank: string | null;
  sourceStars: number | null;
  conversionVersion: string | null;
  stars: number | null;
}

interface SeedRecommendationPlayerInputV1 {
  userId: string;
  label: string;
  historicalPeak: SeedRecommendationPlayerFactV1 | null;
  previousSeasonPeak: SeedRecommendationPlayerFactV1 | null;
  currentSeasonPeak: SeedRecommendationPlayerFactV1 | null;
  recentSeasonPeaks: Array<SeedRecommendationPlayerFactV1 | null>;
}

interface SeedRecommendationBreakdownV1 {
  available: boolean;
  blockers: string[];
  weightedRank: number | null;
  historicalValue: number | null;
  previousValue: number | null;
  currentValue: number | null;
  /** Exact fact selected by the canonical recent evidence policy. */
  effectiveRecentPeak: SeedRecommendationPlayerFactV1 | null;
  historicalRating: number | null;
}

interface SeedRecommendationStarterV1 {
  userId: string;
  label: string;
  input: SeedRecommendationPlayerInputV1;
  breakdown: SeedRecommendationBreakdownV1;
}

export interface SeedRecommendationTeamV1 {
  entrantId: string;
  competitionEntryId: string;
  eventRosterId: string;
  sourceRosterRevisionId: string | null;
  teamName: string;
  teamSeedStrength: number | null;
  teamSeedStrengthScaled: number | null;
  recommendationRank: number | null;
  tieGroup: number | null;
  displayOrder: number | null;
  starters: SeedRecommendationStarterV1[];
}

interface SeedRecommendationFrozenMemberV1 {
  userId: string;
  participantId: string | null;
  educationVerificationId: string | null;
  isPrimaryStarter: boolean;
}

export interface SeedRecommendationFrozenTeamV1 {
  entrantId: string;
  competitionEntryId: string;
  eventRosterId: string;
  sourceRosterRevisionId: string | null;
  teamName: string;
  members: SeedRecommendationFrozenMemberV1[];
}

interface SeedRecommendationCompetitiveContextV1 {
  platform: string;
  currentSeasonKey: string;
  previousSeasonKey: string;
  rankOrder: string[];
  evidencePolicy: CompetitiveProfileConfig["evidencePolicy"] | null;
  fallbackConversion: SerializedFallbackConversionV1 | null;
  conversionPolicyId: string | null;
  conversionPolicyVersion: string | null;
  externalStrengthMaxStarGap: number | null;
}

export interface SeedRecommendationSnapshotContextV1 {
  version: typeof SEED_RECOMMENDATION_SNAPSHOT_VERSION;
  seasonId: string;
  frozenSetFingerprint: string;
  teamSeedStrengthScale: typeof TEAM_SEED_STRENGTH_SCALE;
  frozenTeams: SeedRecommendationFrozenTeamV1[];
  competitiveContext: SeedRecommendationCompetitiveContextV1;
}

interface SerializedFallbackConversionV1 {
  sourcePlatform: "fivee";
  version: string;
  seasonKeyMap: Record<string, string>;
  mapping: NonNullable<CompetitiveFallbackConversion["mapping"]> | null;
  rankMap: Record<string, string> | null;
}

export interface SeedRecommendationSnapshotPayloadV1 {
  context: SeedRecommendationSnapshotContextV1;
  recommendations: SeedRecommendationTeamV1[];
}

export interface FrozenSeedRecommendationEntrantRow {
  id: string;
  teamId: string;
  eventRosterId: string;
  sourceRosterRevisionId: string | null;
  teamName?: string | null;
}

export interface FrozenSeedRecommendationMemberRow {
  entrantId: string;
  userId: string;
  participantId: string | null;
  educationVerificationId: string | null;
  isPrimaryStarter: boolean;
}

export interface FrozenSeedRecommendationTeamInput {
  identity: SeedRecommendationFrozenTeamV1;
  starters: PlayerStrengthInput[];
}

/** Shared projection of the frozen entrant/EventRoster identity used for fingerprints. */
export function frozenTeamsForSnapshot(
  entrants: readonly FrozenSeedRecommendationEntrantRow[],
  rosterRows: readonly FrozenSeedRecommendationMemberRow[],
): SeedRecommendationFrozenTeamV1[] {
  const rosterByEntrant = new Map<string, FrozenSeedRecommendationMemberRow[]>();
  for (const member of rosterRows) {
    rosterByEntrant.set(member.entrantId, [...(rosterByEntrant.get(member.entrantId) ?? []), member]);
  }
  return entrants.map((entrant) => ({
    entrantId: entrant.id,
    competitionEntryId: entrant.teamId,
    eventRosterId: entrant.eventRosterId,
    sourceRosterRevisionId: entrant.sourceRosterRevisionId,
    teamName: entrant.teamName ?? entrant.teamId,
    members: (rosterByEntrant.get(entrant.id) ?? []).map((member) => ({
      userId: member.userId,
      participantId: member.participantId,
      educationVerificationId: member.educationVerificationId,
      isPrimaryStarter: member.isPrimaryStarter,
    })),
  }));
}

function serializePlayerFact(fact: PlayerStrengthFact | null): SeedRecommendationPlayerFactV1 | null {
  if (!fact) return null;
  return {
    rank: fact.rank,
    rating: fact.rating,
    ratingComparable: fact.ratingComparable !== false,
    sourcePlatform: fact.sourcePlatform ?? null,
    sourceSeasonKey: fact.sourceSeasonKey ?? null,
    sourceRank: fact.sourceRank ?? null,
    sourceStars: fact.sourceStars ?? null,
    conversionVersion: fact.conversionVersion ?? null,
    stars: fact.stars ?? null,
  };
}

function serializePlayerInput(input: PlayerStrengthInput): SeedRecommendationPlayerInputV1 {
  return {
    userId: input.userId,
    label: input.label,
    historicalPeak: serializePlayerFact(input.historicalPeak),
    previousSeasonPeak: serializePlayerFact(input.previousSeasonPeak),
    currentSeasonPeak: serializePlayerFact(input.currentSeasonPeak),
    recentSeasonPeaks: (input.recentSeasonPeaks ?? []).map(serializePlayerFact),
  };
}

function serializeBreakdown(breakdown: PlayerStrengthBreakdown): SeedRecommendationBreakdownV1 {
  return {
    available: breakdown.available,
    blockers: [...breakdown.blockers],
    weightedRank: breakdown.weightedRank,
    historicalValue: breakdown.historicalValue,
    previousValue: breakdown.previousValue,
    currentValue: breakdown.currentValue,
    effectiveRecentPeak: serializePlayerFact(breakdown.effectiveRecentPeak),
    historicalRating: breakdown.historicalRating,
  };
}

function serializeFallbackConversion(
  conversion: CompetitiveFallbackConversion | undefined,
): SerializedFallbackConversionV1 | null {
  if (!conversion) return null;
  return {
    sourcePlatform: conversion.sourcePlatform,
    version: conversion.version,
    seasonKeyMap: { ...conversion.seasonKeyMap },
    mapping: conversion.mapping ?? null,
    rankMap: conversion.rankMap ? { ...conversion.rankMap } : null,
  };
}

function snapshotCompetitiveContextFromConfig(
  config: CompetitiveProfileConfig,
): SeedRecommendationCompetitiveContextV1 {
  return {
    platform: config.platform,
    currentSeasonKey: config.currentSeasonKey,
    previousSeasonKey: config.previousSeasonKey,
    rankOrder: [...config.rankOrder],
    evidencePolicy: config.evidencePolicy ? { ...config.evidencePolicy, recentSeasonKeys: [...config.evidencePolicy.recentSeasonKeys] } : null,
    fallbackConversion: serializeFallbackConversion(config.fallbackConversion),
    conversionPolicyId: config.conversionPolicyId ?? null,
    conversionPolicyVersion: config.conversionPolicyVersion ?? null,
    externalStrengthMaxStarGap: config.externalStrengthMaxStarGap ?? null,
  };
}

function compareStrings(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function canonicalFrozenSet(frozenTeams: readonly SeedRecommendationFrozenTeamV1[]) {
  return frozenTeams
    .map((team) => ({
      entrantId: team.entrantId,
      competitionEntryId: team.competitionEntryId,
      eventRosterId: team.eventRosterId,
      sourceRosterRevisionId: team.sourceRosterRevisionId,
      teamName: team.teamName,
      members: [...team.members]
        .map((member) => ({
          userId: member.userId,
          participantId: member.participantId,
          educationVerificationId: member.educationVerificationId,
          isPrimaryStarter: member.isPrimaryStarter,
        }))
        .sort((left, right) => compareStrings(left.userId, right.userId)),
    }))
    .sort((left, right) => compareStrings(left.entrantId, right.entrantId));
}

export function buildFrozenSetFingerprint(
  seasonId: string,
  frozenTeams: readonly SeedRecommendationFrozenTeamV1[],
): string {
  const canonical = JSON.stringify({ seasonId, frozenTeams: canonicalFrozenSet(frozenTeams) });
  return createHash("sha256").update(canonical).digest("hex");
}

export function buildSeedRecommendationSnapshotPayload(input: {
  seasonId: string;
  frozenTeams: readonly FrozenSeedRecommendationTeamInput[];
  competitiveContext: CompetitiveProfileConfig;
}): SeedRecommendationSnapshotPayloadV1 {
  const frozenTeams = canonicalFrozenSet(input.frozenTeams.map((team) => team.identity));
  const frozenByEntryId = new Map(input.frozenTeams.map((team) => [team.identity.competitionEntryId, team]));
  const frozenSetFingerprint = buildFrozenSetFingerprint(input.seasonId, frozenTeams);
  const recommendations = buildTeamSeedRecommendations(
    frozenTeams.map((identity): TeamSeedRecommendationInput => {
      const team = frozenByEntryId.get(identity.competitionEntryId);
      return {
        teamId: identity.competitionEntryId,
        teamName: identity.teamName,
        starters: team?.starters ?? [],
      };
    }),
    input.competitiveContext,
  );
  const recommendationByTeamId = new Map(recommendations.map((recommendation) => [recommendation.teamId, recommendation]));

  return {
    context: {
      version: SEED_RECOMMENDATION_SNAPSHOT_VERSION,
      seasonId: input.seasonId,
      frozenSetFingerprint,
      teamSeedStrengthScale: TEAM_SEED_STRENGTH_SCALE,
      frozenTeams,
      competitiveContext: snapshotCompetitiveContextFromConfig(input.competitiveContext),
    },
    recommendations: frozenTeams.map((identity) => {
      const recommendation = recommendationByTeamId.get(identity.competitionEntryId);
      if (!recommendation) throw new Error("无法为已冻结队伍生成系统种子建议。");
      return {
        entrantId: identity.entrantId,
        competitionEntryId: identity.competitionEntryId,
        eventRosterId: identity.eventRosterId,
        sourceRosterRevisionId: identity.sourceRosterRevisionId,
        teamName: identity.teamName,
        teamSeedStrength: recommendation.teamSeedStrength,
        teamSeedStrengthScaled: recommendation.teamSeedStrengthScaled,
        recommendationRank: recommendation.recommendationRank,
        tieGroup: recommendation.tieGroup,
        displayOrder: recommendation.displayOrder,
        starters: recommendation.starters.map((starter) => ({
          userId: starter.userId,
          label: starter.label,
          input: serializePlayerInput(starter.input),
          breakdown: serializeBreakdown(starter.breakdown),
        })),
      };
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value > 0;
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || (isFiniteNumber(value) && Number.isInteger(value) && value >= 0);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isPlayerFact(value: unknown): value is SeedRecommendationPlayerFactV1 {
  return isRecord(value) &&
    typeof value.rank === "string" &&
    isFiniteNumber(value.rating) &&
    typeof value.ratingComparable === "boolean" &&
    isNullableString(value.sourcePlatform) &&
    isNullableString(value.sourceSeasonKey) &&
    isNullableString(value.sourceRank) &&
    isNullableNonNegativeInteger(value.sourceStars) &&
    isNullableString(value.conversionVersion) &&
    isNullableNonNegativeInteger(value.stars);
}

function isPlayerInput(value: unknown): value is SeedRecommendationPlayerInputV1 {
  return isRecord(value) &&
    typeof value.userId === "string" &&
    typeof value.label === "string" &&
    (value.historicalPeak === null || isPlayerFact(value.historicalPeak)) &&
    (value.previousSeasonPeak === null || isPlayerFact(value.previousSeasonPeak)) &&
    (value.currentSeasonPeak === null || isPlayerFact(value.currentSeasonPeak)) &&
    Array.isArray(value.recentSeasonPeaks) &&
    value.recentSeasonPeaks.every((fact) => fact === null || isPlayerFact(fact));
}

function isBreakdown(value: unknown): value is SeedRecommendationBreakdownV1 {
  return isRecord(value) &&
    typeof value.available === "boolean" &&
    Array.isArray(value.blockers) &&
    value.blockers.every((blocker) => typeof blocker === "string") &&
    isNullableFiniteNumber(value.weightedRank) &&
    isNullableFiniteNumber(value.historicalValue) &&
    isNullableFiniteNumber(value.previousValue) &&
    isNullableFiniteNumber(value.currentValue) &&
    (value.effectiveRecentPeak === null || isPlayerFact(value.effectiveRecentPeak)) &&
    isNullableFiniteNumber(value.historicalRating);
}

function isConversionMapping(value: unknown): value is NonNullable<CompetitiveFallbackConversion["mapping"]> {
  return isRecord(value) &&
    isStringRecord(value.belowSRankMap) &&
    Array.isArray(value.starSegments) &&
    value.starSegments.every((segment) => isRecord(segment) &&
      isFiniteNumber(segment.minStar) &&
      (segment.maxStar === null || isFiniteNumber(segment.maxStar)) &&
      typeof segment.targetRank === "string" &&
      (segment.targetStarFloor === null || isFiniteNumber(segment.targetStarFloor)) &&
      isFiniteNumber(segment.slopeNum) &&
      isFiniteNumber(segment.slopeDen)) &&
    value.relativeSeasonAlignment === true;
}

function isFallbackConversion(value: unknown): value is SerializedFallbackConversionV1 | null {
  if (value === null) return true;
  return isRecord(value) &&
    value.sourcePlatform === "fivee" &&
    typeof value.version === "string" &&
    isStringRecord(value.seasonKeyMap) &&
    (value.mapping === null || isConversionMapping(value.mapping)) &&
    (value.rankMap === null || isStringRecord(value.rankMap));
}

function isEvidencePolicy(value: unknown): value is CompetitiveProfileConfig["evidencePolicy"] | null {
  if (value === null) return true;
  return isRecord(value) &&
    value.historicalWeight === 50 &&
    typeof value.referenceSeasonKey === "string" &&
    value.referenceSeasonWeight === 20 &&
    Array.isArray(value.recentSeasonKeys) &&
    value.recentSeasonKeys.every((key) => typeof key === "string") &&
    value.recentSeasonWeight === 30;
}

function isCompetitiveContext(value: unknown): value is SeedRecommendationCompetitiveContextV1 {
  return isRecord(value) &&
    typeof value.platform === "string" &&
    typeof value.currentSeasonKey === "string" &&
    typeof value.previousSeasonKey === "string" &&
    Array.isArray(value.rankOrder) &&
    value.rankOrder.length > 0 &&
    value.rankOrder.every((rank) => typeof rank === "string") &&
    isEvidencePolicy(value.evidencePolicy) &&
    isFallbackConversion(value.fallbackConversion) &&
    isNullableString(value.conversionPolicyId) &&
    isNullableString(value.conversionPolicyVersion) &&
    isNullableFiniteNumber(value.externalStrengthMaxStarGap);
}

function isSnapshotStarter(value: unknown): value is SeedRecommendationStarterV1 {
  if (!isRecord(value) || typeof value.userId !== "string" || typeof value.label !== "string") return false;
  if (!isPlayerInput(value.input) || !isBreakdown(value.breakdown)) return false;
  return value.input.userId === value.userId &&
    value.breakdown.available &&
    value.breakdown.weightedRank !== null &&
    value.breakdown.historicalValue !== null &&
    value.breakdown.previousValue !== null &&
    value.breakdown.currentValue !== null &&
    value.breakdown.effectiveRecentPeak !== null;
}

function isSnapshotRecommendation(value: unknown): value is SeedRecommendationTeamV1 {
  return isRecord(value) &&
    typeof value.entrantId === "string" &&
    typeof value.competitionEntryId === "string" &&
    typeof value.eventRosterId === "string" &&
    (typeof value.sourceRosterRevisionId === "string" || value.sourceRosterRevisionId === null) &&
    typeof value.teamName === "string" &&
    isFiniteNumber(value.teamSeedStrength) &&
    isPositiveInteger(value.teamSeedStrengthScaled) &&
    value.teamSeedStrength === value.teamSeedStrengthScaled / TEAM_SEED_STRENGTH_SCALE &&
    isPositiveInteger(value.recommendationRank) &&
    isPositiveInteger(value.tieGroup) &&
    isPositiveInteger(value.displayOrder) &&
    Array.isArray(value.starters) &&
    value.starters.length === 5 &&
    new Set(value.starters.filter(isRecord).map((starter) => starter.userId)).size === 5 &&
    value.starters.every(isSnapshotStarter);
}

function isSnapshotFrozenTeam(value: unknown): value is SeedRecommendationFrozenTeamV1 {
  return isRecord(value) &&
    typeof value.entrantId === "string" &&
    typeof value.competitionEntryId === "string" &&
    typeof value.eventRosterId === "string" &&
    (typeof value.sourceRosterRevisionId === "string" || value.sourceRosterRevisionId === null) &&
    typeof value.teamName === "string" &&
    Array.isArray(value.members) &&
    value.members.length >= 5 && value.members.length <= 9 &&
    value.members.filter((member) => isRecord(member) && member.isPrimaryStarter === true).length === 5 &&
    new Set(value.members.filter(isRecord).map((member) => member.userId)).size === value.members.length &&
    value.members.every((member) => isRecord(member) &&
      typeof member.userId === "string" &&
      (typeof member.participantId === "string" || member.participantId === null) &&
      (typeof member.educationVerificationId === "string" || member.educationVerificationId === null) &&
      typeof member.isPrimaryStarter === "boolean");
}

function isSeedRecommendationSnapshotContextV1(value: unknown): value is SeedRecommendationSnapshotContextV1 {
  return isRecord(value) &&
    value.version === SEED_RECOMMENDATION_SNAPSHOT_VERSION &&
    typeof value.seasonId === "string" &&
    typeof value.frozenSetFingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(value.frozenSetFingerprint) &&
    value.teamSeedStrengthScale === TEAM_SEED_STRENGTH_SCALE &&
    Array.isArray(value.frozenTeams) &&
    new Set(value.frozenTeams.filter(isRecord).map((team) => team.entrantId)).size === value.frozenTeams.length &&
    new Set(value.frozenTeams.filter(isRecord).map((team) => team.competitionEntryId)).size === value.frozenTeams.length &&
    value.frozenTeams.every(isSnapshotFrozenTeam) &&
    isCompetitiveContext(value.competitiveContext);
}

function isSeedRecommendationSnapshotPayloadV1(
  context: unknown,
  recommendations: unknown,
): context is SeedRecommendationSnapshotContextV1 {
  if (!isSeedRecommendationSnapshotContextV1(context) || !Array.isArray(recommendations)) return false;
  if (
    recommendations.length !== context.frozenTeams.length ||
    !recommendations.every(isSnapshotRecommendation) ||
    new Set(recommendations.map((recommendation) => recommendation.competitionEntryId)).size !== context.frozenTeams.length
  ) return false;
  const frozenByEntryId = new Map(context.frozenTeams.map((team) => [team.competitionEntryId, team]));
  return recommendations.every((recommendation) => {
    const frozen = frozenByEntryId.get(recommendation.competitionEntryId);
    if (!frozen ||
      frozen.entrantId !== recommendation.entrantId ||
      frozen.eventRosterId !== recommendation.eventRosterId ||
      frozen.sourceRosterRevisionId !== recommendation.sourceRosterRevisionId ||
      frozen.teamName !== recommendation.teamName) return false;
    const primaryUserIds = new Set(frozen.members.filter((member) => member.isPrimaryStarter).map((member) => member.userId));
    return primaryUserIds.size === 5 && recommendation.starters.every((starter) => primaryUserIds.has(starter.userId));
  });
}

export function getSeedRecommendationSnapshotStatus(input: {
  snapshot: { entrantSetFingerprint: string; context: unknown; recommendations: unknown } | undefined;
  seasonId: string;
  frozenSetFingerprint: string;
}): SeedRecommendationSnapshotStatus {
  if (!input.snapshot) return "missing";
  if (input.snapshot.entrantSetFingerprint !== input.frozenSetFingerprint) return "mismatch";
  if (!isSeedRecommendationSnapshotPayloadV1(input.snapshot.context, input.snapshot.recommendations)) return "mismatch";
  if (input.snapshot.context.seasonId !== input.seasonId || input.snapshot.context.frozenSetFingerprint !== input.frozenSetFingerprint) return "mismatch";
  if (buildFrozenSetFingerprint(input.seasonId, input.snapshot.context.frozenTeams) !== input.frozenSetFingerprint) return "mismatch";
  return "ready";
}

export function snapshotPayloadsEqual(
  left: { context: unknown; recommendations: unknown },
  right: SeedRecommendationSnapshotPayloadV1,
): boolean {
  return stableJson(left.context) === stableJson(right.context) &&
    stableJson(left.recommendations) === stableJson(right.recommendations);
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableJsonValue(value[key])]),
  );
}
