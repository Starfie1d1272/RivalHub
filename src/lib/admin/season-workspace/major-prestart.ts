import "server-only";

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitionEntries,
  competitionEntryRosterMembers,
  competitionEntryRosterRevisions,
  competitionQualificationEntrants,
  competitionQualificationRuns,
  eventRosterMembers,
  eventRosters,
  majorPrestartStates,
  majorSeedRecommendationSnapshots,
  majorStageRuns,
  majorTournamentEntrants,
  majorTournamentSeeds,
  matches,
  steamProfiles,
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
import { projectStrengthTeams } from "./strength";
import { projectSwissStage } from "@/lib/swiss/core";
import { orderQualificationCandidates } from "@/lib/competition-qualification/policy";

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
  label: string;
  educationVerificationId: string | null;
  isPrimaryStarter: boolean;
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
    teams: projectStrengthTeams(recommendations),
  };
}

function projectRecommendationSnapshot(
  snapshot: typeof majorSeedRecommendationSnapshots.$inferSelect | undefined,
  status: "missing" | "ready" | "mismatch",
  seedDecision: SeedOrderDecision | null,
): MajorPrestartPageData["seedManagement"]["recommendation"] {
  if (!snapshot || status !== "ready") return null;
  const context = snapshot.context;
  const recommendations = snapshot.recommendations
    .filter((recommendation) => recommendation.teamSeedStrength !== null && recommendation.recommendationRank !== null && recommendation.tieGroup !== null && recommendation.displayOrder !== null)
    .sort((left, right) => left.displayOrder! - right.displayOrder!);
  const projectedTeams = projectStrengthTeams(recommendations.map((recommendation) => ({
    teamId: recommendation.competitionEntryId,
    teamName: recommendation.teamName,
    available: true,
    blockers: [],
    teamSeedStrength: recommendation.teamSeedStrength,
    teamSeedStrengthScaled: recommendation.teamSeedStrengthScaled,
    recommendationRank: recommendation.recommendationRank,
    tieGroup: recommendation.tieGroup,
    displayOrder: recommendation.displayOrder,
    starters: recommendation.starters,
  })));
  return {
    version: context.version,
    generatedAt: snapshot.generatedAt.toISOString(),
    platform: context.competitiveContext.platform,
    conversionPolicyId: context.competitiveContext.conversionPolicyId,
    conversionPolicyVersion: context.competitiveContext.conversionPolicyVersion,
    teams: recommendations.map((recommendation, index) => ({
      entrantId: recommendation.entrantId,
      ...projectedTeams[index]!,
      recommendationRank: recommendation.recommendationRank!,
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
      playerLabels: Object.fromEntries((rosterByEntrant.get(entrant.id) ?? []).map((member) => [member.userId, member.label])),
      educationVerificationIds: (rosterByEntrant.get(entrant.id) ?? []).map((member) => member.educationVerificationId),
    })),
    entrantsLocked: Boolean(state?.entrantsLockedAt),
    confirmations: entrants.map((entrant) => ({ teamId: entrant.teamId, confirmed: entrant.rosterStatus === "frozen" })),
    tournamentSeeds: seedRows,
    seedConfirmation: state ? { confirmed: state.seedsConfirmedAt !== null && state.seedsConfirmedBy !== null } : null,
    seedRecommendation: options.seedRecommendation,
  });
}

