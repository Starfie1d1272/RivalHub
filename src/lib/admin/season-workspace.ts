import "server-only";

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitionEntries,
  competitionEntryRosterMembers,
  competitionEntryRosterRevisions,
  eventRosterMembers,
  eventRosters,
  majorFinalResults,
  majorPrestartIssues,
  majorPrestartStates,
  majorStageRuns,
  majorTournamentEntrants,
  majorTournamentSeeds,
  matchRosters,
  matches,
  postEventAdjudications,
  seasons,
  tournamentHonors,
  users,
} from "@/db/schema";
import { evaluateMajorPrestartReadiness, type MajorPrestartReadiness } from "@/lib/major/prestart";
import type { Season } from "@/db/schema/seasons";
import { normalizeAffiliationRules, normalizeRegistrationConfig, normalizeStagePlan, normalizeTeamRegistrationConfig } from "@/types/season";

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

function majorReadiness(
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

export interface SeasonWorkspaceOverviewSummary {
  pendingApplications: number;
  approvedEntries: number;
  entrantCount: number;
  frozenEntrantCount: number;
  matchCount: number;
  stageRunCount: number;
  unresolvedPrestartIssues: number;
  scheduledMatchesWithoutConfirmedLineups: number;
  finalResultPendingConfirmation: boolean;
  activeAdjudications: number;
}

export interface SeasonWorkspaceNextAction {
  label: string;
  detail: string;
  href: string;
}

export interface SeasonWorkspaceOverviewData {
  season: Pick<Season, "id" | "slug" | "name" | "status" | "competitionTemplate" | "registrationOpenedAt" | "registrationOpensAt" | "registrationClosesAt" | "rosterChangeClosesAt" | "endAt">;
  summary: SeasonWorkspaceOverviewSummary;
  readiness: MajorPrestartReadiness | null;
  nextAction: SeasonWorkspaceNextAction;
}

function nextActionForOverview(
  season: Season,
  summary: SeasonWorkspaceOverviewSummary,
  readiness: MajorPrestartReadiness | null,
): SeasonWorkspaceNextAction {
  if (summary.pendingApplications > 0) {
    return {
      label: "处理报名审核",
      detail: `${summary.pendingApplications} 份报名等待管理员处理。`,
      href: `/admin/${season.slug}/registrations`,
    };
  }

  const blockedCheck = readiness?.checks.find((check) => check.state === "blocked");
  if (blockedCheck) {
    return {
      label: "处理赛前检查",
      detail: blockedCheck.blockers[0] ?? `${blockedCheck.label}尚未完成。`,
      href: `/admin/${season.slug}/prestart`,
    };
  }

  if (summary.scheduledMatchesWithoutConfirmedLineups > 0 || summary.matchCount > 0) {
    return {
      label: "查看比赛工作区",
      detail: summary.scheduledMatchesWithoutConfirmedLineups > 0
        ? `${summary.scheduledMatchesWithoutConfirmedLineups} 场已排期比赛等待名单确认。`
        : `${summary.matchCount} 场比赛已进入赛事工作区。`,
      href: `/admin/${season.slug}/matches`,
    };
  }

  if (summary.finalResultPendingConfirmation || summary.activeAdjudications > 0 || season.status === "finished") {
    return {
      label: "查看赛后工作区",
      detail: summary.finalResultPendingConfirmation
        ? "最终结果等待确认。"
        : summary.activeAdjudications > 0
          ? `${summary.activeAdjudications} 项赛后裁决仍在生效。`
          : "赛事已结束，可进行官方收尾。",
      href: `/admin/${season.slug}/post-event`,
    };
  }

  return {
    label: "查看赛事工作区",
    detail: season.status === "registration" && season.registrationOpenedAt === null
      ? "赛事已发布，但报名尚未实际开放。"
      : "从赛事工作区继续当前运营流程。",
    href: `/admin/${season.slug}/prestart`,
  };
}

export async function loadSeasonWorkspaceOverview(seasonSlug: string): Promise<SeasonWorkspaceOverviewData | null> {
  const season = await db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug) });
  if (!season) return null;

  const [pendingApplications, approvedEntries, entrantRows, rosterRows, issueRows, seedRows, state, matchRows, stageRunRows, scheduledMatchRows, matchRosterRows, finalResult, adjudicationRows] = await Promise.all([
    db.select({ id: competitionEntries.id }).from(competitionEntries)
      .where(and(eq(competitionEntries.competitionId, season.id), eq(competitionEntries.registrationStatus, "submitted"))),
    db.select({ id: competitionEntries.id }).from(competitionEntries)
      .where(and(eq(competitionEntries.competitionId, season.id), eq(competitionEntries.registrationStatus, "approved"))),
    db.select({
      id: majorTournamentEntrants.id,
      teamId: majorTournamentEntrants.competitionEntryId,
      rosterStatus: eventRosters.status,
    }).from(majorTournamentEntrants)
      .innerJoin(eventRosters, eq(majorTournamentEntrants.competitionEntryId, eventRosters.entryId))
      .where(eq(majorTournamentEntrants.seasonId, season.id)),
    db.select({ entrantId: majorTournamentEntrants.id, userId: eventRosterMembers.userId, educationVerificationId: eventRosterMembers.educationVerificationId })
      .from(eventRosterMembers)
      .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
      .innerJoin(majorTournamentEntrants, eq(majorTournamentEntrants.competitionEntryId, eventRosters.entryId))
      .where(eq(majorTournamentEntrants.seasonId, season.id)),
    db.select({ category: majorPrestartIssues.category, label: majorPrestartIssues.label, resolvedAt: majorPrestartIssues.resolvedAt })
      .from(majorPrestartIssues).where(eq(majorPrestartIssues.seasonId, season.id)),
    db.select({ teamId: majorTournamentEntrants.competitionEntryId, tournamentSeed: majorTournamentSeeds.seed })
      .from(majorTournamentSeeds)
      .innerJoin(majorTournamentEntrants, eq(majorTournamentSeeds.tournamentEntrantId, majorTournamentEntrants.id))
      .where(eq(majorTournamentSeeds.seasonId, season.id)),
    db.query.majorPrestartStates.findFirst({ where: eq(majorPrestartStates.seasonId, season.id) }),
    db.select({ id: matches.id }).from(matches).where(eq(matches.seasonId, season.id)),
    db.select({ id: majorStageRuns.id }).from(majorStageRuns).where(eq(majorStageRuns.seasonId, season.id)),
    db.select({ id: matches.id }).from(matches)
      .where(and(eq(matches.seasonId, season.id), eq(matches.ownership, "major_stage"), eq(matches.status, "scheduled"), isNotNull(matches.scheduledAt))),
    db.select({ matchId: matchRosters.matchId, status: matchRosters.status }).from(matchRosters)
      .innerJoin(matches, eq(matchRosters.matchId, matches.id))
      .where(and(eq(matches.seasonId, season.id), eq(matches.ownership, "major_stage"), eq(matches.status, "scheduled"), isNotNull(matches.scheduledAt))),
    db.query.majorFinalResults.findFirst({ where: eq(majorFinalResults.seasonId, season.id), columns: { status: true } }),
    db.select({ status: postEventAdjudications.status }).from(postEventAdjudications).where(eq(postEventAdjudications.seasonId, season.id)),
  ]);

  const confirmedLineupsByMatch = new Map<string, number>();
  for (const row of matchRosterRows) {
    if (row.status === "confirmed") confirmedLineupsByMatch.set(row.matchId, (confirmedLineupsByMatch.get(row.matchId) ?? 0) + 1);
  }
  const summary: SeasonWorkspaceOverviewSummary = {
    pendingApplications: pendingApplications.length,
    approvedEntries: approvedEntries.length,
    entrantCount: entrantRows.length,
    frozenEntrantCount: entrantRows.filter((entrant) => entrant.rosterStatus === "frozen").length,
    matchCount: matchRows.length,
    stageRunCount: stageRunRows.length,
    unresolvedPrestartIssues: issueRows.filter((issue) => !issue.resolvedAt).length,
    scheduledMatchesWithoutConfirmedLineups: scheduledMatchRows.filter((match) => (confirmedLineupsByMatch.get(match.id) ?? 0) < 2).length,
    finalResultPendingConfirmation: finalResult?.status === "pending_confirmation",
    activeAdjudications: adjudicationRows.filter((row) => row.status === "active").length,
  };

  const readiness = season.competitionTemplate === "major"
    ? majorReadiness(season, state, entrantRows, rosterRows, issueRows, seedRows)
    : null;

  return {
    season: {
      id: season.id,
      slug: season.slug,
      name: season.name,
      status: season.status,
      competitionTemplate: season.competitionTemplate,
      registrationOpenedAt: season.registrationOpenedAt,
      registrationOpensAt: season.registrationOpensAt,
      registrationClosesAt: season.registrationClosesAt,
      rosterChangeClosesAt: season.rosterChangeClosesAt,
      endAt: season.endAt,
    },
    summary,
    readiness,
    nextAction: nextActionForOverview(season, summary, readiness),
  };
}

