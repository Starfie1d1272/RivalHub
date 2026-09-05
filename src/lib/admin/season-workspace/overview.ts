import "server-only";

import { and, count, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitionEntries,
  eventRosterMembers,
  eventRosters,
  majorFinalResults,
  majorPrestartIssues,
  majorPrestartStates,
  majorSeedRecommendationSnapshots,
  majorTournamentEntrants,
  majorTournamentSeeds,
  matchRosters,
  matches,
  postEventAdjudications,
  seasons,
  seasonRegistrations,
} from "@/db/schema";
import type { Season } from "@/db/schema/seasons";
import { buildMajorReadiness } from "./major-prestart";
import { analyzeFinalSeedOrder } from "@/lib/major/team-seed-recommendation";
import { buildFrozenSetFingerprint, frozenTeamsForSnapshot, getSeedRecommendationSnapshotStatus } from "@/lib/major/seed-recommendation-snapshot";
import { projectRegistrationSummary, selectSeasonWorkspaceNextAction } from "./selectors";
import type { SeasonWorkspaceOverviewData, SeasonWorkspaceOverviewSummary } from "./types";

type MajorOverviewFacts = {
  entrants: Array<{ id: string; teamId: string; teamName: string | null; eventRosterId: string; sourceRosterRevisionId: string | null; rosterStatus: "preparing" | "confirmed" | "frozen" }>;
  rosterRows: Array<{ entrantId: string; eventRosterId: string; userId: string; participantId: string | null; educationVerificationId: string | null; isPrimaryStarter: boolean }>;
  issueRows: Array<{ category: "qualification" | "administration"; label: string; resolvedAt: Date | null }>;
  seedRows: Array<{ teamId: string; tournamentSeed: number }>;
  state: typeof majorPrestartStates.$inferSelect | undefined;
  seedRecommendation: { status: "missing" | "ready" | "mismatch" };
  seedOverride: { required: boolean; reason: string | null };
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

async function loadMajorOverviewFacts(season: Season): Promise<MajorOverviewFacts> {
  const [state, entrants, rosterRows, issueRows, seedRows, snapshot, finalResult] = await Promise.all([
    db.query.majorPrestartStates.findFirst({ where: eq(majorPrestartStates.seasonId, season.id) }),
    db.select({
      id: majorTournamentEntrants.id,
      teamId: majorTournamentEntrants.competitionEntryId,
      teamName: competitionEntries.name,
      eventRosterId: eventRosters.id,
      sourceRosterRevisionId: eventRosters.sourceRosterRevisionId,
      rosterStatus: eventRosters.status,
    }).from(majorTournamentEntrants)
      .innerJoin(eventRosters, eq(majorTournamentEntrants.competitionEntryId, eventRosters.entryId))
      .where(eq(majorTournamentEntrants.seasonId, season.id)),
    db.select({ entrantId: majorTournamentEntrants.id, eventRosterId: eventRosterMembers.eventRosterId, userId: eventRosterMembers.userId, participantId: eventRosterMembers.participantId, educationVerificationId: eventRosterMembers.educationVerificationId, isPrimaryStarter: eventRosterMembers.isPrimaryStarter })
      .from(eventRosterMembers)
      .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
      .innerJoin(majorTournamentEntrants, eq(majorTournamentEntrants.competitionEntryId, eventRosters.entryId))
      .where(eq(majorTournamentEntrants.seasonId, season.id)),
    db.select({ category: majorPrestartIssues.category, label: majorPrestartIssues.label, resolvedAt: majorPrestartIssues.resolvedAt })
      .from(majorPrestartIssues)
      .where(eq(majorPrestartIssues.seasonId, season.id)),
    db.select({ teamId: majorTournamentEntrants.competitionEntryId, tournamentSeed: majorTournamentSeeds.seed })
      .from(majorTournamentSeeds)
      .innerJoin(majorTournamentEntrants, eq(majorTournamentSeeds.tournamentEntrantId, majorTournamentEntrants.id))
      .where(eq(majorTournamentSeeds.seasonId, season.id)),
    db.query.majorSeedRecommendationSnapshots.findFirst({ where: eq(majorSeedRecommendationSnapshots.seasonId, season.id) }),
    db.query.majorFinalResults.findFirst({ where: eq(majorFinalResults.seasonId, season.id), columns: { status: true } }),
  ]);

  const frozenTeams = frozenTeamsForSnapshot(entrants, rosterRows);
  const frozenSetFingerprint = buildFrozenSetFingerprint(season.id, frozenTeams);
  const recommendationStatus = getSeedRecommendationSnapshotStatus({ snapshot, seasonId: season.id, frozenSetFingerprint });
  const seedDecision = recommendationStatus === "ready" && snapshot
    ? analyzeFinalSeedOrder(seedRows.map((seed) => seed.teamId), snapshot.recommendations)
    : null;
  return {
    state,
    entrants,
    rosterRows,
    issueRows,
    seedRows,
    seedRecommendation: { status: recommendationStatus },
    seedOverride: { required: seedDecision?.divergesFromRecommendation ?? false, reason: state?.seedOverrideReason ?? null },
    finalResultStatus: finalResult?.status ?? null,
  };
}

async function loadFormedTeamCount(season: Season): Promise<number> {
  const [row] = await db.select({ count: count() }).from(competitionEntries)
    .where(and(eq(competitionEntries.competitionId, season.id), eq(competitionEntries.registrationStatus, "approved")));
  return Number(row?.count ?? 0);
}

export async function loadSeasonWorkspaceOverview(seasonSlug: string): Promise<SeasonWorkspaceOverviewData | null> {
  const season = await db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug) });
  if (!season) return null;

  const [registrationRows, matchCountRows, scheduledMatchRows, matchRosterRows, activeAdjudicationRows, formedTeamCount, majorFacts] = await Promise.all([
    loadRegistrationCounts(season),
    db.select({ count: count() }).from(matches).where(eq(matches.seasonId, season.id)),
    db.select({ id: matches.id }).from(matches)
      .where(and(eq(matches.seasonId, season.id), eq(matches.status, "scheduled"), isNotNull(matches.scheduledAt))),
    db.select({ matchId: matchRosters.matchId, status: matchRosters.status }).from(matchRosters)
      .innerJoin(matches, eq(matchRosters.matchId, matches.id))
      .where(and(eq(matches.seasonId, season.id), eq(matches.status, "scheduled"), isNotNull(matches.scheduledAt))),
    db.select({ count: count() }).from(postEventAdjudications)
      .where(and(eq(postEventAdjudications.seasonId, season.id), eq(postEventAdjudications.status, "active"))),
    season.registrationMode === "solo" ? loadFormedTeamCount(season) : Promise.resolve(null),
    season.competitionTemplate === "major" ? loadMajorOverviewFacts(season) : Promise.resolve(null),
  ]);

  const registrationSummary = projectRegistrationSummary(
    season.registrationMode,
    registrationRows.map((row) => ({ status: row.status, count: Number(row.count) })),
    formedTeamCount ?? 0,
  );
  const confirmedLineupsByMatch = new Map<string, number>();
  for (const row of matchRosterRows) {
    if (row.status === "confirmed") confirmedLineupsByMatch.set(row.matchId, (confirmedLineupsByMatch.get(row.matchId) ?? 0) + 1);
  }

  const summary: SeasonWorkspaceOverviewSummary = {
    ...registrationSummary,
    entrantCount: majorFacts?.entrants.length ?? (season.registrationMode === "team" ? registrationSummary.formedTeamCount : 0),
    frozenEntrantCount: majorFacts?.entrants.filter((entrant) => entrant.rosterStatus === "frozen").length ?? (season.registrationMode === "team" ? registrationSummary.formedTeamCount : 0),
    matchCount: Number(matchCountRows[0]?.count ?? 0),
    unresolvedPrestartIssues: majorFacts?.issueRows.filter((issue) => !issue.resolvedAt).length ?? 0,
    scheduledMatchesWithoutConfirmedLineups: scheduledMatchRows.filter((match) => (confirmedLineupsByMatch.get(match.id) ?? 0) < 2).length,
    finalResultPendingConfirmation: majorFacts?.finalResultStatus === "pending_confirmation",
    activeAdjudications: Number(activeAdjudicationRows[0]?.count ?? 0),
  };

  const readiness = majorFacts
    ? buildMajorReadiness(season, majorFacts.state, majorFacts.entrants, majorFacts.rosterRows, majorFacts.issueRows, majorFacts.seedRows, {
      seedRecommendation: majorFacts.seedRecommendation,
      seedOverride: majorFacts.seedOverride,
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

  return {
    season: overviewSeason,
    summary,
    readiness,
    nextAction: selectSeasonWorkspaceNextAction(overviewSeason, summary, readiness),
  };
}
