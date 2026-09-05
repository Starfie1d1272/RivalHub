import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitionEntries,
  competitionEntryRosterMembers,
  competitionEntryRosterRevisions,
  eventRosterMembers,
  eventRosters,
  majorPrestartIssues,
  majorPrestartStates,
  majorSeedRecommendationSnapshots,
  majorStageRuns,
  majorTournamentEntrants,
  majorTournamentSeeds,
  users,
} from "@/db/schema";
import { evaluateMajorPrestartReadiness, type MajorPrestartReadiness } from "@/lib/major/prestart";
import { capabilitiesFromSeason } from "@/lib/competition/definition";
import { getStandardMajorDefinition } from "@/lib/major/standard";
import { getDisplayName } from "@/lib/identity/display-name";
import { analyzeFinalSeedOrder, type SeedOrderDecision } from "@/lib/major/team-seed-recommendation";
import {
  buildFrozenSetFingerprint,
  frozenTeamsForSnapshot,
  getSeedRecommendationSnapshotStatus,
} from "@/lib/major/seed-recommendation-snapshot";
import type { Season } from "@/db/schema/seasons";
import type { MajorPrestartPageData } from "./types";

type MajorEntrantRow = {
  id: string;
  teamId: string;
  teamName?: string | null;
  eventRosterId: string;
  sourceRosterRevisionId: string | null;
  rosterStatus: "preparing" | "confirmed" | "frozen";
};

type MajorRosterMemberRow = {
  entrantId: string;
  eventRosterId: string;
  userId: string;
  participantId: string | null;
  email?: string;
  educationVerificationId: string | null;
  isPrimaryStarter: boolean;
};

type MajorIssueRow = {
  id?: string;
  category: "qualification" | "administration";
  label: string;
  resolvedAt: Date | null;
};

type MajorSeedRow = { teamId: string; tournamentSeed: number };

function projectRecommendationFact(fact: {
  rank: string;
  stars: number | null;
  sourcePlatform: string | null;
  sourceSeasonKey: string | null;
  sourceRank: string | null;
  sourceStars: number | null;
  conversionVersion: string | null;
} | null) {
  return fact ? {
    rank: fact.rank,
    stars: fact.stars,
    sourcePlatform: fact.sourcePlatform,
    sourceSeasonKey: fact.sourceSeasonKey,
    sourceRank: fact.sourceRank,
    sourceStars: fact.sourceStars,
    conversionVersion: fact.conversionVersion,
  } : null;
}

function projectRecommendationSnapshot(
  snapshot: typeof majorSeedRecommendationSnapshots.$inferSelect | undefined,
  status: "missing" | "ready" | "mismatch",
  seedDecision: SeedOrderDecision | null,
): MajorPrestartPageData["seedManagement"]["recommendation"] {
  if (!snapshot || status !== "ready") return null;
  const context = snapshot.context;
  return {
    version: context.version,
    generatedAt: snapshot.generatedAt.toISOString(),
    platform: context.competitiveContext.platform,
    conversionPolicyId: context.competitiveContext.conversionPolicyId,
    conversionPolicyVersion: context.competitiveContext.conversionPolicyVersion,
    teams: snapshot.recommendations
      .filter((recommendation) => recommendation.teamSeedStrength !== null && recommendation.recommendationRank !== null && recommendation.tieGroup !== null && recommendation.displayOrder !== null)
      .sort((left, right) => left.displayOrder! - right.displayOrder!)
      .map((recommendation) => ({
        entrantId: recommendation.entrantId,
        teamId: recommendation.competitionEntryId,
        teamName: recommendation.teamName,
        teamSeedStrength: recommendation.teamSeedStrength!,
        teamSeedStrengthScaled: recommendation.teamSeedStrengthScaled!,
        recommendationRank: recommendation.recommendationRank!,
        tieGroup: recommendation.tieGroup!,
        displayOrder: recommendation.displayOrder!,
        finalSeed: seedDecision?.finalSeedByTeamId[recommendation.competitionEntryId] ?? null,
        finalOrderStatus: seedDecision?.rowStatusByTeamId[recommendation.competitionEntryId] ?? "unsaved",
        starters: recommendation.starters.map((starter) => ({
          userId: starter.userId,
          label: starter.label,
          historicalPeak: projectRecommendationFact(starter.input.historicalPeak),
          previousSeasonPeak: projectRecommendationFact(starter.input.previousSeasonPeak),
          currentSeasonPeak: projectRecommendationFact(starter.input.currentSeasonPeak),
          recentSeasonPeaks: starter.input.recentSeasonPeaks.map(projectRecommendationFact),
          effectiveRecentPeak: projectRecommendationFact(starter.breakdown.effectiveRecentPeak),
          breakdown: {
            weightedRank: starter.breakdown.weightedRank!,
            historicalValue: starter.breakdown.historicalValue!,
            previousValue: starter.breakdown.previousValue!,
            currentValue: starter.breakdown.currentValue!,
            effectiveRecentPeak: projectRecommendationFact(starter.breakdown.effectiveRecentPeak),
            historicalRating: starter.breakdown.historicalRating,
          },
        })),
      })),
  };
}

