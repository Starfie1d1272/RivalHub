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
import {
  analyzeFinalSeedOrder,
  buildTeamSeedRecommendations,
  type SeedOrderDecision,
  type TeamSeedRecommendation,
} from "@/lib/major/team-seed-recommendation";
import {
  buildFrozenSetFingerprint,
  frozenTeamsForSnapshot,
  getSeedRecommendationSnapshotStatus,
} from "@/lib/major/seed-recommendation-snapshot";
import {
  loadParticipantQualificationFacts,
  resolveCompetitiveContext,
  toPlayerStrengthInput,
} from "@/lib/qualification/service";
import type { CompetitiveProfileConfig } from "@/types/season";
import type { Season } from "@/db/schema/seasons";
import type { MajorPrestartPageData, MajorPrestartStrengthPreview } from "./types";
import { projectStrengthTeam } from "./strength";

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

function projectLiveStrengthPreview(
  recommendations: readonly TeamSeedRecommendation[],
  context: CompetitiveProfileConfig,
): MajorPrestartStrengthPreview {
  return {
    status: "ready",
    platform: context.platform,
    conversionPolicyId: context.conversionPolicyId ?? null,
    conversionPolicyVersion: context.conversionPolicyVersion ?? null,
    blockers: [],
    teams: recommendations.map(projectStrengthTeam),
  };
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
        ...projectStrengthTeam({
          teamId: recommendation.competitionEntryId,
          teamName: recommendation.teamName,
          available: true,
          blockers: [],
          teamSeedStrength: recommendation.teamSeedStrength!,
          teamSeedStrengthScaled: recommendation.teamSeedStrengthScaled!,
          recommendationRank: recommendation.recommendationRank!,
          tieGroup: recommendation.tieGroup!,
          displayOrder: recommendation.displayOrder!,
          starters: recommendation.starters,
        }),
        finalSeed: seedDecision?.finalSeedByTeamId[recommendation.competitionEntryId] ?? null,
        finalOrderStatus: seedDecision?.rowStatusByTeamId[recommendation.competitionEntryId] ?? "unsaved",
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
  } = { seedRecommendation: { status: "missing" } },
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
      teamLabel: entrant.teamName ?? entrant.teamId,
      playerIds: (rosterByEntrant.get(entrant.id) ?? []).map((member) => member.userId),
      playerLabels: Object.fromEntries((rosterByEntrant.get(entrant.id) ?? []).map((member) => [member.userId, member.email ?? member.userId])),
      educationVerificationIds: (rosterByEntrant.get(entrant.id) ?? []).map((member) => member.educationVerificationId),
    })),
    entrantsLocked: Boolean(state?.entrantsLockedAt),
    confirmations: entrants.map((entrant) => ({ teamId: entrant.teamId, confirmed: entrant.rosterStatus === "frozen" })),
    qualificationIssues: issueRows.filter((issue) => issue.category === "qualification").map((issue) => ({ label: issue.label, resolved: Boolean(issue.resolvedAt) })),
    administrativeIssues: issueRows.filter((issue) => issue.category === "administration").map((issue) => ({ label: issue.label, resolved: Boolean(issue.resolvedAt) })),
    tournamentSeeds: seedRows,
    seedConfirmation: state ? { confirmed: state.seedsConfirmedAt !== null && state.seedsConfirmedBy !== null } : null,
    seedRecommendation: options.seedRecommendation,
  });
}

