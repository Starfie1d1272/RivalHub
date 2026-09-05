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
  majorStageRuns,
  majorTournamentEntrants,
  majorTournamentSeeds,
  users,
} from "@/db/schema";
import { evaluateMajorPrestartReadiness, type MajorPrestartReadiness } from "@/lib/major/prestart";
import { capabilitiesFromSeason } from "@/lib/competition/definition";
import { getStandardMajorDefinition } from "@/lib/major/standard";
import { getDisplayName } from "@/lib/identity/display-name";
import type { Season } from "@/db/schema/seasons";
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

  const [state, entrantRows, rosterRows, issueRows, seedRows, stageRunRows] = await Promise.all([
    db.query.majorPrestartStates.findFirst({ where: eq(majorPrestartStates.seasonId, season.id) }),
    db.select({
      id: majorTournamentEntrants.id,
      teamId: majorTournamentEntrants.competitionEntryId,
      teamName: competitionEntries.name,
      rosterStatus: eventRosters.status,
      sourceRosterRevisionId: eventRosters.sourceRosterRevisionId,
    }).from(majorTournamentEntrants)
      .innerJoin(competitionEntries, eq(majorTournamentEntrants.competitionEntryId, competitionEntries.id))
      .innerJoin(eventRosters, eq(majorTournamentEntrants.competitionEntryId, eventRosters.entryId))
      .where(eq(majorTournamentEntrants.seasonId, season.id))
      .orderBy(asc(competitionEntries.name)),
    db.select({ entrantId: majorTournamentEntrants.id, userId: eventRosterMembers.userId, email: users.email, educationVerificationId: eventRosterMembers.educationVerificationId, isPrimaryStarter: eventRosterMembers.isPrimaryStarter })
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
      firstRound: readiness.openingPlan?.firstRound.pairings.map((pairing) => ({
        higherSeed: pairing.higherSeed.tournamentSeed,
        lowerSeed: pairing.lowerSeed.tournamentSeed,
        format: pairing.format,
      })) ?? null,
    },
    started: stageRunRows.length > 0,
  };
}