export function buildMajorReadiness(
  season: Season,
  state: typeof majorPrestartStates.$inferSelect | undefined,
  entrants: readonly MajorEntrantRow[],
  rosterRows: readonly MajorRosterMemberRow[],
  issueRows: readonly MajorIssueRow[],
  seedRows: readonly MajorSeedRow[],
  options: {
    seedRecommendation: { status: "missing" | "ready" | "mismatch" };
    seedOverride: { required: boolean; reason: string | null };
  } = { seedRecommendation: { status: "missing" }, seedOverride: { required: false, reason: null } },
): MajorPrestartReadiness {
  const entrantIds = new Set(entrants.map((entrant) => entrant.id));
  const rosterByEntrant = new Map<string, MajorRosterMemberRow[]>();
  for (const member of rosterRows) {
    if (!entrantIds.has(member.entrantId)) continue;
    const roster = rosterByEntrant.get(member.entrantId) ?? [];
    roster.push(member);
    rosterByEntrant.set(member.entrantId, roster);
  }

  const capabilities = capabilitiesFromSeason(season);
  return evaluateMajorPrestartReadiness({
    competitionTemplate: season.competitionTemplate,
    capabilities,
    teams: entrants.map((entrant) => ({
      teamId: entrant.teamId,
      playerIds: (rosterByEntrant.get(entrant.id) ?? []).map((member) => member.userId),
      educationVerificationIds: (rosterByEntrant.get(entrant.id) ?? []).map((member) => member.educationVerificationId),
    })),
    entrantsLocked: Boolean(state?.entrantsLockedAt),
    confirmations: entrants.map((entrant) => ({ teamId: entrant.teamId, confirmed: entrant.rosterStatus === "frozen" })),
    qualificationIssues: issueRows.filter((issue) => issue.category === "qualification").map((issue) => ({ label: issue.label, resolved: Boolean(issue.resolvedAt) })),
    administrativeIssues: issueRows.filter((issue) => issue.category === "administration").map((issue) => ({ label: issue.label, resolved: Boolean(issue.resolvedAt) })),
    tournamentSeeds: seedRows,
    seedConfirmation: state ? { confirmed: state.seedsConfirmedAt !== null && state.seedsConfirmedBy !== null } : null,
    seedRecommendation: options.seedRecommendation,
    seedOverride: options.seedOverride,
  });
}

