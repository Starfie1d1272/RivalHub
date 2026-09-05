import "server-only";

import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitionEntries,
  competitionEntryRosterMembers,
  competitionEntryRosterRevisions,
  eventRosterMembers,
  eventRosters,
  majorPrestartIssues,
  majorPrestartStates,
  majorStageRuns,
  majorTournamentEntrants,
  majorTournamentSeeds,
  users,
} from "@/db/schema";
import { evaluateMajorPrestartReadiness, type MajorPrestartReadiness } from "@/lib/major/prestart";
import type { Season } from "@/db/schema/seasons";
import { normalizeAffiliationRules, normalizeRegistrationConfig, normalizeStagePlan, normalizeTeamRegistrationConfig } from "@/types/season";
import type { MajorPrestartPageData } from "./types";

type MajorEntrantRow = {
  id: string;
  teamId: string;
  teamName?: string;
  rosterStatus: "preparing" | "confirmed" | "frozen";
};

type MajorRosterMemberRow = {
  entrantId: string;
  userId: string;
  email?: string;
  educationVerificationId: string | null;
};

type MajorIssueRow = {
  id?: string;
  category: "qualification" | "administration";
  label: string;
  resolvedAt: Date | null;
};

type MajorSeedRow = { teamId: string; tournamentSeed: number };

export function buildMajorReadiness(
  season: Season,
  state: typeof majorPrestartStates.$inferSelect | undefined,
  entrants: readonly MajorEntrantRow[],
  rosterRows: readonly MajorRosterMemberRow[],
  issueRows: readonly MajorIssueRow[],
  seedRows: readonly MajorSeedRow[],
): MajorPrestartReadiness {
  const entrantIds = new Set(entrants.map((entrant) => entrant.id));
  const rosterByEntrant = new Map<string, MajorRosterMemberRow[]>();
  for (const member of rosterRows) {
    if (!entrantIds.has(member.entrantId)) continue;
    const roster = rosterByEntrant.get(member.entrantId) ?? [];
    roster.push(member);
    rosterByEntrant.set(member.entrantId, roster);
  }

  return evaluateMajorPrestartReadiness({
    competitionTemplate: season.competitionTemplate,
    capabilities: {
      registrationMode: season.registrationMode,
      hasCaptainVoting: season.hasCaptainVoting,
      hasDraft: season.hasDraft,
      hasCommunityAwards: season.hasCommunityAwards,
      stagePlan: normalizeStagePlan(season.stagePlan),
      registrationConfig: normalizeRegistrationConfig(season.registrationConfig),
      teamRegistrationConfig: normalizeTeamRegistrationConfig(season.teamRegistrationConfig),
      affiliationRules: normalizeAffiliationRules(season.affiliationRules),
      minTeamSize: season.minTeamSize,
      maxTeamSize: season.maxTeamSize,
      starterCount: season.starterCount,
      positions: season.positions,
    },
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
  });
}

export async function loadMajorPrestartPageData(season: Season): Promise<MajorPrestartPageData> {
  const seasonTeams = await db.query.competitionEntries.findMany({
    where: eq(competitionEntries.competitionId, season.id),
    orderBy: [asc(competitionEntries.createdAt)],
    columns: { id: true, name: true },
  });
  const teamIds = seasonTeams.map((team) => team.id);
  const formalMembers = teamIds.length === 0 ? [] : await db
    .select({ teamId: competitionEntryRosterRevisions.entryId, userId: competitionEntryRosterMembers.userId, email: users.email })
    .from(competitionEntryRosterMembers)
    .innerJoin(competitionEntryRosterRevisions, eq(competitionEntryRosterMembers.revisionId, competitionEntryRosterRevisions.id))
    .innerJoin(users, eq(competitionEntryRosterMembers.userId, users.id))
    .where(inArray(competitionEntryRosterRevisions.entryId, teamIds));
  const candidatesByTeam = new Map<string, Array<{ userId: string; email: string }>>();
  for (const member of formalMembers) {
    const candidates = candidatesByTeam.get(member.teamId) ?? [];
    candidates.push({ userId: member.userId, email: member.email });
    candidatesByTeam.set(member.teamId, candidates);
  }

  const [state, entrantRows, rosterRows, issueRows, seedRows, stageRunRows] = await Promise.all([
    db.query.majorPrestartStates.findFirst({ where: eq(majorPrestartStates.seasonId, season.id) }),
    db.select({
      id: majorTournamentEntrants.id,
      teamId: majorTournamentEntrants.competitionEntryId,
      teamName: competitionEntries.name,
      rosterStatus: eventRosters.status,
    }).from(majorTournamentEntrants)
      .innerJoin(competitionEntries, eq(majorTournamentEntrants.competitionEntryId, competitionEntries.id))
      .innerJoin(eventRosters, eq(majorTournamentEntrants.competitionEntryId, eventRosters.entryId))
      .where(eq(majorTournamentEntrants.seasonId, season.id))
      .orderBy(asc(competitionEntries.name)),
    db.select({ entrantId: majorTournamentEntrants.id, userId: eventRosterMembers.userId, email: users.email, educationVerificationId: eventRosterMembers.educationVerificationId })
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
    db.select({ id: majorStageRuns.id }).from(majorStageRuns).where(eq(majorStageRuns.seasonId, season.id)),
  ]);

  const readiness = buildMajorReadiness(season, state, entrantRows, rosterRows, issueRows, seedRows);
  const entrantIds = new Set(entrantRows.map((entrant) => entrant.id));
  const rosterByEntrant = new Map<string, Array<{ userId: string; email: string; educationVerificationId: string | null }>>();
  for (const member of rosterRows) {
    if (!entrantIds.has(member.entrantId)) continue;
    const roster = rosterByEntrant.get(member.entrantId) ?? [];
    roster.push({ userId: member.userId, email: member.email ?? "", educationVerificationId: member.educationVerificationId });
    rosterByEntrant.set(member.entrantId, roster);
  }

  return {
    season: { id: season.id, name: season.name, competitionTemplate: season.competitionTemplate },
    readiness,
    management: {
      seasonId: season.id,
      entrantsLocked: Boolean(state?.entrantsLockedAt),
      availableTeams: seasonTeams.filter((team) => !entrantRows.some((entrant) => entrant.teamId === team.id)).map((team) => ({
        id: team.id,
        name: team.name,
        members: candidatesByTeam.get(team.id) ?? [],
      })),
      entrants: entrantRows.map((entrant) => ({
        ...entrant,
        roster: (rosterByEntrant.get(entrant.id) ?? []).map((member) => ({ userId: member.userId, email: member.email })),
        candidates: candidatesByTeam.get(entrant.teamId) ?? [],
      })),
      issues: issueRows.map((issue) => ({ id: issue.id, category: issue.category, label: issue.label, resolved: Boolean(issue.resolvedAt) })),
    },
    seedManagement: {
      seasonId: season.id,
      entrantsLocked: Boolean(state?.entrantsLockedAt),
      entrants: entrantRows.map((entrant) => ({ teamId: entrant.teamId, teamName: entrant.teamName ?? entrant.teamId })),
      seeds: seedRows,
      seedsConfirmed: Boolean(state?.seedsConfirmedAt && state.seedsConfirmedBy),
      firstRound: readiness.openingPlan?.firstRound.pairings.map((pairing) => ({
        higherSeed: pairing.higherSeed.tournamentSeed,
        lowerSeed: pairing.lowerSeed.tournamentSeed,
        format: pairing.format,
      })) ?? null,
    },
    started: stageRunRows.length > 0,
  };
}
