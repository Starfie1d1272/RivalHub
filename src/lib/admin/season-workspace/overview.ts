import { findAdminSeasonBySlug } from "@/lib/admin/season-context";
import { capabilitiesFromSeason, checkStandardMajorCapabilities } from "@/lib/competition/definition";
import { deriveMajorPrestartPhase, MAJOR_PRESTART_PHASES } from "./prestart-phase";
import { getOfficialSeasonMatchSummary } from "@/lib/matches/read-official";
import { getApprovedCompetitionEntryCount } from "@/lib/competition-entries/counts";
import { officialMatchCondition } from "@/lib/matches/scope";
import "server-only";

import { and, count, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitionEntries,
  competitionQualificationRuns,
  eventRosterMembers,
  eventRosters,
  majorFinalResults,
  majorPrestartStates,
  majorSeedRecommendationSnapshots,
  majorTournamentEntrants,
  majorTournamentSeeds,
  matchRosters,
  matches,
  postEventAdjudications,
  seasonRegistrations,
  steamProfiles,
  users,
} from "@/db/schema";
import type { Season } from "@/db/schema/seasons";
import { getDisplayName } from "@/lib/identity/display-name";
import { getRegistrationWindowState } from "@/lib/registration/window";
import { buildMajorReadiness } from "./major-prestart";
import { buildFrozenSetFingerprint, frozenTeamsForSnapshot, getSeedRecommendationSnapshotStatus } from "@/lib/major/seed-recommendation-snapshot";
import { projectRegistrationSummary, projectTeamRegistrationFunnel, selectSeasonWorkspaceNextAction } from "./selectors";
import type { SeasonWorkspaceOverviewData, SeasonWorkspaceOverviewSummary } from "./types";

type MajorOverviewFacts = {
  entrantCount: number;
  frozenEntrantCount: number;
  entrants: Array<{ id: string; teamId: string; teamName: string | null; eventRosterId: string; sourceRosterRevisionId: string | null; rosterStatus: "preparing" | "confirmed" | "frozen" }>;
  rosterRows: Array<{ entrantId: string; eventRosterId: string; userId: string; participantId: string | null; label: string; educationVerificationId: string | null; isPrimaryStarter: boolean }>;
  seedRows: Array<{ teamId: string; tournamentSeed: number }>;
  state: typeof majorPrestartStates.$inferSelect | undefined;
  seedRecommendation: { status: "missing" | "ready" | "mismatch" };
  qualification: { completedAt: Date | null } | undefined;
  finalResultStatus: "pending_confirmation" | "confirmed" | null;
};

async function loadRegistrationCounts(season: Season) {
  if (season.registrationMode === "team") {
    return db.select({ status: competitionEntries.registrationStatus, count: count() })
      .from(competitionEntries)
      .where(eq(competitionEntries.competitionId, season.id))
      .groupBy(competitionEntries.registrationStatus);
  }

  return db.select({ status: seasonRegistrations.status, count: count() })
    .from(seasonRegistrations)
    .where(eq(seasonRegistrations.seasonId, season.id))
    .groupBy(seasonRegistrations.status);
}