export interface MajorPrestartPageData {
  season: Pick<Season, "id" | "name" | "competitionTemplate">;
  readiness: MajorPrestartReadiness;
  management: {
    seasonId: string;
    entrantsLocked: boolean;
    availableTeams: Array<{ id: string; name: string; members: Array<{ userId: string; email: string }> }>;
    entrants: Array<{
      id: string;
      teamId: string;
      teamName: string;
      rosterStatus: "preparing" | "confirmed" | "frozen";
      roster: Array<{ userId: string; email: string }>;
      candidates: Array<{ userId: string; email: string }>;
    }>;
    issues: Array<{ id: string; category: "qualification" | "administration"; label: string; resolved: boolean }>;
  };
  seedManagement: {
    seasonId: string;
    entrantsLocked: boolean;
    entrants: Array<{ teamId: string; teamName: string }>;
    seeds: Array<{ teamId: string; tournamentSeed: number }>;
    seedsConfirmed: boolean;
    firstRound: Array<{ higherSeed: number; lowerSeed: number; format: "bo1" | "bo3" }> | null;
  };
  started: boolean;
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

  const readiness = majorReadiness(season, state, entrantRows, rosterRows, issueRows, seedRows);
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

function placementGroupsForAdmin(value: unknown): Array<{ from: number; to: number; entryIds: string[] }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((group) => {
    if (!group || typeof group !== "object") return [];
    const candidate = group as { from?: unknown; to?: unknown; entryIds?: unknown };
    if (!Number.isInteger(candidate.from) || !Number.isInteger(candidate.to) || !Array.isArray(candidate.entryIds) || !candidate.entryIds.every((id) => typeof id === "string")) return [];
    return [{ from: candidate.from as number, to: candidate.to as number, entryIds: candidate.entryIds as string[] }];
  });
}

