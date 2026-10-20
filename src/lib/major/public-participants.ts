import { getOfficialSeasonMatchSummary } from "@/lib/matches/read-official";
import { hasActivePublicSanction } from "@/lib/discipline/public-query";
import "server-only";

import { and, asc, count, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { publicCompetitionEntryIdentityCondition } from "@/lib/competition-entries/public-visibility";
import {
  competitionEntries,
  competitionEntryRosterMembers,
  competitionEntryRosterRevisions,
  eventRosterMembers,
  eventRosters,
  majorPrestartStates,
  majorTournamentEntrants,
  majorTournamentSeeds,
  steamProfiles,
  users,
} from "@/db/schema";
import {
  createEmptyPublicEventTeamRecord,
  getPublicEventTeamMatchFacts,
  getPublicEventTeamMatchSummary,
  type PublicEventTeamContext,
  type PublicEventTeamSummary,
} from "@/lib/competition-entries/public-team-context";
import type { PublicSeason } from "@/lib/data/public-seasons";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { getStandardMajorDefinition } from "@/lib/major/standard";

export type MajorPublicParticipantSeason = Pick<
  PublicSeason,
  | "id"
  | "slug"
  | "name"
  | "status"
  | "competitionTemplate"
  | "registrationMode"
  | "hasCaptainVoting"
  | "hasDraft"
  | "hasCommunityAwards"
  | "stagePlan"
  | "registrationConfig"
  | "teamRegistrationConfig"
  | "affiliationRules"
  | "minTeamSize"
  | "maxTeamSize"
  | "starterCount"
  | "positions"
>;

export type MajorPublicParticipantPhase =
  | "approved_candidates"
  | "final_entrants"
  | "rosters_frozen";

export interface MajorPublicParticipantPresentation {
  teamCollectionLabel: string;
  teamCollectionDescription: string;
}

export interface MajorPublicParticipantOverview {
  phase: MajorPublicParticipantPhase;
  presentation: MajorPublicParticipantPresentation;
  entrantCapacity: number;
  approvedCandidateCount: number;
  officialEntrantCount: number;
  teamCount: number;
  playerCount: number;
}

export interface MajorPublicParticipantSummary extends MajorPublicParticipantOverview {
  teams: PublicEventTeamSummary[];
  matchCount: number;
  finishedMatchCount: number;
}

type RosterMemberRow = {
  entryId: string;
  avatarUrl: string | null;
  hasActivePublicSanction?: boolean;
  userId: string;
  displayName: string | null;
  perfectName: string | null;
  personaName: string | null;
  isStarter: boolean;
};

type EventRosterFact = {
  entryId: string;
  status: "preparing" | "confirmed" | "frozen";
};

type MajorPublicParticipantTeamBase = Omit<PublicEventTeamSummary, "record">;

interface MajorPublicParticipantState extends MajorPublicParticipantOverview {
  approvedEntryIds: string[];
  officialEntryIds: string[];
  officialSetComplete: boolean;
  visibleEntryIds: string[];
  teams: MajorPublicParticipantTeamBase[];
}

export interface MajorPublicParticipantLifecycleFacts {
  entrantCapacity: number;
  approvedEntryIds: readonly string[];
  officialEntryIds: readonly string[];
  eventRosterFacts: readonly EventRosterFact[];
  entrantsLockedAt: Date | null;
}

export interface MajorPublicParticipantLifecycleResolution {
  phase: MajorPublicParticipantPhase;
  officialSetComplete: boolean;
}

export function resolveMajorPublicParticipantLifecycle(
  facts: MajorPublicParticipantLifecycleFacts,
): MajorPublicParticipantLifecycleResolution {
  const approvedEntryIdSet = new Set(facts.approvedEntryIds);
  const officialEntryIdSet = new Set(facts.officialEntryIds);
  const officialSetComplete = facts.officialEntryIds.length === facts.entrantCapacity &&
    officialEntryIdSet.size === facts.entrantCapacity &&
    facts.officialEntryIds.every((entryId) => approvedEntryIdSet.has(entryId));
  const eventRosterByEntryId = new Map(facts.eventRosterFacts.map((roster) => [roster.entryId, roster]));
  const allSelectedRostersFrozen = officialSetComplete &&
    facts.officialEntryIds.length === facts.eventRosterFacts.length &&
    facts.officialEntryIds.every((entryId) => eventRosterByEntryId.get(entryId)?.status === "frozen");

  return {
    phase: allSelectedRostersFrozen && facts.entrantsLockedAt
      ? "rosters_frozen"
      : officialSetComplete
        ? "final_entrants"
        : "approved_candidates",
    officialSetComplete,
  };
}

export interface MajorPublicParticipantSeedResolutionInput {
  entrantCapacity: number;
  officialEntryIds: readonly string[];
  seedsConfirmedAt: Date | null;
  seedRows: readonly { entryId: string; seed: number }[];
}

/** Return official seeds only when the confirmed set is complete and valid. */
export function resolveConfirmedMajorSeeds(
  input: MajorPublicParticipantSeedResolutionInput,
): Map<string, number> | null {
  if (!input.seedsConfirmedAt || input.officialEntryIds.length !== input.entrantCapacity) return null;

  const officialEntryIdSet = new Set(input.officialEntryIds);
  const seedEntryIds = new Set(input.seedRows.map((row) => row.entryId));
  const seedNumbers = new Set(input.seedRows.map((row) => row.seed));
  const complete = officialEntryIdSet.size === input.entrantCapacity &&
    input.seedRows.length === input.entrantCapacity &&
    seedEntryIds.size === input.entrantCapacity &&
    seedNumbers.size === input.entrantCapacity &&
    input.seedRows.every((row) => officialEntryIdSet.has(row.entryId) &&
      Number.isInteger(row.seed) && row.seed >= 1 && row.seed <= input.entrantCapacity);

  return complete ? new Map(input.seedRows.map((row) => [row.entryId, row.seed])) : null;
}

export function presentMajorPublicParticipantPhase(
  phase: MajorPublicParticipantPhase,
): MajorPublicParticipantPresentation {
  switch (phase) {
    case "rosters_frozen":
      return {
        teamCollectionLabel: "正式参赛队",
        teamCollectionDescription: "本届正式参赛队及最终参赛名单已经确认。",
      };
    case "final_entrants":
      return {
        teamCollectionLabel: "正式参赛队",
        teamCollectionDescription: "本届正式参赛队已经确定，参赛名单仍可能调整。",
      };
    case "approved_candidates":
      return {
        teamCollectionLabel: "已通过报名审核的队伍",
        teamCollectionDescription: "以下队伍已通过报名审核，正赛资格由赛委会确认。",
      };
  }
}

function addToMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}