async function loadMajorOverviewFacts(season: Season, includeReadiness: boolean): Promise<MajorOverviewFacts> {
  if (!includeReadiness) {
    const [[counts], finalResult] = await Promise.all([
      db.select({ count: count(), frozen: sql<number>`count(*) filter (where ${eventRosters.status} = 'frozen')` })
        .from(majorTournamentEntrants)
        .innerJoin(competitionEntries, eq(majorTournamentEntrants.competitionEntryId, competitionEntries.id))
        .innerJoin(eventRosters, eq(majorTournamentEntrants.competitionEntryId, eventRosters.entryId))
        .where(eq(majorTournamentEntrants.seasonId, season.id)),
      db.query.majorFinalResults.findFirst({ where: eq(majorFinalResults.seasonId, season.id), columns: { status: true } }),
    ]);
    return { entrantCount: Number(counts?.count ?? 0), frozenEntrantCount: Number(counts?.frozen ?? 0),
      entrants: [], rosterRows: [], seedRows: [], state: undefined, qualification: undefined,
      seedRecommendation: { status: "missing" }, finalResultStatus: finalResult?.status ?? null };
  }
  const [state, entrants, rawRosterRows, seedRows, snapshot, finalResult, qualification] = await Promise.all([
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
      .where(eq(majorTournamentEntrants.seasonId, season.id)),
    db.select({ entrantId: majorTournamentEntrants.id, eventRosterId: eventRosterMembers.eventRosterId, userId: eventRosterMembers.userId, participantId: eventRosterMembers.participantId, displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName, email: users.email, educationVerificationId: eventRosterMembers.educationVerificationId, isPrimaryStarter: eventRosterMembers.isPrimaryStarter })
      .from(eventRosterMembers)
      .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
      .innerJoin(majorTournamentEntrants, eq(majorTournamentEntrants.competitionEntryId, eventRosters.entryId))
      .innerJoin(users, eq(eventRosterMembers.userId, users.id))
      .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
      .where(and(eq(majorTournamentEntrants.seasonId, season.id), eq(eventRosterMembers.isCurrent, true))),
    db.select({ teamId: majorTournamentEntrants.competitionEntryId, tournamentSeed: majorTournamentSeeds.seed })
      .from(majorTournamentSeeds)
      .innerJoin(majorTournamentEntrants, eq(majorTournamentSeeds.tournamentEntrantId, majorTournamentEntrants.id))
      .where(eq(majorTournamentSeeds.seasonId, season.id)),
    db.query.majorSeedRecommendationSnapshots.findFirst({ where: eq(majorSeedRecommendationSnapshots.seasonId, season.id) }),
    db.query.majorFinalResults.findFirst({ where: eq(majorFinalResults.seasonId, season.id), columns: { status: true } }),
    db.query.competitionQualificationRuns.findFirst({ where: eq(competitionQualificationRuns.seasonId, season.id), columns: { completedAt: true } }),
  ]);

  const rosterRows = rawRosterRows.map(({ displayName, perfectName, personaName, email, ...row }) => ({
    ...row,
    label: getDisplayName({ displayName, perfectName, personaName, email }),
  }));
  const recommendationStatus = getSeedRecommendationSnapshotStatus({ snapshot, seasonId: season.id,
    frozenSetFingerprint: buildFrozenSetFingerprint(season.id, frozenTeamsForSnapshot(entrants, rosterRows)) });
  return {
    entrantCount: entrants.length, frozenEntrantCount: entrants.filter(entrant => entrant.rosterStatus === "frozen").length,
    state,
    qualification,
    entrants,
    rosterRows,
    seedRows,
    seedRecommendation: { status: recommendationStatus },
    finalResultStatus: finalResult?.status ?? null,
  };
}

async function loadFormedTeamCount(season: Season): Promise<number> {
  return getApprovedCompetitionEntryCount(season.id);
}