export async function loadMajorPrestartPageData(season: Season): Promise<MajorPrestartPageData> {
  const { capabilities, entrantCapacity, managedProfile } = getStandardMajorDefinition(season);
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
      displayName: users.displayName,
      perfectName: users.perfectName,
      personaName: steamProfiles.personaName,
      email: users.email,
      isPrimaryStarter: competitionEntryRosterMembers.isPrimaryStarter,
    }).from(competitionEntryRosterMembers)
      .innerJoin(competitionEntryRosterRevisions, eq(competitionEntryRosterMembers.revisionId, competitionEntryRosterRevisions.id))
      .innerJoin(users, eq(competitionEntryRosterMembers.userId, users.id))
      .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
      .where(inArray(competitionEntryRosterMembers.revisionId, approvedRevisionIds))
      .orderBy(asc(competitionEntryRosterRevisions.entryId), asc(competitionEntryRosterMembers.userId)),
    representativeIds.length === 0 ? Promise.resolve([]) : db.select({
      id: users.id,
      displayName: users.displayName,
      perfectName: users.perfectName,
      personaName: steamProfiles.personaName,
      email: users.email,
    }).from(users).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64)).where(inArray(users.id, representativeIds)),
  ]);
  const approvedMembersByEntryId = new Map<string, Array<{ userId: string; label: string; isPrimaryStarter: boolean }>>();
  for (const member of approvedMemberRows) {
    const members = approvedMembersByEntryId.get(member.entryId) ?? [];
    members.push({ userId: member.userId, label: getDisplayName(member), isPrimaryStarter: member.isPrimaryStarter });
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
            label: member.label,
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
        recommendationRank: null,
        displayOrder: null,
        tieState: "not_ranked" as const,
        starters: [],
      })),
    };

  const [state, entrantRows, rawRosterRows, seedRows, snapshot, stageRunRows, qualificationRun, qualificationEntrants, qualificationMatches, pendingReviews] = await Promise.all([
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
    db.select({ entrantId: majorTournamentEntrants.id, eventRosterId: eventRosterMembers.eventRosterId, userId: eventRosterMembers.userId, participantId: eventRosterMembers.participantId, displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName, email: users.email, educationVerificationId: eventRosterMembers.educationVerificationId, isPrimaryStarter: eventRosterMembers.isPrimaryStarter })
      .from(eventRosterMembers)
      .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
      .innerJoin(majorTournamentEntrants, eq(majorTournamentEntrants.competitionEntryId, eventRosters.entryId))
      .innerJoin(users, eq(eventRosterMembers.userId, users.id))
      .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
      .where(eq(majorTournamentEntrants.seasonId, season.id)),
    db.select({ teamId: majorTournamentEntrants.competitionEntryId, tournamentSeed: majorTournamentSeeds.seed })
      .from(majorTournamentSeeds)
      .innerJoin(majorTournamentEntrants, eq(majorTournamentSeeds.tournamentEntrantId, majorTournamentEntrants.id))
      .where(eq(majorTournamentSeeds.seasonId, season.id))
      .orderBy(asc(majorTournamentSeeds.seed)),
    db.query.majorSeedRecommendationSnapshots.findFirst({ where: eq(majorSeedRecommendationSnapshots.seasonId, season.id) }),
    db.select({ id: majorStageRuns.id }).from(majorStageRuns).where(eq(majorStageRuns.seasonId, season.id)),
    db.query.competitionQualificationRuns.findFirst({ where: eq(competitionQualificationRuns.seasonId, season.id) }),
    db.select({ entryId: competitionQualificationEntrants.competitionEntryId, preliminarySeed: competitionQualificationEntrants.preliminarySeed, teamName: competitionEntries.name })
      .from(competitionQualificationEntrants)
      .innerJoin(competitionEntries, eq(competitionEntries.id, competitionQualificationEntrants.competitionEntryId))
      .where(eq(competitionQualificationEntrants.seasonId, season.id))
      .orderBy(asc(competitionQualificationEntrants.preliminarySeed)),
    db.select().from(matches).where(and(eq(matches.seasonId, season.id), eq(matches.stage, "play-in"), isNotNull(matches.qualificationRunId)))
      .orderBy(asc(matches.round), asc(matches.id)),
    db.select({ id: competitionEntries.id }).from(competitionEntries).where(and(
      eq(competitionEntries.competitionId, season.id),
      inArray(competitionEntries.registrationStatus, ["submitted", "changes_requested", "waitlisted"]),
    )),
  ]);

  const rosterRows: MajorRosterMemberRow[] = rawRosterRows.map(({ displayName, perfectName, personaName, email, ...member }) => ({
    ...member,
    label: getDisplayName({ displayName, perfectName, personaName, email }),
  }));
  const frozenTeams = frozenTeamsForSnapshot(entrantRows, rosterRows);
  const frozenSetFingerprint = buildFrozenSetFingerprint(season.id, frozenTeams);
  const recommendationStatus = getSeedRecommendationSnapshotStatus({ snapshot, seasonId: season.id, frozenSetFingerprint });
  const seedDecision = recommendationStatus === "ready" && snapshot
    ? analyzeFinalSeedOrder(seedRows.map((seed) => seed.teamId), snapshot.recommendations)
    : null;
  const readiness = buildMajorReadiness(season, state, entrantRows, rosterRows, seedRows, {
    seedRecommendation: { status: recommendationStatus },
  });
  const entrantIds = new Set(entrantRows.map((entrant) => entrant.id));
  const selectedEntryIds = new Set(entrantRows.map((entrant) => entrant.teamId));
  const displayOrderByEntryId = new Map(strengthPreview.teams.map((team) => [team.teamId, team.displayOrder]));
  const initialPreliminaryOrderEntryIds = orderQualificationCandidates(candidateEntries.map((entry) => ({
    entryId: entry.id,
    teamName: entry.name,
    displayOrder: displayOrderByEntryId.get(entry.id) ?? null,
  }))).map((candidate) => candidate.entryId);
  const qualificationStatusByEntryId = new Map<string, { wins: number; losses: number; status: "active" | "advanced" | "eliminated" | "not_started" }>();
  let qualificationCompletedRound = 0;
  const qualificationCurrentRound = Math.max(0, ...qualificationMatches.flatMap((match) => match.round === null ? [] : [match.round]));
  if (qualificationRun?.startedAt && qualificationRun.format === "short_swiss_2w2l") {
    for (let round = 1; round <= 5; round += 1) {
      const roundMatches = qualificationMatches.filter((match) => match.round === round);
      if (roundMatches.length === 0 || roundMatches.some((match) => match.status !== "finished")) break;
      qualificationCompletedRound = round;
    }
    const projection = projectSwissStage({
      entrants: qualificationEntrants.filter((entrant) => entrant.preliminarySeed > qualificationRun.directEntryCount)
        .map((entrant) => ({ teamId: entrant.entryId, initialSeed: entrant.preliminarySeed - qualificationRun.directEntryCount })),
      matches: qualificationMatches.filter((match) => match.round !== null && match.round <= qualificationCompletedRound && match.status === "finished")
        .map((match) => ({
          matchId: match.id,
          round: match.round!,
          entryAId: match.entryAId,
          entryBId: match.entryBId,
          winnerId: match.scoreA! > match.scoreB! ? match.entryAId : match.entryBId,
        })),
      completedRound: qualificationCompletedRound,
      config: { winThreshold: 2, lossThreshold: 2 },
    });
    for (const team of projection.teams) {
      qualificationStatusByEntryId.set(team.teamId, { wins: team.wins, losses: team.losses, status: team.status });
    }
  } else if (qualificationRun?.startedAt) {
    for (const entrant of qualificationEntrants) qualificationStatusByEntryId.set(entrant.entryId, { wins: 0, losses: 0, status: "active" });
    for (const match of qualificationMatches) {
      const a = qualificationStatusByEntryId.get(match.entryAId);
      const b = qualificationStatusByEntryId.get(match.entryBId);
      if (!a || !b) continue;
      if (match.status !== "finished" || match.scoreA === null || match.scoreB === null) continue;
      const winnerId = match.scoreA > match.scoreB ? match.entryAId : match.entryBId;
      if (winnerId === match.entryAId) {
        a.wins += 1;
        b.losses += 1;
        a.status = "advanced";
        b.status = "eliminated";
      } else {
        b.wins += 1;
        a.losses += 1;
        b.status = "advanced";
        a.status = "eliminated";
      }
    }
  }
  const rosterByEntrant = new Map<string, Array<{ userId: string; label: string; educationVerificationId: string | null; isPrimaryStarter: boolean }>>();
  for (const member of rosterRows) {
    if (!entrantIds.has(member.entrantId)) continue;
    const roster = rosterByEntrant.get(member.entrantId) ?? [];
    roster.push({ userId: member.userId, label: member.label, educationVerificationId: member.educationVerificationId, isPrimaryStarter: member.isPrimaryStarter });
    rosterByEntrant.set(member.entrantId, roster);
  }

  return {
    season: { id: season.id, name: season.name, competitionTemplate: season.competitionTemplate },
    readiness,
    management: {
      seasonId: season.id,
      seasonSlug: season.slug,
      seasonStatus: season.status,
      managedProfileId: managedProfile.id,
      registrationClosesAt: season.registrationClosesAt?.toISOString() ?? null,
      registrationClosed: Boolean(season.registrationClosesAt && season.registrationClosesAt.getTime() <= Date.now()),
      entrantCapacity,
      entrantsLocked: Boolean(state?.entrantsLockedAt),
      approvedCandidateCount: approvedEntries.length,
      pendingReviewCount: pendingReviews.length,
      initialPreliminaryOrderEntryIds,
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
          label: member.label,
          isPrimaryStarter: member.isPrimaryStarter,
          educationVerified: Boolean(member.educationVerificationId),
        })),
      })),
      qualification: {
        run: qualificationRun ? {
          id: qualificationRun.id,
          format: qualificationRun.format,
          targetEntrantCount: qualificationRun.targetEntrantCount,
          candidateCount: qualificationRun.candidateCount,
          directEntryCount: qualificationRun.directEntryCount,
          playInEntryCount: qualificationRun.playInEntryCount,
          qualifierCount: qualificationRun.qualifierCount,
          startedAt: qualificationRun.startedAt?.toISOString() ?? null,
          completedAt: qualificationRun.completedAt?.toISOString() ?? null,
          entrants: qualificationEntrants.map((entrant) => {
            const status = qualificationStatusByEntryId.get(entrant.entryId);
            return {
              entryId: entrant.entryId,
              teamName: entrant.teamName,
              preliminarySeed: entrant.preliminarySeed,
              route: entrant.preliminarySeed <= qualificationRun.directEntryCount ? "direct" as const : "play-in" as const,
              wins: status?.wins ?? 0,
              losses: status?.losses ?? 0,
              status: status?.status ?? "not_started" as const,
            };
          }),
          currentRound: qualificationCurrentRound,
          matchCount: qualificationMatches.length,
          finishedMatchCount: qualificationMatches.filter((match) => match.status === "finished").length,
        } : null,
      },
    },
    seedManagement: {
      seasonId: season.id,
      entrantCapacity,
      firstSwissStageName: managedProfile.swissStages[0]!.name,
      entryCohorts: managedProfile.directEntryCohorts.map(({ stageKey, stageName, fromSeed, toSeed }) => ({ stageKey, stageName, fromSeed, toSeed })),
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