function publicRosterMember(row: RosterMemberRow) {
  return {
    userId: row.userId,
    name: getPublicDisplayName(row),
    avatarUrl: row.avatarUrl ?? null,
    hasActivePublicSanction: row.hasActivePublicSanction ?? false,
    isStarter: row.isStarter,
  };
}

async function loadMajorPublicParticipantDirectory(season: MajorPublicParticipantSeason): Promise<Awaited<ReturnType<typeof loadMajorPublicParticipantDirectoryFull>>>;
async function loadMajorPublicParticipantDirectory(season: MajorPublicParticipantSeason, idsOnly: true): Promise<Awaited<ReturnType<typeof loadMajorPublicParticipantDirectoryIds>>>;
async function loadMajorPublicParticipantDirectory(season: MajorPublicParticipantSeason, idsOnly = false) {
  return idsOnly ? loadMajorPublicParticipantDirectoryIds(season) : loadMajorPublicParticipantDirectoryFull(season);
}

function loadMajorPublicParticipantDirectoryFull(season: MajorPublicParticipantSeason) {
  return loadMajorPublicParticipantDirectoryWithEntries(season, db
    .select({
      id: competitionEntries.id,
      name: competitionEntries.name,
      logoUrl: competitionEntries.logoUrl,
      registrationStatus: competitionEntries.registrationStatus,
      representativeUserId: competitionEntries.representativeUserId,
      teamId: competitionEntries.teamId,
    })
    .from(competitionEntries)
    .where(and(eq(competitionEntries.competitionId, season.id), publicCompetitionEntryIdentityCondition()))
    .orderBy(asc(competitionEntries.formationOrder), asc(competitionEntries.id)));
}

function loadMajorPublicParticipantDirectoryIds(season: MajorPublicParticipantSeason) {
  return loadMajorPublicParticipantDirectoryWithEntries(season, db
    .select({ id: competitionEntries.id, registrationStatus: competitionEntries.registrationStatus })
    .from(competitionEntries)
    .where(and(eq(competitionEntries.competitionId, season.id), publicCompetitionEntryIdentityCondition()))
    .orderBy(asc(competitionEntries.formationOrder), asc(competitionEntries.id)));
}