export interface PostEventPageData {
  season: Pick<Season, "id" | "name" | "status">;
  data: {
    seasonId: string;
    seasonStatus: string;
    finalResult: { id: string; status: "pending_confirmation" | "confirmed"; championEntryId: string; placementGroups: Array<{ from: number; to: number; entryIds: string[] }> } | null;
    teams: Array<{ id: string; name: string }>;
    honors: Array<{ id: string; honorKey: string; type: string; label: string; state: string; entryId: string | null; userId: string | null; placementFrom: number | null; placementTo: number | null }>;
    adjudications: Array<{ id: string; status: string; kind: string; target: string; impacts: string[]; targetEntryId: string | null; targetUserId: string | null; targetMatchId: string | null; reason: string; explanation: string; createdAt: Date }>;
  };
}

export async function loadPostEventPageData(season: Season): Promise<PostEventPageData> {
  const [seasonTeams, finalResult, honorRows, adjudicationRows] = await Promise.all([
    db.query.competitionEntries.findMany({
      where: eq(competitionEntries.competitionId, season.id),
      orderBy: [asc(competitionEntries.createdAt)],
      columns: { id: true, name: true },
    }),
    db.query.majorFinalResults.findFirst({ where: eq(majorFinalResults.seasonId, season.id) }),
    db.select({ id: tournamentHonors.id, honorKey: tournamentHonors.honorKey, type: tournamentHonors.type, label: tournamentHonors.label, state: tournamentHonors.state, entryId: tournamentHonors.entryId, userId: tournamentHonors.userId, placementFrom: tournamentHonors.placementFrom, placementTo: tournamentHonors.placementTo })
      .from(tournamentHonors).where(eq(tournamentHonors.seasonId, season.id)).orderBy(asc(tournamentHonors.createdAt)),
    db.select({ id: postEventAdjudications.id, status: postEventAdjudications.status, kind: postEventAdjudications.kind, target: postEventAdjudications.target, impacts: postEventAdjudications.impacts, targetEntryId: postEventAdjudications.targetEntryId, targetUserId: postEventAdjudications.targetUserId, targetMatchId: postEventAdjudications.targetMatchId, reason: postEventAdjudications.reason, explanation: postEventAdjudications.publicExplanation, createdAt: postEventAdjudications.createdAt })
      .from(postEventAdjudications).where(eq(postEventAdjudications.seasonId, season.id)).orderBy(asc(postEventAdjudications.createdAt)),
  ]);

  return {
    season: { id: season.id, name: season.name, status: season.status },
    data: {
      seasonId: season.id,
      seasonStatus: season.status,
      finalResult: finalResult ? {
        id: finalResult.id,
        status: finalResult.status,
        championEntryId: finalResult.championEntryId,
        placementGroups: placementGroupsForAdmin(finalResult.placementGroups),
      } : null,
      teams: seasonTeams,
      honors: honorRows,
      adjudications: adjudicationRows.map((row) => ({ ...row, impacts: row.impacts as string[] })),
    },
  };
}