export async function loadSeasonWorkspaceOverview(seasonSlug: string): Promise<SeasonWorkspaceOverviewData | null> {
  const season = await findAdminSeasonBySlug(seasonSlug);
  if (!season) return null;

  const includeReadiness = !["playing", "finished", "archived"].includes(season.status);
  const [registrationRows, matchCountRows, scheduledMatchRows, matchRosterRows, activeAdjudicationRows, formedTeamCount, majorFacts] = await Promise.all([
    loadRegistrationCounts(season),
    getOfficialSeasonMatchSummary(season.id).then(summary => [{ count: summary.total }]),
    db.select({ id: matches.id }).from(matches)
      .where(and(officialMatchCondition(), and(eq(matches.seasonId, season.id), eq(matches.status, "scheduled"), isNotNull(matches.scheduledAt)))),
    db.select({ matchId: matchRosters.matchId, status: matchRosters.status }).from(matchRosters)
      .innerJoin(matches, eq(matchRosters.matchId, matches.id))
      .where(and(officialMatchCondition(), and(eq(matches.seasonId, season.id), eq(matches.status, "scheduled"), isNotNull(matches.scheduledAt)))),
    db.select({ count: count() }).from(postEventAdjudications)
      .where(and(eq(postEventAdjudications.seasonId, season.id), eq(postEventAdjudications.status, "active"))),
    season.registrationMode === "solo" ? loadFormedTeamCount(season) : Promise.resolve(null),
    season.competitionTemplate === "major" ? loadMajorOverviewFacts(season, includeReadiness) : Promise.resolve(null),
  ]);

  const registrationSummary = projectRegistrationSummary(
    season.registrationMode,
    registrationRows.map((row) => ({ status: row.status, count: Number(row.count) })),
    formedTeamCount ?? 0,
  );
  const registrationFunnel = season.registrationMode === "team"
    ? projectTeamRegistrationFunnel(
      registrationRows.map((row) => ({ status: row.status, count: Number(row.count) })),
      { deadline: season.registrationClosesAt, windowPhase: getRegistrationWindowState(season).phase },
    )
    : null;
  const confirmedLineupsByMatch = new Map<string, number>();
  for (const row of matchRosterRows) {
    if (row.status === "confirmed") confirmedLineupsByMatch.set(row.matchId, (confirmedLineupsByMatch.get(row.matchId) ?? 0) + 1);
  }

  const summary: SeasonWorkspaceOverviewSummary = {
    ...registrationSummary,
    entrantCount: majorFacts?.entrantCount ?? 0,
    frozenEntrantCount: majorFacts?.frozenEntrantCount ?? 0,
    matchCount: Number(matchCountRows[0]?.count ?? 0),
    scheduledMatchesWithoutConfirmedLineups: scheduledMatchRows.filter((match) => (confirmedLineupsByMatch.get(match.id) ?? 0) < 2).length,
    finalResultPendingConfirmation: majorFacts?.finalResultStatus === "pending_confirmation",
    activeAdjudications: Number(activeAdjudicationRows[0]?.count ?? 0),
  };

  const readiness = majorFacts && includeReadiness
    ? buildMajorReadiness(season, majorFacts.state, majorFacts.entrants, majorFacts.rosterRows, majorFacts.seedRows, {
      seedRecommendation: majorFacts.seedRecommendation,
    })
    : null;

  const overviewSeason = {
    id: season.id,
    slug: season.slug,
    name: season.name,
    status: season.status,
    competitionTemplate: season.competitionTemplate,
    registrationMode: season.registrationMode,
    registrationOpenedAt: season.registrationOpenedAt,
    registrationOpensAt: season.registrationOpensAt,
    registrationClosesAt: season.registrationClosesAt,
    rosterChangeClosesAt: season.rosterChangeClosesAt,
    endAt: season.endAt,
  } satisfies SeasonWorkspaceOverviewData["season"];

  const majorDefinition = majorFacts && includeReadiness ? checkStandardMajorCapabilities(capabilitiesFromSeason(season)) : null;
  const prestartPhase = majorFacts && majorDefinition?.isStandardMajor ? deriveMajorPrestartPhase({
      registrationClosed: Boolean(season.registrationClosesAt && season.registrationClosesAt.getTime() <= Date.now()),
      approvedCandidateCount: summary.approvedEntries,
      pendingReviewCount: summary.pendingApplications,
      entrantCapacity: majorDefinition.entrantCapacity,
      entrantCount: summary.entrantCount,
      qualificationConfigured: Boolean(majorFacts.qualification),
      qualificationCompleted: Boolean(majorFacts.qualification?.completedAt),
      entrantsLocked: Boolean(majorFacts.state?.entrantsLockedAt),
      seedsConfirmed: Boolean(majorFacts.state?.seedsConfirmedAt && majorFacts.state.seedsConfirmedBy),
    }) : null;

  return {
    season: overviewSeason,
    summary,
    registrationFunnel,
    readiness,
    prestartPhase,
    nextAction: prestartPhase && !["playing", "finished", "archived"].includes(season.status) && summary.pendingApplications === 0
      ? { label: `继续${MAJOR_PRESTART_PHASES[prestartPhase - 1]}`, detail: "在完整筹备工作台中核对条件并继续办理。", href: `/admin/${season.slug}/prestart` }
      : selectSeasonWorkspaceNextAction(overviewSeason, summary, readiness),
  };
}