async function loadMajorPublicParticipantDirectoryWithEntries<T extends { id: string; registrationStatus: string }>(
  season: MajorPublicParticipantSeason,
  approvedEntriesQuery: Promise<T[]>,
) {
  const { entrantCapacity } = getStandardMajorDefinition(season);
  const [approvedEntries, entrantRefs, prestartState] = await Promise.all([
    approvedEntriesQuery,
    db
      .select({
        entryId: majorTournamentEntrants.competitionEntryId,
      })
      .from(majorTournamentEntrants)
      .where(eq(majorTournamentEntrants.seasonId, season.id))
      .orderBy(asc(majorTournamentEntrants.id)),
    db.query.majorPrestartStates.findFirst({
      where: eq(majorPrestartStates.seasonId, season.id),
      columns: { entrantsLockedAt: true, seedsConfirmedAt: true },
    }),
  ]);

  const approvedEntryIds = approvedEntries.map((entry) => entry.id);
  const amendingEntryIds = approvedEntries.filter((entry) => entry.registrationStatus !== "approved").map((entry) => entry.id);
  const officialEntryIds = entrantRefs.map((entrant) => entrant.entryId);
  const eventRosterFacts = officialEntryIds.length
    ? await db.select({ entryId: eventRosters.entryId, status: eventRosters.status })
      .from(eventRosters)
      .where(inArray(eventRosters.entryId, officialEntryIds))
      .orderBy(asc(eventRosters.entryId))
    : [] as EventRosterFact[];
  const lifecycle = resolveMajorPublicParticipantLifecycle({
    entrantCapacity,
    approvedEntryIds,
    officialEntryIds,
    eventRosterFacts,
    entrantsLockedAt: prestartState?.entrantsLockedAt ?? null,
  });
  const approvedEntryIdSet = new Set(approvedEntryIds);
  const visibleEntryIds = lifecycle.officialSetComplete
    ? officialEntryIds.filter((entryId) => approvedEntryIdSet.has(entryId))
    : approvedEntryIds;
  const presentation = presentMajorPublicParticipantPhase(lifecycle.phase);
  return { entrantCapacity, approvedEntries, approvedEntryIds, amendingEntryIds, officialEntryIds, prestartState, eventRosterFacts, lifecycle, visibleEntryIds, presentation };
}

function approvedRosterQuery(entryIds: string[]) {
  return db.select({
    entryId: competitionEntries.id,
    userId: competitionEntryRosterMembers.userId,
    displayName: users.displayName,
    perfectName: users.perfectName,
    personaName: steamProfiles.personaName,
    avatarUrl: steamProfiles.avatarUrl,
    hasActivePublicSanction: hasActivePublicSanction(users.id),
    isStarter: competitionEntryRosterMembers.isPrimaryStarter,
  }).from(competitionEntryRosterMembers)
    .innerJoin(competitionEntryRosterRevisions, eq(competitionEntryRosterRevisions.id, competitionEntryRosterMembers.revisionId))
    .innerJoin(competitionEntries, eq(competitionEntries.approvedRosterRevisionId, competitionEntryRosterRevisions.id))
    .innerJoin(users, eq(users.id, competitionEntryRosterMembers.userId))
    .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
    .where(and(inArray(competitionEntries.id, entryIds), eq(competitionEntryRosterRevisions.status, "approved")));
}

function eventRosterQuery(entryIds: string[]) {
  return db.select({
    entryId: eventRosters.entryId,
    userId: eventRosterMembers.userId,
    displayName: users.displayName,
    perfectName: users.perfectName,
    personaName: steamProfiles.personaName,
    avatarUrl: steamProfiles.avatarUrl,
    hasActivePublicSanction: hasActivePublicSanction(users.id),
    isStarter: eventRosterMembers.isPrimaryStarter,
  }).from(eventRosterMembers)
    .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
    .innerJoin(users, eq(users.id, eventRosterMembers.userId))
    .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
    .where(and(inArray(eventRosters.entryId, entryIds), eq(eventRosterMembers.isCurrent, true)));
}