export async function loadMajorPrestartPageData(season: Season): Promise<MajorPrestartPageData> {
  const { capabilities, entrantCapacity } = getStandardMajorDefinition(season);
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
  const candidateEntries = approvedEntries.filter((entry): entry is typeof entry & { approvedRosterRevisionId: string } => Boolean(entry.approvedRosterRevisionId));
  const configuredCompetitiveProfile = capabilities.teamRegistrationConfig.competitiveProfile ?? null;
  const competitiveProfile = configuredCompetitiveProfile
    ? await resolveCompetitiveContext(configuredCompetitiveProfile)
    : null;
  const candidateStarterUserIds = [...new Set(candidateEntries.flatMap((entry) =>
    (approvedMembersByEntryId.get(entry.id) ?? [])
      .filter((member) => member.isPrimaryStarter)
      .map((member) => member.userId),
  ))];
  const qualificationFacts = competitiveProfile
    ? await loadParticipantQualificationFacts(candidateStarterUserIds, {
      platform: competitiveProfile.platform,
      fallbackPlatform: competitiveProfile.fallbackConversion?.sourcePlatform,
      includeCompetitiveFacts: true,
    })
    : new Map();
  const liveStrengthInputs = candidateEntries.map((entry) => ({
    teamId: entry.id,
    teamName: entry.name,
    starters: (approvedMembersByEntryId.get(entry.id) ?? [])
      .filter((member) => member.isPrimaryStarter)
      .map((member) => {
        const fact = qualificationFacts.get(member.userId);
        return fact && competitiveProfile
          ? toPlayerStrengthInput(fact, competitiveProfile)
          : {
            userId: member.userId,
            label: member.email || "未知选手",
            historicalPeak: null,
            previousSeasonPeak: null,
            currentSeasonPeak: null,
          };
      }),
  }));
  const strengthPreview: MajorPrestartStrengthPreview = competitiveProfile
    ? projectLiveStrengthPreview(buildTeamSeedRecommendations(liveStrengthInputs, competitiveProfile), competitiveProfile)
    : {
      status: "unavailable",
      platform: configuredCompetitiveProfile?.platform ?? null,
      conversionPolicyId: configuredCompetitiveProfile?.conversionPolicyId ?? null,
      conversionPolicyVersion: configuredCompetitiveProfile?.conversionPolicyVersion ?? null,
      blockers: [capabilities.teamRegistrationConfig.requireCompetitiveProfile
        ? "本届冻结的竞技平台目录不完整，暂时无法计算实时队伍实力参考。"
        : "本届赛事缺少实力参考所需的竞技上下文。"],
      teams: candidateEntries.map((entry) => ({
        teamId: entry.id,
        teamName: entry.name,
        available: false,
        blockers: [capabilities.teamRegistrationConfig.requireCompetitiveProfile
          ? "本届冻结的竞技平台目录不完整，暂时无法计算实时队伍实力参考。"
          : "本届赛事缺少实力参考所需的竞技上下文。"],
        teamSeedStrength: null,
        teamSeedStrengthScaled: null,
        recommendationRank: null,
        tieGroup: null,
        displayOrder: null,
        starters: [],
      })),
    };

  const [state, entrantRows, rosterRows, issueRows, seedRows, snapshot, stageRunRows] = await Promise.all([
    db.query.majorPrestartStates.findFirst({ where: eq(majorPrestartStates.seasonId, season.id) }),
    db.select({
      id: majorTournamentEntrants.id,
      teamId: majorTournamentEntrants.competitionEntryId,
      teamName: competitionEntries.name,
      eventRosterId: eventRosters.id,
      sourceRosterRevisionId: eventRosters.sourceRosterRevisionId,
      rosterStatus: eventRosters.status,
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
      strengthPreview,
      approvedCandidates: candidateEntries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        representativeName: representativeNameById.get(entry.representativeUserId) ?? "未知用户",
        submittedAt: entry.submittedAt?.toISOString() ?? null,
        reviewedAt: entry.reviewedAt?.toISOString() ?? null,
        approvedAt: approvedAtByRevisionId.get(entry.approvedRosterRevisionId)?.toISOString() ?? null,
        qualificationStatus: "approved" as const,
        selectedAsEntrant: selectedEntryIds.has(entry.id),
        roster: {
          memberCount: approvedMembersByEntryId.get(entry.id)?.length ?? 0,
          primaryStarterCount: approvedMembersByEntryId.get(entry.id)?.filter((member) => member.isPrimaryStarter).length ?? 0,
          members: approvedMembersByEntryId.get(entry.id) ?? [],
        },
      })),
      entrants: entrantRows.map((entrant) => ({
        id: entrant.id,
        teamId: entrant.teamId,
        teamName: entrant.teamName ?? entrant.teamId,
        rosterStatus: entrant.rosterStatus,
        roster: (rosterByEntrant.get(entrant.id) ?? []).map((member) => ({
          userId: member.userId,
          email: member.email,
          isPrimaryStarter: member.isPrimaryStarter,
          educationVerified: Boolean(member.educationVerificationId),
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
