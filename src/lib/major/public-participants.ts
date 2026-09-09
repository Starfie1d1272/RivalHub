import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import {
  competitionEntries,
  competitionEntryRosterMembers,
  competitionEntryRosterRevisions,
  eventRosterMembers,
  eventRosters,
  majorPrestartStates,
  majorTournamentEntrants,
  majorTournamentSeeds,
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
import { getVerifiedPlayerStatsBySeason, type VerifiedPlayerSeasonStats } from "@/lib/stats/public-query";

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
  playerHeading: string;
  playerDescription: string;
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

export interface MajorPublicParticipantPlayer {
  userId: string;
  entryId: string;
  entryName: string;
  name: string;
  isStarter: boolean;
  isRepresentative: boolean;
  stats: VerifiedPlayerSeasonStats | null;
}

export interface MajorPublicParticipantProjection extends MajorPublicParticipantOverview {
  players: MajorPublicParticipantPlayer[];
}

type PublicEntryRow = {
  id: string;
  name: string;
  logoUrl: string | null;
  registrationStatus: "approved";
  representativeUserId: string;
  teamId: string | null;
};

type RosterMemberRow = {
  entryId: string;
  userId: string;
  displayName: string | null;
  perfectName: string | null;
  steamName: string | null;
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
  players: Array<Omit<MajorPublicParticipantPlayer, "stats"> & { stats: null }>;
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
        playerHeading: "正式参赛队选手",
        playerDescription: "以下选手来自本届最终参赛名单。",
      };
    case "final_entrants":
      return {
        teamCollectionLabel: "正式参赛队",
        teamCollectionDescription: "本届正式参赛队已经确定，参赛名单仍可能调整。",
        playerHeading: "正式参赛队选手",
        playerDescription: "以下选手来自本届当前参赛名单；最终名单仍可能调整。",
      };
    case "approved_candidates":
      return {
        teamCollectionLabel: "已通过报名审核的队伍",
        teamCollectionDescription: "以下队伍已通过报名审核，正赛资格由赛委会确认。",
        playerHeading: "已通过审核队伍选手",
        playerDescription: "以下选手来自已通过审核的队伍，正赛名单待确认。",
      };
  }
}

function addToMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}

function publicRosterMember(row: RosterMemberRow, representativeUserId: string) {
  return {
    userId: row.userId,
    name: getPublicDisplayName(row),
    isStarter: row.isStarter,
    isRepresentative: row.userId === representativeUserId,
  };
}