async function loadMajorPublicParticipantState(
  season: MajorPublicParticipantSeason,
  options: { entryId?: string } = {},
): Promise<MajorPublicParticipantState> {
  const { entrantCapacity, approvedEntries, approvedEntryIds, amendingEntryIds, officialEntryIds, prestartState, eventRosterFacts, lifecycle, visibleEntryIds, presentation } = await loadMajorPublicParticipantDirectory(season);
  const officialEntryIdSet = new Set(officialEntryIds);
  const amendingEntryIdSet = new Set(amendingEntryIds);
  const lifecycleEntryIds = options.entryId
    ? approvedEntryIds.filter((entryId) => entryId === options.entryId)
    : approvedEntryIds;
  // Match the roster source consumed below, including approved teams that were
  // not selected and remain accessible through their individual detail pages.
  const eventMemberEntryIds = lifecycle.officialSetComplete
    ? lifecycleEntryIds.filter((entryId) => officialEntryIdSet.has(entryId) && !amendingEntryIdSet.has(entryId))
    : [];
  const approvedMemberEntryIds = lifecycle.officialSetComplete
    ? lifecycleEntryIds.filter((entryId) => !officialEntryIdSet.has(entryId) || amendingEntryIdSet.has(entryId))
    : lifecycleEntryIds;

  // Roster membership is an event fact; a later user merge must not erase it from the public record.
  const [approvedRosterRows, eventRosterMembersRows, seedRows] = await Promise.all([
    approvedMemberEntryIds.length
      ? approvedRosterQuery(approvedMemberEntryIds)
        .orderBy(asc(competitionEntries.id), asc(users.id))
      : Promise.resolve([] as RosterMemberRow[]),
    eventMemberEntryIds.length
      ? eventRosterQuery(eventMemberEntryIds)
        .orderBy(asc(eventRosters.entryId), asc(users.id))
      : Promise.resolve([] as RosterMemberRow[]),
    db
      .select({
        entryId: majorTournamentEntrants.competitionEntryId,
        seed: majorTournamentSeeds.seed,
      })
      .from(majorTournamentSeeds)
      .innerJoin(majorTournamentEntrants, eq(majorTournamentEntrants.id, majorTournamentSeeds.tournamentEntrantId))
      .where(eq(majorTournamentSeeds.seasonId, season.id)),
  ]);

  const confirmedSeeds = lifecycle.officialSetComplete
    ? resolveConfirmedMajorSeeds({
      entrantCapacity,
      officialEntryIds,
      seedsConfirmedAt: prestartState?.seedsConfirmedAt ?? null,
      seedRows,
    })
    : null;
  const seedByEntryId = confirmedSeeds ?? new Map<string, number>();
  const eventRosterByEntryId = new Map(eventRosterFacts.map((roster) => [roster.entryId, roster]));
  const approvedMembersByEntryId = new Map<string, RosterMemberRow[]>();
  for (const row of approvedRosterRows) addToMap(approvedMembersByEntryId, row.entryId, row);
  const eventMembersByEntryId = new Map<string, RosterMemberRow[]>();
  for (const row of eventRosterMembersRows) addToMap(eventMembersByEntryId, row.entryId, row);
  const requestedEntries = approvedEntries.filter((entry) => lifecycleEntryIds.includes(entry.id));
  const teams = requestedEntries.map((entry) => {
    const isOfficial = lifecycle.officialSetComplete && officialEntryIdSet.has(entry.id);
    const isAmending = amendingEntryIdSet.has(entry.id);
    const roster = isOfficial && !isAmending
      ? (eventMembersByEntryId.get(entry.id) ?? [])
      : (approvedMembersByEntryId.get(entry.id) ?? []);
    const seed = isOfficial ? (seedByEntryId.get(entry.id) ?? null) : null;
    const seedPresentation = isOfficial
      ? seed === null
        ? { label: "种子待确认", tone: "neutral" as const }
        : { label: `#${seed} 种子`, tone: "success" as const }
      : null;
    const participation: PublicEventTeamContext["participation"] = isOfficial
      ? {
        label: "正式参赛队",
        tone: "success",
        detail: lifecycle.phase === "rosters_frozen"
          ? "已进入本届正式参赛队，最终参赛名单已经确认。"
          : "已进入本届正式参赛队，当前参赛名单仍可能调整。",
      }
      : {
        label: "已通过报名审核",
        tone: "info",
        detail: lifecycle.officialSetComplete
          ? "已通过报名审核，但未进入本届正式参赛名单。"
          : "已通过报名审核，正赛资格待确认。",
      };

    return {
      season: {
        id: season.id,
        slug: season.slug,
        name: season.name,
        status: season.status,
      },
      entry: {
        id: entry.id,
        name: entry.name,
        logoUrl: entry.logoUrl,
        registrationStatus: entry.registrationStatus,
        representativeUserId: entry.representativeUserId,
        teamId: entry.teamId,
      },
      participation,
      roster: roster.map(publicRosterMember),
      rosterLabel: isOfficial && !isAmending
        ? lifecycle.phase === "rosters_frozen" ? "最终参赛名单" : "当前参赛名单"
        : "已审核报名名单",
      rosterStatus: isOfficial ? (eventRosterByEntryId.get(entry.id)?.status ?? null) : null,
      seed,
      seedPresentation,
    } satisfies MajorPublicParticipantTeamBase;
  });
  const visibleTeams = teams.filter((team) => visibleEntryIds.includes(team.entry.id));

  return {
    phase: lifecycle.phase,
    presentation,
    entrantCapacity,
    approvedCandidateCount: approvedEntries.length,
    officialEntrantCount: officialEntryIds.length,
    teamCount: visibleTeams.length,
    playerCount: visibleTeams.reduce((total, team) => total + team.roster.length, 0),
    approvedEntryIds,
    officialEntryIds,
    officialSetComplete: lifecycle.officialSetComplete,
    visibleEntryIds,
    teams,
  };
}