export async function loadMajorPrestartPageData(season: Season): Promise<MajorPrestartPageData> {
  const { entrantCapacity } = getStandardMajorDefinition(season);
  const approvedEntries = await db.select({
    id: competitionEntries.id,
    name: competitionEntries.name,
    representativeUserId: competitionEntries.representativeUserId,
    submittedAt: competitionEntries.submittedAt,
    reviewedAt: competitionEntries.reviewedAt,
    approvedRosterRevisionId: competitionEntries.approvedRosterRevisionId,
  }).from(competitionEntries)
    .where(and(eq(competitionEntries.competitionId, season.id), eq(competitionEntries.registrationStatus, "approved")))
    .orderBy(asc(competitionEntries.name));
  const approvedRevisionIds = approvedEntries.flatMap((entry) => entry.approvedRosterRevisionId ? [entry.approvedRosterRevisionId] : []);
  const approvedRevisionRows = approvedRevisionIds.length === 0 ? [] : await db.select({
    id: competitionEntryRosterRevisions.id,
    approvedAt: competitionEntryRosterRevisions.approvedAt,
  }).from(competitionEntryRosterRevisions).where(inArray(competitionEntryRosterRevisions.id, approvedRevisionIds));
  const approvedAtByRevisionId = new Map(approvedRevisionRows.map((revision) => [revision.id, revision.approvedAt]));
  const representativeIds = [...new Set(approvedEntries.map((entry) => entry.representativeUserId))];
  const [approvedMemberRows, representativeRows] = await Promise.all([
    approvedRevisionIds.length === 0 ? Promise.resolve([]) : db.select({
      entryId: competitionEntryRosterRevisions.entryId,
      userId: competitionEntryRosterMembers.userId,
      email: users.email,
      isPrimaryStarter: competitionEntryRosterMembers.isPrimaryStarter,
    }).from(competitionEntryRosterMembers)
      .innerJoin(competitionEntryRosterRevisions, eq(competitionEntryRosterMembers.revisionId, competitionEntryRosterRevisions.id))
      .innerJoin(users, eq(competitionEntryRosterMembers.userId, users.id))
      .where(inArray(competitionEntryRosterMembers.revisionId, approvedRevisionIds))
      .orderBy(asc(competitionEntryRosterRevisions.entryId), asc(competitionEntryRosterMembers.userId)),
    representativeIds.length === 0 ? Promise.resolve([]) : db.select({
      id: users.id,
      displayName: users.displayName,
      perfectName: users.perfectName,
      steamName: users.steamName,
      email: users.email,
    }).from(users).where(inArray(users.id, representativeIds)),
  ]);
  const approvedMembersByEntryId = new Map<string, Array<{ userId: string; email: string; isPrimaryStarter: boolean }>>();
  for (const member of approvedMemberRows) {
    const members = approvedMembersByEntryId.get(member.entryId) ?? [];
    members.push({ userId: member.userId, email: member.email ?? "", isPrimaryStarter: member.isPrimaryStarter });
    approvedMembersByEntryId.set(member.entryId, members);
  }
  const representativeNameById = new Map(representativeRows.map((user) => [user.id, getDisplayName(user)]));

  const [state, entrantRows, rosterRows, issueRows, seedRows, snapshot, stageRunRows] = await Promise.all([
    db.query.majorPrestartStates.findFirst({ where: eq(majorPrestartStates.seasonId, season.id) }),
    db.select({
      id: majorTournamentEntrants.id,
      teamId: majorTournamentEntrants.competitionEntryId,
      teamName: competitionEntries.name,
      eventRosterId: eventRosters.id,
      rosterStatus: eventRosters.status,
      sourceRosterRevisionId: eventRosters.sourceRosterRevisionId,
    }).from(majorTournamentEntrants)
      .innerJoin(competitionEntries, eq(majorTournamentEntrants.competitionEntryId, competitionEntries.id))
      .innerJoin(eventRosters, eq(majorTournamentEntrants.competitionEntryId, eventRosters.entryId))
      .where(eq(majorTournamentEntrants.seasonId, season.id))
      .orderBy(asc(competitionEntries.name)),
    db.select({ entrantId: majorTournamentEntrants.id, eventRosterId: eventRosterMembers.eventRosterId, userId: eventRosterMembers.userId, participantId: eventRosterMembers.participantId, email: users.email, educationVerificationId: eventRosterMembers.educationVerificationId, isPrimaryStarter: eventRosterMembers.isPrimaryStarter })
      .from(eventRosterMembers)
      .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
      .innerJoin(majorTournamentEntrants, eq(majorTournamentEntrants.competitionEntryId, eventRosters.entryId))
      .innerJoin(users, eq(eventRosterMembers.userId, users.id))
      .where(eq(majorTournamentEntrants.seasonId, season.id)),
    db.select().from(majorPrestartIssues)
      .where(eq(majorPrestartIssues.seasonId, season.id))
      .orderBy(asc(majorPrestartIssues.createdAt)),
    db.select({ teamId: majorTournamentEntrants.competitionEntryId, tournamentSeed: majorTournamentSeeds.seed })
      .from(majorTournamentSeeds)
      .innerJoin(majorTournamentEntrants, eq(majorTournamentSeeds.tournamentEntrantId, majorTournamentEntrants.id))
      .where(eq(majorTournamentSeeds.seasonId, season.id))
      .orderBy(asc(majorTournamentSeeds.seed)),
    db.query.majorSeedRecommendationSnapshots.findFirst({ where: eq(majorSeedRecommendationSnapshots.seasonId, season.id) }),
    db.select({ id: majorStageRuns.id }).from(majorStageRuns).where(eq(majorStageRuns.seasonId, season.id)),
  ]);

  const frozenTeams = frozenTeamsForSnapshot(entrantRows, rosterRows);
  const frozenSetFingerprint = buildFrozenSetFingerprint(season.id, frozenTeams);
  const recommendationStatus = getSeedRecommendationSnapshotStatus({ snapshot, seasonId: season.id, frozenSetFingerprint });
  const seedDecision = recommendationStatus === "ready" && snapshot
    ? analyzeFinalSeedOrder(seedRows.map((seed) => seed.teamId), snapshot.recommendations)
    : null;
  const readiness = buildMajorReadiness(season, state, entrantRows, rosterRows, issueRows, seedRows, {
    seedRecommendation: { status: recommendationStatus },
    seedOverride: { required: seedDecision?.divergesFromRecommendation ?? false, reason: state?.seedOverrideReason ?? null },
  });
  const entrantIds = new Set(entrantRows.map((entrant) => entrant.id));
  const selectedEntryIds = new Set(entrantRows.map((entrant) => entrant.teamId));
  const rosterByEntrant = new Map<string, Array<{ userId: string; email: string; educationVerificationId: string | null; isPrimaryStarter: boolean }>>();
  for (const member of rosterRows) {
    if (!entrantIds.has(member.entrantId)) continue;
    const roster = rosterByEntrant.get(member.entrantId) ?? [];
    roster.push({ userId: member.userId, email: member.email ?? "", educationVerificationId: member.educationVerificationId, isPrimaryStarter: member.isPrimaryStarter });
    rosterByEntrant.set(member.entrantId, roster);
  }

  return {
    season: { id: season.id, name: season.name, competitionTemplate: season.competitionTemplate },
    readiness,
    management: {
      seasonId: season.id,
      entrantCapacity,
      entrantsLocked: Boolean(state?.entrantsLockedAt),
      approvedCandidates: approvedEntries.filter((entry): entry is typeof entry & { approvedRosterRevisionId: string } => Boolean(entry.approvedRosterRevisionId)).map((entry) => ({
        id: entry.id,
        name: entry.name,
        representativeName: representativeNameById.get(entry.representativeUserId) ?? "未知用户",
        submittedAt: entry.submittedAt?.toISOString() ?? null,
        reviewedAt: entry.reviewedAt?.toISOString() ?? null,
        approvedAt: approvedAtByRevisionId.get(entry.approvedRosterRevisionId)?.toISOString() ?? null,
        approvedRosterRevisionId: entry.approvedRosterRevisionId,
        qualificationStatus: "approved" as const,
        selectedAsEntrant: selectedEntryIds.has(entry.id),
        roster: {
          memberCount: approvedMembersByEntryId.get(entry.id)?.length ?? 0,
          primaryStarterCount: approvedMembersByEntryId.get(entry.id)?.filter((member) => member.isPrimaryStarter).length ?? 0,
          members: approvedMembersByEntryId.get(entry.id) ?? [],
        },
      })),
      entrants: entrantRows.map((entrant) => ({
        ...entrant,
        roster: (rosterByEntrant.get(entrant.id) ?? []).map((member) => ({
          userId: member.userId,
          email: member.email,
          isPrimaryStarter: member.isPrimaryStarter,
          educationVerificationId: member.educationVerificationId,
        })),
      })),
      issues: issueRows.map((issue) => ({ id: issue.id, category: issue.category, label: issue.label, resolved: Boolean(issue.resolvedAt) })),
    },
    seedManagement: {
      seasonId: season.id,
      entrantsLocked: Boolean(state?.entrantsLockedAt),
      entrants: entrantRows.map((entrant) => ({ teamId: entrant.teamId, teamName: entrant.teamName ?? entrant.teamId })),
      seeds: seedRows,
      seedsConfirmed: Boolean(state?.seedsConfirmedAt && state.seedsConfirmedBy),
      overrideReason: state?.seedOverrideReason ?? null,
      recommendationStatus,
      recommendation: projectRecommendationSnapshot(snapshot, recommendationStatus, seedDecision),
      firstRound: readiness.openingPlan?.firstRound.pairings.map((pairing) => ({
        higherSeed: pairing.higherSeed.tournamentSeed,
        lowerSeed: pairing.lowerSeed.tournamentSeed,
        format: pairing.format,
      })) ?? null,
    },
    started: stageRunRows.length > 0,
  };
}