async function loadMajorPublicParticipantState(
  season: MajorPublicParticipantSeason,
  options: { entryId?: string } = {},
): Promise<MajorPublicParticipantState> {
  const { entrantCapacity } = getStandardMajorDefinition(season);
  const [approvedEntries, entrantRefs, prestartState] = await Promise.all([
    db
      .select({
        id: competitionEntries.id,
        name: competitionEntries.name,
        logoUrl: competitionEntries.logoUrl,
        registrationStatus: competitionEntries.registrationStatus,
        representativeUserId: competitionEntries.representativeUserId,
        teamId: competitionEntries.teamId,
      })
      .from(competitionEntries)
      .where(and(
        eq(competitionEntries.competitionId, season.id),
        eq(competitionEntries.registrationStatus, "approved"),
      ))
      .orderBy(asc(competitionEntries.formationOrder), asc(competitionEntries.createdAt), asc(competitionEntries.id)),
    db
      .select({
        entryId: majorTournamentEntrants.competitionEntryId,
      })
      .from(majorTournamentEntrants)
      .where(eq(majorTournamentEntrants.seasonId, season.id))
      .orderBy(asc(majorTournamentEntrants.createdAt), asc(majorTournamentEntrants.id)),
    db.query.majorPrestartStates.findFirst({
      where: eq(majorPrestartStates.seasonId, season.id),
      columns: { entrantsLockedAt: true, seedsConfirmedAt: true },
    }),
  ]) as [PublicEntryRow[], Array<{ entryId: string }>, { entrantsLockedAt: Date | null; seedsConfirmedAt: Date | null } | undefined];

  const approvedEntryIds = approvedEntries.map((entry) => entry.id);
  const officialEntryIds = entrantRefs.map((entrant) => entrant.entryId);
  const lifecycleEntryIds = options.entryId
    ? approvedEntryIds.filter((entryId) => entryId === options.entryId)
    : approvedEntryIds;
  const eventMemberEntryIds = options.entryId
    ? officialEntryIds.includes(options.entryId) ? [options.entryId] : []
    : officialEntryIds;

  // Roster membership is an event fact; a later user merge must not erase it from the public record.
  const [approvedRosterRows, eventRosterFacts, eventRosterMembersRows, seedRows] = await Promise.all([
    lifecycleEntryIds.length
      ? db
        .select({
          entryId: competitionEntries.id,
          userId: competitionEntryRosterMembers.userId,
          displayName: users.displayName,
          perfectName: users.perfectName,
          steamName: users.steamName,
          isStarter: competitionEntryRosterMembers.isPrimaryStarter,
        })
        .from(competitionEntryRosterMembers)
        .innerJoin(competitionEntryRosterRevisions, eq(competitionEntryRosterRevisions.id, competitionEntryRosterMembers.revisionId))
        .innerJoin(competitionEntries, eq(competitionEntries.approvedRosterRevisionId, competitionEntryRosterRevisions.id))
        .innerJoin(users, eq(users.id, competitionEntryRosterMembers.userId))
        .where(and(
          inArray(competitionEntries.id, lifecycleEntryIds),
          eq(competitionEntryRosterRevisions.status, "approved"),
        ))
        .orderBy(asc(competitionEntries.id), asc(users.id))
      : Promise.resolve([] as RosterMemberRow[]),
    officialEntryIds.length
      ? db
        .select({
          entryId: eventRosters.entryId,
          status: eventRosters.status,
        })
        .from(eventRosters)
        .where(inArray(eventRosters.entryId, officialEntryIds))
        .orderBy(asc(eventRosters.entryId))
      : Promise.resolve([] as EventRosterFact[]),
    eventMemberEntryIds.length
      ? db
        .select({
          entryId: eventRosters.entryId,
          userId: eventRosterMembers.userId,
          displayName: users.displayName,
          perfectName: users.perfectName,
          steamName: users.steamName,
          isStarter: eventRosterMembers.isPrimaryStarter,
        })
        .from(eventRosterMembers)
        .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
        .innerJoin(users, eq(users.id, eventRosterMembers.userId))
        .where(inArray(eventRosters.entryId, eventMemberEntryIds))
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

  const lifecycle = resolveMajorPublicParticipantLifecycle({
    entrantCapacity,
    approvedEntryIds,
    officialEntryIds,
    eventRosterFacts,
    entrantsLockedAt: prestartState?.entrantsLockedAt ?? null,
  });
  const approvedEntryIdSet = new Set(approvedEntryIds);
  const officialEntryIdSet = new Set(officialEntryIds);
  const visibleEntryIds = lifecycle.officialSetComplete
    ? officialEntryIds.filter((entryId) => approvedEntryIdSet.has(entryId))
    : approvedEntryIds;
  const presentation = presentMajorPublicParticipantPhase(lifecycle.phase);
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
    const roster = isOfficial
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
      cardLabel: isOfficial
        ? seed === null ? "正式参赛队" : `#${seed} 种子`
        : "已通过报名审核",
      participation,
      roster: roster.map((member) => publicRosterMember(member, entry.representativeUserId)),
      rosterLabel: isOfficial
        ? lifecycle.phase === "rosters_frozen" ? "最终参赛名单" : "当前参赛名单"
        : "已审核报名名单",
      rosterStatus: isOfficial ? (eventRosterByEntryId.get(entry.id)?.status ?? null) : null,
      seed,
      seedPresentation,
    } satisfies MajorPublicParticipantTeamBase;
  });
  const visibleTeams = teams.filter((team) => visibleEntryIds.includes(team.entry.id));
  const players = visibleTeams.flatMap((team) => team.roster.map((member) => ({
    userId: member.userId,
    entryId: team.entry.id,
    entryName: team.entry.name,
    name: member.name,
    isStarter: member.isStarter,
    isRepresentative: member.isRepresentative,
    stats: null,
  })));

  return {
    phase: lifecycle.phase,
    presentation,
    entrantCapacity,
    approvedCandidateCount: approvedEntries.length,
    officialEntrantCount: officialEntryIds.length,
    teamCount: visibleTeams.length,
    playerCount: players.length,
    approvedEntryIds,
    officialEntryIds,
    officialSetComplete: lifecycle.officialSetComplete,
    visibleEntryIds,
    teams,
    players,
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
  return overviewFromState(await loadMajorPublicParticipantState(season));
}

export async function getMajorPublicParticipantSummary(
  season: MajorPublicParticipantSeason,
): Promise<MajorPublicParticipantSummary> {
  const state = await loadMajorPublicParticipantState(season);
  const matchSummary = await getPublicEventTeamMatchSummary(
    season.id,
    state.visibleEntryIds,
    state.approvedEntryIds,
  );
  return {
    ...overviewFromState(state),
    teams: state.teams
      .filter((team) => state.visibleEntryIds.includes(team.entry.id))
      .map((team) => ({
        ...team,
        record: matchSummary.records.get(team.entry.id) ?? createEmptyPublicEventTeamRecord(),
      })),
    matchCount: matchSummary.total,
    finishedMatchCount: matchSummary.finished,
  };
}

export async function getMajorPublicParticipantProjection(
  season: MajorPublicParticipantSeason,
): Promise<MajorPublicParticipantProjection> {
  const state = await loadMajorPublicParticipantState(season);
  const statsByUserId = await getVerifiedPlayerStatsBySeason(
    season.id,
    state.players.map((player) => player.userId),
  );
  return {
    phase: state.phase,
    presentation: state.presentation,
    entrantCapacity: state.entrantCapacity,
    approvedCandidateCount: state.approvedCandidateCount,
    officialEntrantCount: state.officialEntrantCount,
    teamCount: state.teamCount,
    playerCount: state.playerCount,
    players: state.players.map((player) => ({
      ...player,
      stats: statsByUserId.get(player.userId) ?? null,
    })).sort((a, b) => a.entryName.localeCompare(b.entryName) || a.name.localeCompare(b.name)),
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