function overviewFromState(state: MajorPublicParticipantState): MajorPublicParticipantOverview {
  return {
    phase: state.phase,
    presentation: state.presentation,
    entrantCapacity: state.entrantCapacity,
    approvedCandidateCount: state.approvedCandidateCount,
    officialEntrantCount: state.officialEntrantCount,
    teamCount: state.teamCount,
    playerCount: state.playerCount,
  };
}

export async function getMajorPublicParticipantOverview(
  season: MajorPublicParticipantSeason,
): Promise<MajorPublicParticipantOverview> {
  const { entrantCapacity, approvedEntryIds, amendingEntryIds, officialEntryIds, lifecycle, visibleEntryIds, presentation } = await loadMajorPublicParticipantDirectory(season, true);
  // Count the same roster occurrences as the detailed view, including merged users
  // and substitutes. Never transfer identities or avatars just to display a count.
  const amending = new Set(amendingEntryIds);
  const eventIds = lifecycle.officialSetComplete ? visibleEntryIds.filter((id) => !amending.has(id)) : [];
  const approvedIds = lifecycle.officialSetComplete ? visibleEntryIds.filter((id) => amending.has(id)) : visibleEntryIds;
  const rosterQuery = eventIds.length && approvedIds.length
    ? eventRosterQuery(eventIds).unionAll(approvedRosterQuery(approvedIds))
    : eventIds.length ? eventRosterQuery(eventIds) : approvedRosterQuery(approvedIds);
  const [row] = visibleEntryIds.length
    ? await db.select({ value: count() }).from(rosterQuery.as("visible_roster"))
    : [];
  return {
    phase: lifecycle.phase, presentation, entrantCapacity,
    approvedCandidateCount: approvedEntryIds.length,
    officialEntrantCount: officialEntryIds.length,
    teamCount: visibleEntryIds.length,
    playerCount: row?.value ?? 0,
  };
}

export async function getMajorPublicParticipantSummary(
  season: MajorPublicParticipantSeason,
): Promise<MajorPublicParticipantSummary> {
  const state = await loadMajorPublicParticipantState(season);
  const [matchSummary, seasonMatches] = await Promise.all([
    getPublicEventTeamMatchSummary(season.id, state.visibleEntryIds, state.approvedEntryIds),
    getOfficialSeasonMatchSummary(season.id),
  ]);
  return {
    ...overviewFromState(state),
    teams: state.teams
      .filter((team) => state.visibleEntryIds.includes(team.entry.id))
      .map((team) => ({
        ...team,
        record: matchSummary.records.get(team.entry.id) ?? createEmptyPublicEventTeamRecord(),
      })),
    matchCount: seasonMatches.total,
    finishedMatchCount: seasonMatches.finished,
  };
}

export async function getMajorPublicParticipantTeam(
  season: MajorPublicParticipantSeason,
  entryId: string,
): Promise<PublicEventTeamContext | null> {
  const state = await loadMajorPublicParticipantState(season, { entryId });
  const team = state.teams.find((candidate) => candidate.entry.id === entryId);
  if (!team) return null;

  const matchFacts = await getPublicEventTeamMatchFacts(season.id, [entryId]);
  const facts = matchFacts.get(entryId) ?? {
    record: createEmptyPublicEventTeamRecord(),
    matches: [],
  };
  return { ...team, record: facts.record, matches: facts.matches };
}
